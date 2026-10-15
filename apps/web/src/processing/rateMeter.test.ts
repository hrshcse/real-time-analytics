import { describe, expect, it } from 'vitest';
import { createRateMeter } from './rateMeter';

describe('createRateMeter', () => {
  it('computes per-second rate over the window', () => {
    const m = createRateMeter(1000);
    m.sample(0, 0);
    m.sample(500, 5000);
    expect(m.sample(1000, 10_000)).toBe(10_000);
  });

  it('drops samples older than the window', () => {
    const m = createRateMeter(1000);
    m.sample(0, 0);
    m.sample(1000, 100); // slow second
    m.sample(2000, 10_100); // fast second
    expect(m.sample(2500, 15_100)).toBe(10_000);
  });

  it('returns 0 when the counter stops', () => {
    const m = createRateMeter(1000);
    m.sample(0, 0);
    m.sample(1000, 1000);
    m.sample(2000, 1000);
    expect(m.sample(3000, 1000)).toBe(0);
  });
});
