import type { MetricType } from '@rta/shared';
import type { BucketStats } from '../processing';
import type { StoredBucket } from './storage';

/**
 * Session replay (WBS 11.4): plays a stored session's 1 s buckets through the charts on a
 * virtual clock.
 *
 *   from ─────────────●──────────────── to
 *                     at  (advances by real elapsed × speed while playing)
 *
 * The live stream keeps running underneath; only the chart's source switches.
 */
export interface ReplayState {
  sessionId: string;
  from: number;
  to: number;
  at: number;
  speed: number;
  playing: boolean;
  ended: boolean;
}

export const REPLAY_SPEEDS = [1, 2, 5, 10, 30] as const;

export function createReplay(sessionId: string, buckets: readonly StoredBucket[], speed = 1) {
  const byMetric = new Map<MetricType, BucketStats[]>();
  let from = Infinity;
  let to = -Infinity;
  for (const b of buckets) {
    const { metric, sessionId: _s, ...stats } = b;
    let list = byMetric.get(metric);
    if (!list) byMetric.set(metric, (list = []));
    list.push(stats);
    from = Math.min(from, b.start);
    to = Math.max(to, b.start + b.windowMs);
  }
  for (const list of byMetric.values()) list.sort((a, b) => a.start - b.start);
  if (!Number.isFinite(from)) from = to = 0;

  const state: ReplayState = { sessionId, from, to, at: from, speed, playing: true, ended: false };

  return {
    /** Advance the virtual clock by `realMs` of wall time. Returns true if `at` moved. */
    advance(realMs: number): boolean {
      if (!state.playing || state.ended) return false;
      state.at = Math.min(state.to, state.at + realMs * state.speed);
      if (state.at >= state.to) {
        state.ended = true;
        state.playing = false;
      }
      return true;
    },
    pause() {
      state.playing = false;
    },
    resume() {
      if (state.ended) {
        state.at = state.from; // resume after the end restarts
        state.ended = false;
      }
      state.playing = true;
    },
    setSpeed(speed: number) {
      state.speed = speed;
    },
    /** Buckets of one metric that have "happened" by the replay clock. */
    seriesUpTo(metric: MetricType): BucketStats[] {
      const list = byMetric.get(metric) ?? [];
      // Bucket is visible once it has ended on the replay clock.
      let hi = list.length;
      while (hi > 0 && list[hi - 1]!.start + 1000 > state.at) hi--;
      return list.slice(0, hi);
    },
    get state(): ReplayState {
      return { ...state };
    },
  };
}

export type Replay = ReturnType<typeof createReplay>;
