import { METRICS } from '@rta/shared';
import { DEFAULT_VIEW, type ChartView } from './workers/chart';

/**
 * Small per-viewer UI preferences (WBS 11.2 "restore selected metrics / dashboard state").
 * localStorage: tiny, synchronous at startup, and only this browser needs it. Data history
 * lives in IndexedDB instead (D25). Every access is guarded: storage can be blocked or full.
 */
const KEY = 'rta.chartView.v1';

export function loadChartView(): ChartView {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_VIEW;
    const v = JSON.parse(raw) as Partial<ChartView>;
    const metrics = Array.isArray(v.metrics)
      ? METRICS.filter((m) => v.metrics!.includes(m))
      : DEFAULT_VIEW.metrics;
    return {
      rangeMs: [60_000, 300_000, 900_000, 3_600_000].includes(v.rangeMs as number)
        ? (v.rangeMs as number)
        : DEFAULT_VIEW.rangeMs,
      metrics,
      resolution: v.resolution === 'raw' ? 'raw' : 'bucket',
      algorithm: v.algorithm === 'none' || v.algorithm === 'nth' ? v.algorithm : 'lttb',
      maxPoints: [100, 300, 1000].includes(v.maxPoints as number)
        ? (v.maxPoints as number)
        : DEFAULT_VIEW.maxPoints,
    };
  } catch {
    return DEFAULT_VIEW;
  }
}

export function saveChartView(view: ChartView) {
  try {
    localStorage.setItem(KEY, JSON.stringify(view));
  } catch {
    // private mode / quota: preferences just don't persist
  }
}
