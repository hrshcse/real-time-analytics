/**
 * Downsampling (WBS 6). Both functions return the INDICES of the points to keep, so a caller can
 * apply the same selection to parallel series (e.g. avg and p95 share timestamps).
 *
 *   10,000 points ──▶ LTTB ──▶ 1,000 points ──▶ chart
 *
 * Inputs must be sorted by x. If n ≤ target, every index is returned.
 */

export type DownsampleAlgorithm = 'none' | 'nth' | 'lttb';

function all(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

/** Keep every k-th point (plus the last). Cheap, but drops peaks that fall between picks. */
export function everyNth(n: number, target: number): number[] {
  if (target >= n || target < 3) return all(n);
  const step = Math.ceil(n / target);
  const out: number[] = [];
  for (let i = 0; i < n; i += step) out.push(i);
  if (out[out.length - 1] !== n - 1) out.push(n - 1);
  return out;
}

/**
 * Largest-Triangle-Three-Buckets (Steinarsson, 2013).
 *
 *   first point kept ─┬─ bucket 1 ─┬─ bucket 2 ─┬─ … ─┬─ last point kept
 *                     │  pick the point that forms the LARGEST triangle with
 *                     │  (previous kept point, average of the NEXT bucket)
 *
 * Keeps visual shape (peaks, dips) at a fixed point budget. O(n).
 */
export function lttb(xs: ArrayLike<number>, ys: ArrayLike<number>, target: number): number[] {
  const n = xs.length;
  if (target >= n || target < 3) return all(n);

  const out: number[] = [0];
  const bucketSize = (n - 2) / (target - 2);
  let a = 0; // index of the previously selected point

  for (let i = 0; i < target - 2; i++) {
    // Average of the NEXT bucket (the third point of the triangle)
    const nextStart = Math.floor((i + 1) * bucketSize) + 1;
    const nextEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, n);
    let avgX = 0;
    let avgY = 0;
    for (let j = nextStart; j < nextEnd; j++) {
      avgX += xs[j]!;
      avgY += ys[j]!;
    }
    const len = nextEnd - nextStart;
    avgX /= len;
    avgY /= len;

    // Current bucket: pick the point with the largest triangle area
    const start = Math.floor(i * bucketSize) + 1;
    const end = Math.floor((i + 1) * bucketSize) + 1;
    const ax = xs[a]!;
    const ay = ys[a]!;
    let maxArea = -1;
    let pick = start;
    for (let j = start; j < end; j++) {
      const area = Math.abs((ax - avgX) * (ys[j]! - ay) - (ax - xs[j]!) * (avgY - ay));
      if (area > maxArea) {
        maxArea = area;
        pick = j;
      }
    }
    out.push(pick);
    a = pick;
  }

  out.push(n - 1);
  return out;
}

export function downsample(
  algorithm: DownsampleAlgorithm,
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  target: number,
): number[] {
  if (algorithm === 'lttb') return lttb(xs, ys, target);
  if (algorithm === 'nth') return everyNth(xs.length, target);
  return all(xs.length);
}
