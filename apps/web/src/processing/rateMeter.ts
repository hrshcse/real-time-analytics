/**
 * Per-second rate of a monotonically increasing counter, averaged over a sliding window.
 *
 *   sample(t=0, total=0) … sample(t=1000, total=10_000)  →  10_000 / sec
 *
 * DOM-free; used on the main thread (frames/sec, posts/sec) and in the worker (events/sec).
 */
export function createRateMeter(windowMs = 1000) {
  const samples: Array<{ at: number; total: number }> = [];
  let rate = 0;

  return {
    /** Record the counter's current total at time `at` (ms) and return the rate per second. */
    sample(at: number, total: number): number {
      samples.push({ at, total });
      while (samples.length > 2 && at - samples[1]!.at >= windowMs) samples.shift();
      const first = samples[0]!;
      rate = at > first.at ? Math.round(((total - first.total) * 1000) / (at - first.at)) : rate;
      return rate;
    },
    get rate() {
      return rate;
    },
    reset() {
      samples.length = 0;
      rate = 0;
    },
  };
}

export type RateMeter = ReturnType<typeof createRateMeter>;
