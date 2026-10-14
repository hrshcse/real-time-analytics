import {
  Categories,
  METRICS,
  type AnalyticsEvent,
  type CategoryType,
  type MetricType,
} from './events';

export type InvalidReason =
  'not-object' | 'id' | 'timestamp' | 'metric' | 'value' | 'category' | 'source';

export const INVALID_REASONS: readonly InvalidReason[] = [
  'not-object',
  'id',
  'timestamp',
  'metric',
  'value',
  'category',
  'source',
];

export type ValidationResult =
  { ok: true; event: AnalyticsEvent } | { ok: false; reason: InvalidReason };

/** Reject events older than this relative to `now`. */
export const MAX_EVENT_AGE_MS = 60 * 60 * 1000; // 1 hour
/** Allow events this far in the future, to tolerate server/browser clock differences. */
export const MAX_CLOCK_SKEW_MS = 60 * 1000; // 60 seconds

// `METRICS.includes(x)` won't compile when x is `string` (the array is readonly MetricType[]).
// A Set<string> accepts any string in `has()`, and the guard narrows the type for callers.
const METRIC_SET: ReadonlySet<string> = new Set(METRICS);
const CATEGORY_SET: ReadonlySet<string> = new Set(Categories);

export function isMetric(x: unknown): x is MetricType {
  return typeof x === 'string' && METRIC_SET.has(x);
}

export function isCategory(x: unknown): x is CategoryType {
  return typeof x === 'string' && CATEGORY_SET.has(x);
}

export function isNonEmptyString(x: unknown): x is string {
  return typeof x === 'string' && x.length > 0;
}

/**
 * `Number.isFinite` is typed `(n: unknown) => boolean`, not a type guard, so on its own it
 * leaves `x` as `unknown`. The `typeof` check does the narrowing; `isFinite` rejects NaN/±Infinity.
 * Unlike global `isNaN`, neither coerces: "42" is rejected.
 */
export function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * Validates one event from the wire. Never throws. Returns the same object (no copy) when valid.
 *
 * @param now Current time in ms. Passed in so the function stays pure and testable; callers
 *            should read `Date.now()` once per batch, not once per event.
 */
export function validateEvent(input: unknown, now: number = Date.now()): ValidationResult {
  // typeof null === 'object', so null needs its own check. Arrays fail on `id` below.
  if (typeof input !== 'object' || input === null) return { ok: false, reason: 'not-object' };
  const e = input as Record<string, unknown>;

  if (!isNonEmptyString(e.id)) return { ok: false, reason: 'id' };

  const ts = e.timestamp;
  if (!isFiniteNumber(ts) || ts < now - MAX_EVENT_AGE_MS || ts > now + MAX_CLOCK_SKEW_MS) {
    return { ok: false, reason: 'timestamp' };
  }

  if (!isMetric(e.metric)) return { ok: false, reason: 'metric' };
  if (!isFiniteNumber(e.value)) return { ok: false, reason: 'value' };
  if (!isCategory(e.category)) return { ok: false, reason: 'category' };
  if (!isNonEmptyString(e.source)) return { ok: false, reason: 'source' };

  // TypeScript can't carry narrowing across separate property checks on a Record, so a cast
  // is unavoidable. It is safe only because every field was checked above.
  return { ok: true, event: e as unknown as AnalyticsEvent };
}
