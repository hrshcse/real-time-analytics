import type { InvalidReason } from '@rta/shared';
import type { LatestBuckets } from '../processing';

/**
 * Messages between the main thread and the processing worker (WBS 4.1).
 * Both sides import these types, so a typo in `type` is a compile error.
 *
 *  MAIN                                   WORKER
 *   frames { raw: string[] } ──────────▶  parse → seq → validate → aggregate
 *   reset                    ──────────▶  new connection: seq restarts at 0
 *                            ◀──────────  summary (≤ 4/sec, only when changed)
 *                            ◀──────────  error (caught exception; worker keeps running)
 */

export type MainToWorker =
  /** Raw batch frames, exactly as received from the socket (D12). */
  | { type: 'frames'; raw: string[] }
  /** Sent on `hello`. Always after flushing buffered frames, so ordering stays correct. */
  | { type: 'reset' };

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
  { type: 'summary'; summary: WorkerSummary } | { type: 'error'; message: string };
