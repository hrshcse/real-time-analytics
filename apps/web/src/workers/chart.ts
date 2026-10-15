import { METRICS, type MetricType } from '@rta/shared';
import {
  downsample,
  type Aggregator,
  type DownsampleAlgorithm,
  type EventStore,
} from '../processing';

/**
 * Builds chart series in the worker (WBS 6–7), so the main thread only receives
 * ≤ maxPoints points per metric, already downsampled.
 *
 *  resolution 'bucket': 1 s bucket avg + p95 from the aggregator (≤ 3,600 points for 1 h)
 *  resolution 'raw'   : individual events from the store (up to 100K across metrics)
 *                                     │
 *                                     ▼  none | every-Nth | LTTB  → ≤ maxPoints
 */

export interface ChartView {
  rangeMs: number;
  metrics: MetricType[];
  resolution: 'bucket' | 'raw';
  algorithm: DownsampleAlgorithm;
  maxPoints: number;
}

export interface ChartSeries {
  /** x: ms since epoch */
  t: number[];
  /** bucket avg, or the raw value in 'raw' mode */
  y: number[];
  /** bucket p95 ('bucket' mode only; empty in 'raw') */
  p95: number[];
}

export interface ChartData {
  view: ChartView;
  series: Partial<Record<MetricType, ChartSeries>>;
  /** Largest per-metric point count before downsampling. */
  inputPoints: number;
  /** Largest per-metric point count after downsampling. */
  outputPoints: number;
  /** Worker time spent downsampling, all metrics. */
  downsampleMs: number;
  /** When the data was built (ms since epoch). */
  builtAt: number;
}

export const DEFAULT_VIEW: ChartView = {
  rangeMs: 60_000,
  metrics: ['cpu', 'memory', 'latency', 'requests', 'network', 'errors'],
  resolution: 'bucket',
  algorithm: 'lttb',
  maxPoints: 300,
};

export function buildChart(
  view: ChartView,
  aggregator: Aggregator,
  store: EventStore,
  now: number,
  perfNow: () => number,
): ChartData {
  const from = now - view.rangeMs;
  const series: ChartData['series'] = {};
  let inputPoints = 0;
  let outputPoints = 0;
  let downsampleMs = 0;
  const wanted = new Set(view.metrics);

  if (view.resolution === 'bucket') {
    for (const metric of METRICS) {
      if (!wanted.has(metric)) continue;
      const buckets = aggregator.series(metric, 1000).filter((b) => b.start >= from);
      const t = buckets.map((b) => b.start);
      const y = buckets.map((b) => b.avg);
      const t0 = perfNow();
      const idx = downsample(view.algorithm, t, y, view.maxPoints);
      downsampleMs += perfNow() - t0;
      series[metric] = {
        t: idx.map((i) => t[i]!),
        y: idx.map((i) => y[i]!),
        p95: idx.map((i) => buckets[i]!.p95),
      };
      inputPoints = Math.max(inputPoints, t.length);
      outputPoints = Math.max(outputPoints, idx.length);
    }
  } else {
    const raw = new Map<MetricType, { t: number[]; y: number[] }>();
    for (const m of view.metrics) raw.set(m, { t: [], y: [] });
    store.forEachNewest((e) => {
      if (e.timestamp < from) return; // newest → oldest isn't strictly time-ordered across batches; keep scanning
      const s = raw.get(e.metric);
      if (s) {
        s.t.push(e.timestamp);
        s.y.push(e.value);
      }
    });
    for (const [metric, s] of raw) {
      // Collected newest → oldest; charts and LTTB need ascending x.
      s.t.reverse();
      s.y.reverse();
      const t0 = perfNow();
      const idx = downsample(view.algorithm, s.t, s.y, view.maxPoints);
      downsampleMs += perfNow() - t0;
      series[metric] = { t: idx.map((i) => s.t[i]!), y: idx.map((i) => s.y[i]!), p95: [] };
      inputPoints = Math.max(inputPoints, s.t.length);
      outputPoints = Math.max(outputPoints, idx.length);
    }
  }

  return { view, series, inputPoints, outputPoints, downsampleMs, builtAt: now };
}
