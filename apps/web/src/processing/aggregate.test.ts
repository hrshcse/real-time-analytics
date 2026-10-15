import { describe, expect, it } from 'vitest';
import type { AnalyticsEvent, MetricType } from '@rta/shared';
import { createAggregator, percentile } from './aggregate';

let n = 0;
const ev = (timestamp: number, value: number, metric: MetricType = 'cpu'): AnalyticsEvent => ({
  id: `e${n++}`,
  timestamp,
  metric,
  value,
  category: 'system',
  source: 'api-01',
});

describe('percentile (nearest rank)', () => {
  const oneTo100 = Float64Array.from({ length: 100 }, (_, i) => i + 1);
  it('p95 / p99 / p50 of 1..100', () => {
    expect(percentile(oneTo100, 95)).toBe(95);
    expect(percentile(oneTo100, 99)).toBe(99);
    expect(percentile(oneTo100, 50)).toBe(50);
  });
  it('single value: every percentile is that value', () => {
    expect(percentile(Float64Array.of(7), 95)).toBe(7);
    expect(percentile(Float64Array.of(7), 1)).toBe(7);
  });
  it('empty → NaN', () => {
    expect(percentile(new Float64Array(0), 95)).toBeNaN();
  });
});

describe('createAggregator — 1 s buckets', () => {
  it('assigns …999 and …000 to different buckets', () => {
    const agg = createAggregator({ graceMs: 0 });
    agg.add([ev(999, 1), ev(1000, 2)]);
    agg.close(2000);
    const s = agg.series('cpu', 1000);
    expect(s.map((b) => [b.start, b.count])).toEqual([
      [0, 1],
      [1000, 1],
    ]);
  });

  it('computes count / sum / avg / min / max / p95 / p99', () => {
    const agg = createAggregator({ graceMs: 0 });
    // values 1..100 shuffled, all in second [0, 1000)
    const values = Array.from({ length: 100 }, (_, i) => i + 1).sort(() => 0.5 - Math.random());
    agg.add(values.map((v, i) => ev(i, v)));
    agg.close(1000);
    expect(agg.latest(1000).cpu).toEqual({
      start: 0,
      windowMs: 1000,
      count: 100,
      sum: 5050,
      avg: 50.5,
      min: 1,
      max: 100,
      p95: 95,
      p99: 99,
    });
  });

  it('keeps metrics separate', () => {
    const agg = createAggregator({ graceMs: 0 });
    agg.add([ev(10, 5, 'cpu'), ev(20, 300, 'latency')]);
    agg.close(1000);
    expect(agg.latest(1000).cpu?.max).toBe(5);
    expect(agg.latest(1000).latency?.max).toBe(300);
    expect(agg.latest(1000).memory).toBeUndefined();
  });

  it('does not close a bucket until its end + grace has passed', () => {
    const agg = createAggregator({ graceMs: 250 });
    agg.add([ev(500, 1)]);
    expect(agg.close(1100)).toBe(false); // 1000 + 250 > 1100
    expect(agg.latest(1000).cpu).toBeUndefined();
    expect(agg.close(1250)).toBe(true);
    expect(agg.latest(1000).cpu?.count).toBe(1);
  });

  it('counts and drops late events for an already-closed bucket (D14)', () => {
    const agg = createAggregator({ graceMs: 0 });
    agg.add([ev(100, 1)]);
    agg.close(1000);
    agg.add([ev(200, 99)]); // belongs to the closed [0, 1000) bucket
    agg.close(2000);
    expect(agg.lateEvents).toBe(1);
    expect(agg.series('cpu', 1000)).toHaveLength(1);
    expect(agg.series('cpu', 1000)[0]!.max).toBe(1);
  });

  it('evicts beyond `retain`', () => {
    const agg = createAggregator({ graceMs: 0, retain: 3, windowsMs: [1000] });
    for (let s = 0; s < 5; s++) agg.add([ev(s * 1000, s)]);
    agg.close(5000);
    expect(agg.series('cpu', 1000).map((b) => b.start)).toEqual([2000, 3000, 4000]);
  });

  it('error rate = avg of the errors metric (values are 0/1)', () => {
    const agg = createAggregator({ graceMs: 0 });
    agg.add(Array.from({ length: 50 }, (_, i) => ev(i, i === 0 ? 1 : 0, 'errors')));
    agg.close(1000);
    expect(agg.latest(1000).errors?.avg).toBe(0.02);
  });
});

describe('createAggregator — larger windows', () => {
  it('merges count/sum/min/max and computes EXACT percentiles over the whole window', () => {
    const agg = createAggregator({ graceMs: 0, windowsMs: [1000, 5000] });
    // second 0: 99 × value 1 ; seconds 1–4: one value each of 1000
    agg.add(Array.from({ length: 99 }, (_, i) => ev(i, 1)));
    for (let s = 1; s < 5; s++) agg.add([ev(s * 1000, 1000)]);
    agg.close(5000);

    const w = agg.latest(5000).cpu!;
    expect(w).toMatchObject({ start: 0, windowMs: 5000, count: 103, sum: 4099, min: 1, max: 1000 });
    // 103 values: 99 ones then four 1000s. Nearest rank p95 = ceil(97.85) = 98th → 1
    expect(w.p95).toBe(1);
    // p99 = ceil(101.97) = 102nd → 1000
    expect(w.p99).toBe(1000);

    // The trap: averaging the five 1 s p99s gives a different (wrong) answer.
    const avgOfP99s =
      agg.series('cpu', 1000).reduce((s, b) => s + b.p99, 0) / agg.series('cpu', 1000).length;
    expect(avgOfP99s).not.toBe(w.p99);
  });

  it('only builds a window once all of it has closed', () => {
    const agg = createAggregator({ graceMs: 0, windowsMs: [1000, 5000] });
    agg.add([ev(0, 1), ev(4500, 2)]);
    agg.close(4000);
    expect(agg.latest(5000).cpu).toBeUndefined();
    agg.close(5000);
    expect(agg.latest(5000).cpu?.count).toBe(2);
  });

  it('skips a window that was already in progress when data started', () => {
    const agg = createAggregator({ graceMs: 0, windowsMs: [1000, 5000] });
    agg.add([ev(3000, 1), ev(5000, 2)]); // data starts mid-window [0, 5000)
    agg.close(10_000);
    expect(agg.series('cpu', 5000).map((b) => b.start)).toEqual([5000]);
  });

  it('leaves a gap (no bucket) for a window with no data', () => {
    const agg = createAggregator({ graceMs: 0, windowsMs: [1000, 5000] });
    agg.add([ev(0, 1), ev(10_000, 2)]);
    agg.close(15_000);
    expect(agg.series('cpu', 5000).map((b) => b.start)).toEqual([0, 10_000]);
  });

  it('builds 1 minute windows after a long idle gap in one close() call', () => {
    const agg = createAggregator({ graceMs: 0 });
    for (let s = 0; s < 60; s++) agg.add([ev(s * 1000, s)]);
    agg.close(3_600_000); // an hour later
    const m = agg.latest(60_000).cpu!;
    expect(m).toMatchObject({ start: 0, count: 60, min: 0, max: 59 });
  });

  it('rejects windows that are not multiples of 1000 or lack 1000', () => {
    expect(() => createAggregator({ windowsMs: [5000] })).toThrow();
    expect(() => createAggregator({ windowsMs: [1000, 1500] })).toThrow();
  });
});
