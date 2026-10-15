import {
  createAggregator,
  createInvalidCounts,
  createRateMeter,
  createSeqTracker,
  parseServerMessage,
  validateEvents,
  type AggregatorOptions,
  type LatestBuckets,
} from '../processing';
import type { MainToWorker, ProcessingTime, WorkerSummary } from './contract';

export interface ProcessorOptions {
  aggregator?: AggregatorOptions;
  /** Wall clock (ms since epoch) for validation and bucketing. */
  now?: () => number;
  /** High-resolution clock for measuring processing time. */
  perfNow?: () => number;
}

/**
 * All worker logic, as a plain object: no `self`, no timers. The worker file only wires
 * messages to it, so this is unit-tested directly (WBS 4.2–4.5, 5.x).
 */
export function createProcessor(options: ProcessorOptions = {}) {
  const now = options.now ?? Date.now;
  const perfNow = options.perfNow ?? (() => performance.now());

  const seq = createSeqTracker();
  const invalid = createInvalidCounts();
  const aggregator = createAggregator(options.aggregator);
  const rate = createRateMeter(1000);

  let totalEvents = 0;
  let batchFrames = 0;
  let malformedFrames = 0;
  let serverDropped = 0;
  let processing: ProcessingTime = { batches: 0, totalMs: 0, maxMs: 0 };
  let version = 0;
  let changed = false;

  function processFrame(raw: string, batchNow: number) {
    const t0 = perfNow();
    const msg = parseServerMessage(raw);
    if (!msg || msg.type !== 'batch') {
      // Main only forwards batch frames; anything else here is a truncated/garbled batch.
      malformedFrames++;
      return;
    }
    batchFrames++;
    if (!seq.accept(msg.seq)) return; // duplicate
    if (typeof msg.serverDropped === 'number') serverDropped = msg.serverDropped;

    const valid = validateEvents(msg.events, batchNow, invalid);
    aggregator.add(valid);
    totalEvents += valid.length;

    const ms = perfNow() - t0;
    processing.batches++;
    processing.totalMs += ms;
    if (ms > processing.maxMs) processing.maxMs = ms;
  }

  return {
    handle(message: MainToWorker) {
      switch (message.type) {
        case 'frames': {
          const batchNow = now(); // once per message, not per event
          for (const raw of message.raw) processFrame(raw, batchNow);
          changed = true;
          return;
        }
        case 'reset':
          seq.reset();
          serverDropped = 0;
          changed = true;
          return;
      }
    },

    /**
     * Called on a timer by the worker. Closes finished buckets and returns a summary if anything
     * changed since the last call, otherwise null (so an idle stream sends nothing).
     */
    tick(): WorkerSummary | null {
      const at = now();
      const closed = aggregator.close(at);
      const prevRate = rate.rate;
      const eventsPerSec = rate.sample(at, totalEvents);
      if (!changed && !closed && eventsPerSec === prevRate) return null;

      changed = false;
      version++;
      const latest: Record<number, LatestBuckets> = {};
      for (const w of aggregator.windowsMs) latest[w] = aggregator.latest(w);
      const summary: WorkerSummary = {
        version,
        eventsPerSec,
        totalEvents,
        batchFrames,
        malformedFrames,
        invalidEvents: invalid.total,
        invalidByReason: { ...invalid.byReason },
        missedFrames: seq.missed,
        duplicateFrames: seq.duplicates,
        serverDropped,
        lateEvents: aggregator.lateEvents,
        processing,
        latest,
      };
      processing = { batches: 0, totalMs: 0, maxMs: 0 }; // per-summary window
      return summary;
    },

    /** For charts later (Phase 3): full retained series. */
    aggregator,
  };
}

export type Processor = ReturnType<typeof createProcessor>;
