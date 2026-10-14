import { describe, expect, it } from 'vitest';
import { createInvalidCounts, createSeqTracker, parseServerMessage, validateEvents } from '.';

const NOW = 1_700_000_000_000;
const event = (i: number) => ({
  id: `e${i}`,
  timestamp: NOW - 10,
  metric: 'cpu',
  value: i,
  category: 'system',
  source: 'api-01',
});

describe('parseServerMessage', () => {
  it('parses each known message type', () => {
    expect(parseServerMessage('{"type":"batch","seq":0,"events":[]}')).toMatchObject({
      type: 'batch',
    });
    expect(
      parseServerMessage('{"type":"hello","rate":1,"tickMs":50,"running":true}'),
    ).toMatchObject({
      type: 'hello',
    });
    expect(
      parseServerMessage(
        '{"type":"status","rate":1,"baseRate":1,"running":false,"burstEndsAt":null}',
      ),
    ).toMatchObject({ type: 'status' });
    expect(parseServerMessage('{"type":"heartbeat","serverTime":1}')).toMatchObject({
      type: 'heartbeat',
    });
  });

  it.each([
    ['not a string', 42],
    ['truncated JSON', '{"type":"batch","events":[{"id":"tr'],
    ['JSON primitive', '42'],
    ['null', 'null'],
    ['unknown type', '{"type":"mystery"}'],
    ['batch without seq', '{"type":"batch","events":[]}'],
    ['batch with non-array events', '{"type":"batch","seq":0,"events":"x"}'],
    ['hello missing fields', '{"type":"hello"}'],
  ])('returns null for %s', (_label, raw) => {
    expect(parseServerMessage(raw)).toBeNull();
  });
});

describe('validateEvents', () => {
  it('returns valid events (same objects) and accumulates rejections by reason', () => {
    const good = event(1);
    const invalid = createInvalidCounts();
    const valid = validateEvents([good, { ...event(2), value: 'NaN' }, null], NOW, invalid);
    expect(valid).toEqual([good]);
    expect(valid[0]).toBe(good);
    expect(invalid.total).toBe(2);
    expect(invalid.byReason.value).toBe(1);
    expect(invalid.byReason['not-object']).toBe(1);

    validateEvents([{ ...event(3), metric: 'x' }], NOW, invalid);
    expect(invalid.total).toBe(3); // accumulates across batches
  });
});

describe('createSeqTracker', () => {
  it('counts gaps, skips duplicates, and restarts on reset', () => {
    const seq = createSeqTracker();
    expect(seq.accept(0)).toBe(true);
    expect(seq.accept(3)).toBe(true);
    expect(seq.missed).toBe(2);
    expect(seq.accept(3)).toBe(false);
    expect(seq.duplicates).toBe(1);

    seq.reset();
    expect(seq.accept(0)).toBe(true); // new connection
    expect(seq.missed).toBe(2);
  });
});
