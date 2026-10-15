import { describe, expect, it } from 'vitest';
import { createTokenBucket } from './rateLimit';

describe('createTokenBucket', () => {
  it('allows a burst, then refills at the rate', () => {
    let t = 0;
    const b = createTokenBucket(10, 10, () => t);
    for (let i = 0; i < 10; i++) expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
    t = 100; // 0.1 s → 1 token
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
    t = 10_000; // long idle: capped at burst
    for (let i = 0; i < 10; i++) expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
  });
});
