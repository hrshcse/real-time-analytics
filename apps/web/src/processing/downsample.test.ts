import { describe, expect, it } from 'vitest';
import { downsample, everyNth, lttb } from './downsample';

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('everyNth', () => {
  it('returns all indices when n ≤ target', () => {
    expect(everyNth(5, 10)).toEqual([0, 1, 2, 3, 4]);
  });
  it('keeps first and last, ~target points', () => {
    const idx = everyNth(1000, 100);
    expect(idx[0]).toBe(0);
    expect(idx.at(-1)).toBe(999);
    expect(idx.length).toBeLessThanOrEqual(101);
  });
});

describe('lttb', () => {
  it('returns exactly `target` sorted, unique indices including first and last', () => {
    const xs = range(10_000);
    const ys = xs.map((x) => Math.sin(x / 50));
    const idx = lttb(xs, ys, 1000);
    expect(idx).toHaveLength(1000);
    expect(idx[0]).toBe(0);
    expect(idx.at(-1)).toBe(9999);
    for (let i = 1; i < idx.length; i++) expect(idx[i]!).toBeGreaterThan(idx[i - 1]!);
  });

  it('keeps an isolated spike that every-Nth misses (the reason to use LTTB)', () => {
    const xs = range(10_000);
    const ys = xs.map(() => 0);
    ys[5_003] = 100; // one spike between every-Nth picks (step 10 → 5000, 5010)
    expect(lttb(xs, ys, 1000)).toContain(5_003);
    expect(everyNth(10_000, 1000)).not.toContain(5_003);
  });

  it('returns all indices when n ≤ target or target < 3', () => {
    expect(lttb([0, 1, 2], [0, 1, 2], 10)).toEqual([0, 1, 2]);
    expect(lttb(range(10), range(10), 2)).toEqual(range(10));
  });
});

describe('downsample', () => {
  it("'none' keeps everything", () => {
    expect(downsample('none', range(50), range(50), 10)).toHaveLength(50);
  });
});
