import type { AnalyticsEvent, MetricType } from '@rta/shared';
import type { EventStore } from './eventStore';

/**
 * Worker-side query for the virtualized grid (WBS 9). The main thread asks for one page
 * (~50 rows); sorting/filtering/searching 100K rows never touches the main thread.
 */

export type GridSortKey = 'timestamp' | 'metric' | 'value' | 'category' | 'source' | 'id';

export interface GridQuery {
  sort: { key: GridSortKey; dir: 'asc' | 'desc' };
  /** null = all metrics */
  metrics: MetricType[] | null;
  /** Case-insensitive substring over id, metric, category, source. */
  search: string;
  offset: number;
  limit: number;
}

export interface GridPage {
  total: number;
  offset: number;
  rows: AnalyticsEvent[];
  /** Time spent filtering + sorting in the worker. */
  queryMs: number;
  /** Events held in the store (before filtering). */
  stored: number;
}

export const DEFAULT_GRID_QUERY: GridQuery = {
  sort: { key: 'timestamp', dir: 'desc' },
  metrics: null,
  search: '',
  offset: 0,
  limit: 60,
};

function compare(key: GridSortKey): (a: AnalyticsEvent, b: AnalyticsEvent) => number {
  switch (key) {
    case 'timestamp':
      return (a, b) => a.timestamp - b.timestamp;
    case 'value':
      return (a, b) => a.value - b.value;
    default:
      return (a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0);
  }
}

/**
 * Builds the full filtered + sorted index (array of references, no copies).
 * Callers cache it and slice pages from it; rebuilding is the expensive part.
 */
export function buildGridIndex(
  store: EventStore,
  query: Omit<GridQuery, 'offset' | 'limit'>,
): AnalyticsEvent[] {
  const metrics = query.metrics ? new Set<string>(query.metrics) : null;
  const needle = query.search.trim().toLowerCase();
  const out: AnalyticsEvent[] = [];
  store.forEachNewest((e) => {
    if (metrics && !metrics.has(e.metric)) return;
    if (
      needle &&
      !e.id.toLowerCase().includes(needle) &&
      !e.metric.includes(needle) &&
      !e.category.includes(needle) &&
      !e.source.toLowerCase().includes(needle)
    ) {
      return;
    }
    out.push(e);
  });
  // The store is iterated newest → oldest, so time-descending needs no sort at all.
  const { key, dir } = query.sort;
  if (key === 'timestamp') {
    if (dir === 'asc') out.reverse();
    return out;
  }
  const cmp = compare(key);
  // Array.prototype.sort is stable: ties keep newest-first order.
  out.sort(dir === 'asc' ? cmp : (a, b) => cmp(b, a));
  return out;
}

export function sameFilter(a: GridQuery, b: GridQuery): boolean {
  return (
    a.sort.key === b.sort.key &&
    a.sort.dir === b.sort.dir &&
    a.search === b.search &&
    (a.metrics?.join() ?? '*') === (b.metrics?.join() ?? '*')
  );
}
