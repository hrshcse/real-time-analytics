import { describe, expect, it } from 'vitest';
import { MAX_CLOCK_SKEW_MS, MAX_EVENT_AGE_MS, validateEvent } from './validate';

const NOW = 1_700_000_000_000;
const valid = {
  id: 'e1',
  timestamp: NOW,
  metric: 'cpu',
  value: 42,
  category: 'system',
  source: 'api-01',
};
const withField = (patch: Record<string, unknown>) => ({ ...valid, ...patch });
const without = (key: keyof typeof valid) => {
  const copy: Record<string, unknown> = { ...valid };
  delete copy[key];
  return copy;
};

describe('validateEvent', () => {
  it('accepts a valid event and returns the same object (no copy)', () => {
    const result = validateEvent(valid, NOW);
    expect(result).toEqual({ ok: true, event: valid });
    expect(result.ok && result.event).toBe(valid);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['string', 'cpu'],
    ['number', 42],
  ])('rejects non-object input: %s', (_label, input) => {
    expect(validateEvent(input, NOW)).toEqual({ ok: false, reason: 'not-object' });
  });

  it('rejects an array (fails on id)', () => {
    expect(validateEvent([], NOW)).toEqual({ ok: false, reason: 'id' });
  });

  describe('server fault injection cases', () => {
    it('missing timestamp', () => {
      expect(validateEvent(without('timestamp'), NOW)).toEqual({ ok: false, reason: 'timestamp' });
    });
    it('value "NaN" (string)', () => {
      expect(validateEvent(withField({ value: 'NaN' }), NOW)).toEqual({
        ok: false,
        reason: 'value',
      });
    });
    it('unknown metric', () => {
      expect(validateEvent(withField({ metric: 'unknown-metric' }), NOW)).toEqual({
        ok: false,
        reason: 'metric',
      });
    });
    it('id null', () => {
      expect(validateEvent(withField({ id: null }), NOW)).toEqual({ ok: false, reason: 'id' });
    });
  });

  it.each([
    ['empty string', ''],
    ['number', 1],
  ])('rejects id: %s', (_label, id) => {
    expect(validateEvent(withField({ id }), NOW)).toEqual({ ok: false, reason: 'id' });
  });

  describe('timestamp', () => {
    it.each([
      ['string', String(NOW)],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['older than max age', NOW - MAX_EVENT_AGE_MS - 1],
      ['further ahead than max skew', NOW + MAX_CLOCK_SKEW_MS + 1],
    ])('rejects %s', (_label, timestamp) => {
      expect(validateEvent(withField({ timestamp }), NOW)).toEqual({
        ok: false,
        reason: 'timestamp',
      });
    });

    it.each([
      ['exactly max age', NOW - MAX_EVENT_AGE_MS],
      ['exactly max skew', NOW + MAX_CLOCK_SKEW_MS],
    ])('accepts boundary: %s', (_label, timestamp) => {
      expect(validateEvent(withField({ timestamp }), NOW).ok).toBe(true);
    });
  });

  it.each([
    ['numeric string', '42'],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['null', null],
  ])('rejects value: %s', (_label, value) => {
    expect(validateEvent(withField({ value }), NOW)).toEqual({ ok: false, reason: 'value' });
  });

  it('accepts value 0 and negatives (range checks are not the validator’s job)', () => {
    expect(validateEvent(withField({ value: 0 }), NOW).ok).toBe(true);
    expect(validateEvent(withField({ value: -5 }), NOW).ok).toBe(true);
  });

  it.each([['app'], [''], [undefined]])('rejects category: %s', (category) => {
    expect(validateEvent(withField({ category }), NOW)).toEqual({
      ok: false,
      reason: 'category',
    });
  });

  it.each([[''], [42]])('rejects source: %s', (source) => {
    expect(validateEvent(withField({ source }), NOW)).toEqual({ ok: false, reason: 'source' });
  });

  it('reports the first failing field', () => {
    expect(validateEvent({ id: '', timestamp: 'x' }, NOW)).toEqual({ ok: false, reason: 'id' });
  });
});
