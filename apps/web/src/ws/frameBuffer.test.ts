import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFrameBuffer } from './frameBuffer';

let flushed: string[][];
const make = (opts: { maxFrames?: number; maxBytes?: number; maxWaitMs?: number } = {}) =>
  createFrameBuffer({ ...opts, onFlush: (f) => flushed.push(f) });

beforeEach(() => {
  vi.useFakeTimers();
  flushed = [];
});
afterEach(() => vi.useRealTimers());

describe('createFrameBuffer', () => {
  it('flushes on maxFrames', () => {
    const b = make({ maxFrames: 3, maxWaitMs: 1000 });
    b.push('a');
    b.push('b');
    expect(flushed).toEqual([]);
    b.push('c');
    expect(flushed).toEqual([['a', 'b', 'c']]);
  });

  it('flushes on maxBytes', () => {
    const b = make({ maxBytes: 5, maxWaitMs: 1000 });
    b.push('abc');
    expect(flushed).toEqual([]);
    b.push('def');
    expect(flushed).toEqual([['abc', 'def']]);
  });

  it('flushes maxWaitMs after the FIRST frame, not the last', () => {
    const b = make({ maxWaitMs: 50 });
    b.push('a');
    vi.advanceTimersByTime(30);
    b.push('b'); // must not restart the timer
    vi.advanceTimersByTime(20);
    expect(flushed).toEqual([['a', 'b']]);
  });

  it('starts no timer while empty (idle stream costs nothing)', () => {
    make({ maxWaitMs: 50 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels the pending timer when a size flush happens', () => {
    const b = make({ maxFrames: 2, maxWaitMs: 50 });
    b.push('a');
    b.push('b');
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(100);
    expect(flushed).toHaveLength(1);
  });

  it('maxWaitMs 0 = no buffering, one flush per frame', () => {
    const b = make({ maxWaitMs: 0 });
    b.push('a');
    b.push('b');
    expect(flushed).toEqual([['a'], ['b']]);
    expect(b.flushes).toBe(2);
  });

  it('clear() drops waiting frames, reports how many, and cancels the timer', () => {
    const b = make({ maxWaitMs: 50 });
    b.push('a');
    b.push('b');
    expect(b.clear()).toBe(2);
    vi.advanceTimersByTime(100);
    expect(flushed).toEqual([]);
  });

  it('manual flush() is a no-op when empty', () => {
    const b = make();
    b.flush();
    expect(flushed).toEqual([]);
    expect(b.flushes).toBe(0);
  });
});
