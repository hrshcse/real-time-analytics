import { describe, expect, it } from 'vitest';
import type { AnalyticsEvent, MetricType } from '@rta/shared';
import { createEventStore } from './eventStore';
import { buildGridIndex, DEFAULT_GRID_QUERY } from './gridQuery';

const ev = (
  i: number,
  metric: MetricType = 'cpu',
  value = i,
  source = 'api-01',
): AnalyticsEvent => ({
  id: `e${i}`,
  timestamp: 1000 + i,
  metric,
  value,
  category: 'system',
  source,
});

describe('createEventStore', () => {
  it('keeps the newest `capacity` events and overwrites the oldest', () => {
    const s = createEventStore(3);
    s.push([ev(1), ev(2), ev(3), ev(4)]);
    expect(s.size).toBe(3);
    expect(s.newest(0)?.id).toBe('e4');
    expect(s.newest(2)?.id).toBe('e2');
    expect(s.newest(3)).toBeUndefined();
  });

  it('bumps version on change only', () => {
    const s = createEventStore(3);
    const v = s.version;
    s.push([]);
    expect(s.version).toBe(v);
    s.push([ev(1)]);
    expect(s.version).toBe(v + 1);
  });
});

describe('buildGridIndex', () => {
  const s = createEventStore(10);
  s.push([ev(1, 'cpu', 5), ev(2, 'latency', 50, 'worker-01'), ev(3, 'cpu', 1), ev(4, 'memory', 9)]);
  const q = (over: Partial<typeof DEFAULT_GRID_QUERY>) => ({ ...DEFAULT_GRID_QUERY, ...over });

  it('default: newest first, no sort needed', () => {
    expect(buildGridIndex(s, q({})).map((e) => e.id)).toEqual(['e4', 'e3', 'e2', 'e1']);
  });
  it('time ascending', () => {
    expect(
      buildGridIndex(s, q({ sort: { key: 'timestamp', dir: 'asc' } })).map((e) => e.id),
    ).toEqual(['e1', 'e2', 'e3', 'e4']);
  });
  it('sorts numerically by value', () => {
    expect(
      buildGridIndex(s, q({ sort: { key: 'value', dir: 'desc' } })).map((e) => e.value),
    ).toEqual([50, 9, 5, 1]);
  });
  it('filters by metric', () => {
    expect(buildGridIndex(s, q({ metrics: ['cpu'] })).map((e) => e.id)).toEqual(['e3', 'e1']);
  });
  it('searches case-insensitively across id/source/metric', () => {
    expect(buildGridIndex(s, q({ search: 'WORKER' })).map((e) => e.id)).toEqual(['e2']);
    expect(buildGridIndex(s, q({ search: 'mem' })).map((e) => e.id)).toEqual(['e4']);
  });
});
