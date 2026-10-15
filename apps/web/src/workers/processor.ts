import {
  buildGridIndex,
  createAggregator,
  createEventStore,
  createInvalidCounts,
  createRateMeter,
  createSeqTracker,
  parseServerMessage,
  sameFilter,
  validateEvents,
  type AggregatorOptions,
  type GridPage,
  type GridQuery,
  type LatestBuckets,
} from '../processing';
import type { AnalyticsEvent } from '@rta/shared';
import { buildChart, type ChartData, type ChartView } from './chart';
import type { MainToWorker, ProcessingTime, WorkerSummary } from './contract';

export interface ProcessorOptions {
  aggregator?: AggregatorOptions;
  /** Raw events kept for the grid and raw-resolution charts. */
  storeCapacity?: number;
  /** Minimum time between live grid rebuilds (rebuilding = filter + sort up to 100K rows). */
  gridRefreshMs?: number;
  /** Wall clock (ms since epoch) for validation and bucketing. */
  now?: () => number;
  /** High-resolution clock for measuring processing time. */
  perfNow?: () => number;
}

export interface TickOutput {
  summary: WorkerSummary | null;
  chart: ChartData | null;
  grid: GridPage | null;
}

/**
 * All worker logic, as a plain object: no `self`, no timers. The worker file only wires
 * messages to it, so this is unit-tested directly (WBS 4–6, 9).
 */
export function createProcessor(options: ProcessorOptions = {}) {
  const now = options.now ?? Date.now;
  const perfNow = options.perfNow ?? (() => performance.now());
  const gridRefreshMs = options.gridRefreshMs ?? 1000;

  const seq = createSeqTracker();
  const invalid = createInvalidCounts();
  // 3,600 × 1 s buckets = the 1 h chart range (WBS 7.3)
  const aggregator = createAggregator({ retain: 3600, ...options.aggregator });
  const store = createEventStore(options.storeCapacity ?? 100_000);
  const rate = createRateMeter(1000);

  let totalEvents = 0;
  let batchFrames = 0;
  let malformedFrames = 0;
  let serverDropped = 0;
  let processing: ProcessingTime = { batches: 0, totalMs: 0, maxMs: 0 };
  let version = 0;
  let changed = false;
  let simulatedWorkMs = 0;
  let newestEventAt: number | null = null;

  // chart state
  let view: ChartView | null = null;
  let viewChanged = false;
  let chartStoreVersion = -1;

  // grid state
  let gridQuery: GridQuery | null = null;
  let gridLive = true;
  let gridIndex: AnalyticsEvent[] = [];
  let gridIndexMs = 0;
  let gridBuiltAt = -Infinity;
  let gridBuiltVersion = -1;
  let gridPending = false;

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
    store.push(valid);
    totalEvents += valid.length;
    const last = valid[valid.length - 1];
    if (last && (newestEventAt === null || last.timestamp > newestEventAt))
      newestEventAt = last.timestamp;

    if (simulatedWorkMs > 0) {
      const until = perfNow() + simulatedWorkMs;
      while (perfNow() < until) {
        // busy-wait on purpose: a slow consumer for the backpressure experiment
      }
    }

    const ms = perfNow() - t0;
    processing.batches++;
    processing.totalMs += ms;
    if (ms > processing.maxMs) processing.maxMs = ms;
  }

  function rebuildGridIndex() {
    if (!gridQuery) return;
    const t0 = perfNow();
    gridIndex = buildGridIndex(store, gridQuery);
    gridIndexMs = perfNow() - t0;
    gridBuiltAt = now();
    gridBuiltVersion = store.version;
  }

  function gridPage(): GridPage | null {
    if (!gridQuery) return null;
    const { offset, limit } = gridQuery;
    return {
      total: gridIndex.length,
      offset,
      rows: gridIndex.slice(offset, offset + limit),
      queryMs: gridIndexMs,
      stored: store.size,
    };
  }

  function summarize(eventsPerSec: number): WorkerSummary {
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
      newestEventAt,
    };
    processing = { batches: 0, totalMs: 0, maxMs: 0 }; // per-summary window
    return summary;
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
        case 'view':
          view = message.view;
          viewChanged = true;
          return;
        case 'config':
          simulatedWorkMs = Math.max(0, Math.min(1000, message.simulatedWorkMs));
          return;
        case 'grid': {
          const prev = gridQuery;
          gridQuery = message.query;
          gridLive = message.live;
          if (!gridQuery) return;
          // A new filter/sort needs a rebuild; scrolling only re-slices the cached index.
          if (!prev || !sameFilter(prev, gridQuery)) rebuildGridIndex();
          gridPending = true;
          return;
        }
      }
    },

    /** A grid page owed right now (after a query message), else null. */
    takeGridPage(): GridPage | null {
      if (!gridPending) return null;
      gridPending = false;
      return gridPage();
    },

    /**
     * Called on a timer by the worker. Closes finished buckets and returns whatever changed
     * since the last call (nulls otherwise), so an idle stream sends nothing.
     */
    tick(): TickOutput {
      const at = now();
      const closed = aggregator.close(at);
      const prevRate = rate.rate;
      const eventsPerSec = rate.sample(at, totalEvents);

      let summary: WorkerSummary | null = null;
      if (changed || closed || eventsPerSec !== prevRate) {
        changed = false;
        summary = summarize(eventsPerSec);
      }

      let chart: ChartData | null = null;
      if (view) {
        // Rebuild only when the view's input changed: bucket mode → a bucket closed;
        // raw mode → new events arrived.
        const inputChanged =
          view.resolution === 'bucket' ? closed : store.version !== chartStoreVersion;
        if (viewChanged || inputChanged) {
          chart = buildChart(view, aggregator, store, at, perfNow);
          chartStoreVersion = store.version;
          viewChanged = false;
        }
      }

      let grid: GridPage | null = null;
      if (
        gridQuery &&
        gridLive &&
        store.version !== gridBuiltVersion &&
        at - gridBuiltAt >= gridRefreshMs
      ) {
        rebuildGridIndex();
        grid = gridPage();
      }

      return { summary, chart, grid };
    },

    aggregator,
    store,
  };
}

export type Processor = ReturnType<typeof createProcessor>;
