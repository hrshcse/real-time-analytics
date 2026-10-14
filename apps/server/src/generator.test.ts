import { describe, expect, it } from 'vitest';
import { validateEvent } from '@rta/shared';
import { createGenerator, createRateAccumulator } from './generator';

describe('createRateAccumulator', () => {
  it('emits the exact rate over one second at a 50 ms tick', () => {
    const acc = createRateAccumulator();
    let total = 0;
    for (let i = 0; i < 20; i++) total += acc.take(1000, 50);
    expect(total).toBe(1000);
  });

  it('carries fractions so low rates still emit', () => {
    const acc = createRateAccumulator();
    let total = 0;
    for (let i = 0; i < 20; i++) total += acc.take(3, 50); // 0.15 per tick
    expect(total).toBe(3);
  });
});

describe('createGenerator', () => {
  const NOW = 1_700_000_000_000;

  it('produces events that pass the shared validator, with spread timestamps and unique ids', () => {
    const { generate } = createGenerator();
    const events = generate(500, NOW - 50, 50);
    expect(events).toHaveLength(500);
    for (const e of events) expect(validateEvent(e, NOW)).toMatchObject({ ok: true });

    const typed = events as Array<{ id: string; timestamp: number }>;
    expect(new Set(typed.map((e) => e.id)).size).toBe(500);
    for (const e of typed) {
      expect(e.timestamp).toBeGreaterThanOrEqual(NOW - 50);
      expect(e.timestamp).toBeLessThan(NOW);
    }
  });

  it('every injected bad event fails validation when badEventPct is 100', () => {
    const { generate } = createGenerator({ badEventPct: 100 });
    const events = generate(200, NOW - 50, 50);
    const passed = events.filter((e) => validateEvent(e, NOW).ok);
    expect(passed).toHaveLength(0);
  });
});
