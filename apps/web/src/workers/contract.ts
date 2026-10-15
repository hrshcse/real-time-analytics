import type { InvalidReason } from '@rta/shared';
import type { GridPage, GridQuery, LatestBuckets } from '../processing';
import type { ChartData, ChartView } from './chart';
import type { ReplayState } from './replay';
import type { SessionMeta, StorageState } from './storage';

export type { ChartData, ChartView, GridPage, GridQuery, ReplayState, SessionMeta, StorageState };

export type ReplayCommand =
  | { action: 'start'; sessionId: string; speed: number }
  | { action: 'pause' }
  | { action: 'resume' }
  | { action: 'stop' }
  | { action: 'speed'; speed: number };

/**
 * Messages between the main thread and the processing worker (WBS 4.1).
 * Both sides import these types, so a typo in `type` is a compile error.
 *
 *  MAIN                                   WORKER
 *   frames { raw: string[] } ──────────▶  parse → seq → validate → aggregate + store
 *   reset                    ──────────▶  new connection: seq restarts at 0
 *   view  { ChartView|null } ──────────▶  which chart series to build (null = none)
 *   grid  { GridQuery|null } ──────────▶  which grid page to serve (null = grid closed)
 *                            ◀──────────  summary (≤ 4/sec, only when changed)
 *                            ◀──────────  chart   (≤ 4/sec, only when changed)
 *                            ◀──────────  grid    (immediately on a query; ≤ 1/sec while live)
 *                            ◀──────────  ack     (after each frames message: backpressure)
 *                            ◀──────────  error (caught exception; worker keeps running)
 */

export type MainToWorker =
  /** Raw batch frames, exactly as received from the socket (D12). */
  | { type: 'frames'; raw: string[] }
  /** Sent on `hello`. Always after flushing buffered frames, so ordering stays correct. */
  | { type: 'reset' }
  | { type: 'view'; view: ChartView | null }
  /** live = false freezes the grid's contents (paging still works on the frozen result). */
  | { type: 'grid'; query: GridQuery | null; live: boolean }
  /** Experiments (WBS 10.1): burn this many ms per frame to simulate a slow consumer. */
  | { type: 'config'; simulatedWorkMs: number }
  /** List stored sessions (answered with a `sessions` message). */
  | { type: 'sessions' }
  | ({ type: 'replay' } & ReplayCommand);

export interface ProcessingTime {
  /** Batches processed since the previous summary. */
  batches: number;
  /** Total and worst time spent per batch (parse + validate + aggregate), ms. */
  totalMs: number;
  maxMs: number;
}

export type StorageSummary =
  { status: 'starting' } | (StorageState & { restoredBuckets: number; corruptRecords: number });

export interface WorkerSummary {
  /** Increments whenever content changes; the main thread ignores repeats. */
  version: number;
  /** Valid events per second, measured in the worker over ~1 s. */
  eventsPerSec: number;
  totalEvents: number;
  batchFrames: number;
  malformedFrames: number;
  invalidEvents: number;
  invalidByReason: Record<InvalidReason, number>;
  missedFrames: number;
  duplicateFrames: number;
  serverDropped: number;
  /** Events whose 1 s bucket had already closed (D14). */
  lateEvents: number;
  processing: ProcessingTime;
  /** Latest closed bucket per metric, keyed by window size in ms (1000, 5000, …). */
  latest: Record<number, LatestBuckets>;
  /** Timestamp of the newest event processed. now − this = how stale the dashboard is. */
  newestEventAt: number | null;
  /** IndexedDB persistence status (WBS 11, 17.3). */
  storage: StorageSummary;
}

export type WorkerToMain =
  | { type: 'summary'; summary: WorkerSummary }
  | { type: 'chart'; chart: ChartData }
  | { type: 'grid'; page: GridPage }
  /** Sent after every `frames` message: how many frames were consumed (backpressure). */
  | { type: 'ack'; frames: number }
  | { type: 'sessions'; sessions: SessionMeta[] }
  /** Replay status after every command, and as the replay clock moves; null = not replaying. */
  | { type: 'replay'; state: ReplayState | null }
  | { type: 'error'; message: string };
