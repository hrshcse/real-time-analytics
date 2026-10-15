/**
 * Token bucket: `ratePerSec` tokens refill continuously, up to `burst`. Each message costs one.
 *
 *   tokens ▕████████░░▏ burst
 *            ↑ refills at ratePerSec; a message takes one; empty → rejected
 */
export function createTokenBucket(
  ratePerSec: number,
  burst = ratePerSec,
  now: () => number = Date.now,
) {
  let tokens = burst;
  let last = now();
  return {
    take(): boolean {
      const t = now();
      tokens = Math.min(burst, tokens + ((t - last) / 1000) * ratePerSec);
      last = t;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}
