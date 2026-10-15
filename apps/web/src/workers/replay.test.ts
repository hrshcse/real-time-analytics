import { describe, expect, it } from 'vitest';
import type { StoredBucket } from './storage';
import { createReplay } from './replay';

const b = (start: number, metric: StoredBucket['metric'] = 'cpu'): StoredBucket => ({
  sessionId: 's1',
  metric,
  start,
  windowMs: 1000,
  count: 1,
  sum: start,
  avg: start,
  min: start,
  max: start,
  p95: start,
  p99: start,
});

describe('createReplay', () => {
  const buckets = [b(0), b(1000), b(2000), b(3000), b(0, 'memory')];

  it('spans the session and reveals buckets as the virtual clock passes their end', () => {
    const r = createReplay('s1', buckets, 1);
    expect(r.state).toMatchObject({ from: 0, to: 4000, at: 0, playing: true });
    expect(r.seriesUpTo('cpu')).toHaveLength(0);
    r.advance(1000);
    expect(r.seriesUpTo('cpu').map((x) => x.start)).toEqual([0]);
    expect(r.seriesUpTo('memory')).toHaveLength(1);
  });

  it('speed multiplies elapsed time; ends at `to`', () => {
    const r = createReplay('s1', buckets, 5);
    r.advance(500); // 2.5 s of session time
    expect(r.state.at).toBe(2500);
    r.advance(10_000);
    expect(r.state).toMatchObject({ at: 4000, ended: true, playing: false });
    expect(r.seriesUpTo('cpu')).toHaveLength(4);
  });

  it('pause stops the clock; resume after the end restarts from the beginning', () => {
    const r = createReplay('s1', buckets, 1);
    r.pause();
    expect(r.advance(1000)).toBe(false);
    expect(r.state.at).toBe(0);
    r.resume();
    r.advance(10_000);
    r.resume();
    expect(r.state).toMatchObject({ at: 0, ended: false, playing: true });
  });

  it('changing speed applies from the next advance', () => {
    const r = createReplay('s1', buckets, 1);
    r.advance(1000);
    r.setSpeed(2);
    r.advance(500);
    expect(r.state.at).toBe(2000);
  });
});
