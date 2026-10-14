import {
  INVALID_REASONS,
  validateEvent,
  type AnalyticsEvent,
  type InvalidReason,
} from '@rta/shared';

/** Running totals of rejected events. Mutated in place to avoid allocating per batch. */
export interface InvalidCounts {
  total: number;
  byReason: Record<InvalidReason, number>;
}

export function createInvalidCounts(): InvalidCounts {
  return {
    total: 0,
    byReason: Object.fromEntries(INVALID_REASONS.map((r) => [r, 0])) as Record<
      InvalidReason,
      number
    >,
  };
}

/**
 * Validates every event in a batch. Returns the valid ones (same objects, not copies) and adds
 * rejections to `invalid`.
 *
 * @param now Read once per batch by the caller, not once per event.
 */
export function validateEvents(
  events: readonly unknown[],
  now: number,
  invalid: InvalidCounts,
): AnalyticsEvent[] {
  const valid: AnalyticsEvent[] = [];
  for (const event of events) {
    const result = validateEvent(event, now);
    if (result.ok) {
      valid.push(result.event);
    } else {
      invalid.total++;
      invalid.byReason[result.reason]++;
    }
  }
  return valid;
}
