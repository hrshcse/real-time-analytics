import type { InvalidReason } from '@rta/shared';
import type { GridPage, GridQuery, LatestBuckets } from '../processing';
import type { ChartData, ChartView } from './chart';

export type { ChartData, ChartView, GridPage, GridQuery };

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
 *                            ◀──────────  error (caught exception; worker keeps running)
 */

export type MainToWorker =
  /** Raw batch frames, exactly as received from the socket (D12). */
  | { type: 'frames'; raw: string[] }
  /** Sent on `hello`. Always after flushing buffered frames, so ordering stays correct. */
  | { type: 'reset' }
  | { type: 'view'; view: ChartView | null }
  /** live = false freezes the grid's contents (paging still works on the frozen result). */
  | { type: 'grid'; query: GridQuery | null; live: boolean };

export interface ProcessingTime {
  /** Batches processed since the previous summary. */
  batches: number;
  /** Total and worst time spent per batch (parse + validate + aggregate), ms. */
  totalMs: number;
  maxMs: number;
}

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
}

export type WorkerToMain =
  | { type: 'summary'; summary: WorkerSummary }
  | { type: 'chart'; chart: ChartData }
  | { type: 'grid'; page: GridPage }
  | { type: 'error'; message: string };
