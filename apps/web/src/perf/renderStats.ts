import type { ProfilerOnRenderCallback } from 'react';

/**
 * Collects React <Profiler> timings without causing renders: onRender writes into plain
 * counters; the perf panel drains them once a second (WBS 14).
 *
 * React only calls onRender in development and profiling builds; in a production build these
 * stay at zero and the panel says so.
 */
interface Bucket {
  commits: number;
  totalMs: number;
  maxMs: number;
}

let current: Record<string, Bucket> = {};

export const onRenderProfile: ProfilerOnRenderCallback = (id, _phase, actualDuration) => {
  const b = (current[id] ??= { commits: 0, totalMs: 0, maxMs: 0 });
  b.commits++;
  b.totalMs += actualDuration;
  if (actualDuration > b.maxMs) b.maxMs = actualDuration;
};

/** Returns everything recorded since the last call, and starts a new window. */
export function drainRenderStats(): Record<string, Bucket> {
  const out = current;
  current = {};
  return out;
}
