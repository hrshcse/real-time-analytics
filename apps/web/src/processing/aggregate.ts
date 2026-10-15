import { METRICS, type AnalyticsEvent, type MetricType } from '@rta/shared';

/**
 * Time-bucket aggregation (WBS 5.1–5.3). DOM-free; runs in the worker.
 *
 *   events ──▶ open 1 s buckets per metric (count, sum, min, max, raw values)
 *                    │ close(now): bucket end + grace ≤ now
 *                    ▼
 *              closed 1 s buckets: stats + values sorted once (Float64Array)
 *                    │ every window boundary (5 s, 10 s, 1 m)
 *                    ▼
 *              window buckets: count/sum/min/max MERGED; p95/p99 from the
 *              CONCATENATED sorted values (percentiles can't be averaged)
 *
 * Exact percentiles everywhere (D15). Raw values are kept only as long as the largest
 * window needs them; after that only the stats are retained.
 */

export interface BucketStats {
  /** Bucket start, ms since epoch, aligned to windowMs. */
  start: number;
  windowMs: number;
  count: number;
  sum: number;
  avg: number;
  min: number;
  max: number;
  p95: number;
  p99: number;
}

export type LatestBuckets = Partial<Record<MetricType, BucketStats>>;

/** A closed 1 s bucket tagged with its metric: the unit persisted to IndexedDB (WBS 11). */
export interface MetricBucket extends BucketStats {
  metric: MetricType;
}

export interface AggregatorOptions {
  /** Window sizes in ms. Must include 1000 and be multiples of 1000. */
  windowsMs?: readonly number[];
  /** Closed buckets kept per metric per window (memory bound). 900 × 1 s = 15 min. */
  retain?: number;
  /** How long after a bucket's end it stays open for late events. */
  graceMs?: number;
}

export const DEFAULT_WINDOWS_MS = [1000, 5000, 10_000, 60_000] as const;

const BASE_MS = 1000;

interface OpenBucket {
  count: number;
  sum: number;
  min: number;
  max: number;
  values: number[]; // growable while open; converted to a sorted Float64Array on close
}

interface ClosedBase {
  stats: BucketStats;
  /** Sorted values, dropped once no window still needs them. */
  sorted: Float64Array | null;
}

/** Nearest-rank percentile on an ascending array. Multiply before dividing to avoid float error. */
export function percentile(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const rank = Math.max(1, Math.ceil((p * n) / 100));
  return sorted[rank - 1]!;
}

function statsFrom(
  start: number,
  windowMs: number,
  count: number,
  sum: number,
  min: number,
  max: number,
  sorted: Float64Array,
): BucketStats {
  return {
    start,
    windowMs,
    count,
    sum,
    avg: count > 0 ? sum / count : NaN,
    min,
    max,
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
}

export function createAggregator(options: AggregatorOptions = {}) {
  const windowsMs = [...(options.windowsMs ?? DEFAULT_WINDOWS_MS)].sort((a, b) => a - b);
  if (windowsMs[0] !== BASE_MS || windowsMs.some((w) => w % BASE_MS !== 0)) {
    throw new Error('windowsMs must include 1000 and contain only multiples of 1000');
  }
  const retain = options.retain ?? 900;
  const graceMs = options.graceMs ?? 250;
  const largestWindow = windowsMs[windowsMs.length - 1]!;
  const largerWindows = windowsMs.filter((w) => w > BASE_MS);

  const open = new Map<MetricType, Map<number, OpenBucket>>();
  /** Closed 1 s buckets per metric, ascending by start. */
  const closedBase = new Map<MetricType, ClosedBase[]>();
  /** Closed buckets per window per metric, ascending by start (1 s included). */
  const series = new Map<number, Map<MetricType, BucketStats[]>>();
  for (const w of windowsMs) series.set(w, new Map());

  /** Raw values must outlive the largest window, whatever `retain` says. */
  const retainBase = Math.max(retain, largestWindow / BASE_MS + 2);

  /** Everything before this (ms) is closed; events for it are late. */
  let closedUpTo = -Infinity;
  /** Start of the first 1 s bucket ever seen. Window buckets begin at the first boundary ≥ this,
   *  so a window that was already half over when data started is never reported as complete. */
  let firstSeen: number | null = null;
  /** Per larger window: end of the last window bucket built. */
  const lastWindowEnd = new Map<number, number>();
  let lateEvents = 0;
  /** 1 s buckets closed since the last takeClosed(), for persistence. */
  let newlyClosed: MetricBucket[] = [];

  function push<T>(list: T[], item: T, max: number) {
    list.push(item);
    if (list.length > max) list.splice(0, list.length - max);
  }

  function add(events: readonly AnalyticsEvent[]) {
    for (const e of events) {
      const start = e.timestamp - (e.timestamp % BASE_MS);
      if (start < closedUpTo) {
        lateEvents++; // its 1 s bucket is already closed and published (D14)
        continue;
      }
      if (firstSeen === null || start < firstSeen) firstSeen = start;
      let byStart = open.get(e.metric);
      if (!byStart) open.set(e.metric, (byStart = new Map()));
      let b = byStart.get(start);
      if (!b) {
        byStart.set(start, (b = { count: 0, sum: 0, min: Infinity, max: -Infinity, values: [] }));
      }
      b.count++;
      b.sum += e.value;
      if (e.value < b.min) b.min = e.value;
      if (e.value > b.max) b.max = e.value;
      b.values.push(e.value);
    }
  }

  /**
   * Close every 1 s bucket whose end + grace ≤ now, then build any 5 s / 10 s / 1 m buckets whose
   * windows are now complete. Returns true if anything new was closed.
   */
  function close(now: number): boolean {
    const cutoff = Math.floor((now - graceMs) / BASE_MS) * BASE_MS; // buckets starting < cutoff are done
    if (cutoff <= closedUpTo) return false;
    let changed = false;

    // 1) close 1 s buckets
    for (const [metric, byStart] of open) {
      const starts = [...byStart.keys()].filter((s) => s < cutoff).sort((a, b) => a - b);
      for (const s of starts) {
        const b = byStart.get(s)!;
        byStart.delete(s);
        const sorted = Float64Array.from(b.values).sort(); // TypedArray sort is numeric
        const stats = statsFrom(s, BASE_MS, b.count, b.sum, b.min, b.max, sorted);
        let list = closedBase.get(metric);
        if (!list) closedBase.set(metric, (list = []));
        list.push({ stats, sorted });
        let out = series.get(BASE_MS)!.get(metric);
        if (!out) series.get(BASE_MS)!.set(metric, (out = []));
        push(out, stats, retain);
        newlyClosed.push({ ...stats, metric });
        changed = true;
      }
    }

    // 2) build larger windows whose end is now ≤ cutoff
    for (const w of largerWindows) {
      if (firstSeen === null) break;
      let end = lastWindowEnd.get(w) ?? Math.ceil(firstSeen / w) * w;
      while (end + w <= cutoff) {
        end += w;
        changed = buildWindow(w, end - w, end) || changed;
      }
      lastWindowEnd.set(w, end);
    }

    // 3) drop raw values no window can still need, and cap base-bucket history
    const keepValuesFrom = cutoff - largestWindow;
    for (const list of closedBase.values()) {
      for (const c of list) if (c.stats.start < keepValuesFrom) c.sorted = null;
      if (list.length > retainBase) list.splice(0, list.length - retainBase);
    }

    closedUpTo = cutoff;
    return changed;
  }

  function buildWindow(windowMs: number, start: number, end: number): boolean {
    let built = false;
    for (const metric of METRICS) {
      const parts = (closedBase.get(metric) ?? []).filter(
        (c) => c.stats.start >= start && c.stats.start < end && c.sorted,
      );
      if (parts.length === 0) continue; // no data in this window: no bucket (a gap)

      let count = 0;
      let sum = 0;
      let min = Infinity;
      let max = -Infinity;
      let total = 0;
      for (const p of parts) {
        count += p.stats.count;
        sum += p.stats.sum;
        if (p.stats.min < min) min = p.stats.min;
        if (p.stats.max > max) max = p.stats.max;
        total += p.sorted!.length;
      }
      const merged = new Float64Array(total);
      let offset = 0;
      for (const p of parts) {
        merged.set(p.sorted!, offset);
        offset += p.sorted!.length;
      }
      merged.sort();

      let out = series.get(windowMs)!.get(metric);
      if (!out) series.get(windowMs)!.set(metric, (out = []));
      push(out, statsFrom(start, windowMs, count, sum, min, max, merged), retain);
      built = true;
    }
    return built;
  }

  /**
   * Put persisted 1 s buckets back into the 1 s series (reload recovery, WBS 11.2).
   * Display-only: restored buckets have no raw values, so they don't feed larger windows,
   * and they never overwrite a live bucket with the same start.
   */
  function restore(buckets: readonly MetricBucket[]) {
    const byMetric = new Map<MetricType, BucketStats[]>();
    for (const b of buckets) {
      const { metric, ...stats } = b;
      let list = byMetric.get(metric);
      if (!list) byMetric.set(metric, (list = []));
      list.push(stats);
    }
    for (const [metric, restored] of byMetric) {
      const live = series.get(BASE_MS)!.get(metric) ?? [];
      const seen = new Set(live.map((b) => b.start));
      const merged = [...restored.filter((b) => !seen.has(b.start)), ...live].sort(
        (a, b) => a.start - b.start,
      );
      if (merged.length > retain) merged.splice(0, merged.length - retain);
      series.get(BASE_MS)!.set(metric, merged);
    }
  }

  return {
    add,
    close,
    restore,
    /** Returns (and forgets) the 1 s buckets closed since the last call. */
    takeClosed(): MetricBucket[] {
      const out = newlyClosed;
      newlyClosed = [];
      return out;
    },
    /** Most recent closed bucket per metric for a window. */
    latest(windowMs: number): LatestBuckets {
      const out: LatestBuckets = {};
      for (const [metric, list] of series.get(windowMs) ?? []) {
        const last = list[list.length - 1];
        if (last) out[metric] = last;
      }
      return out;
    },
    /** All retained closed buckets for one metric and window, oldest first. */
    series(metric: MetricType, windowMs: number): readonly BucketStats[] {
      return series.get(windowMs)?.get(metric) ?? [];
    },
    get windowsMs(): readonly number[] {
      return windowsMs;
    },
    get lateEvents() {
      return lateEvents;
    },
  };
}

export type Aggregator = ReturnType<typeof createAggregator>;
