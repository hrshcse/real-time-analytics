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

describe('backpressure', () => {
  it('holds frames while the budget is 0, then flushes on demand', () => {
    let open = false;
    const b = createFrameBuffer({
      maxWaitMs: 10,
      budget: () => (open ? Infinity : 0),
      onFlush: (f) => flushed.push(f),
    });
    b.push('a');
    vi.advanceTimersByTime(20);
    expect(flushed).toEqual([]);
    expect(b.size).toBe(1);
    open = true;
    b.flush();
    expect(flushed).toEqual([['a']]);
  });

  it('drops the OLDEST frames beyond maxQueuedFrames and counts them', () => {
    const b = createFrameBuffer({
      maxQueuedFrames: 3,
      maxFrames: 100,
      budget: () => 0,
      onFlush: (f) => flushed.push(f),
    });
    for (const f of ['1', '2', '3', '4', '5']) b.push(f);
    expect(b.size).toBe(3);
    expect(b.dropped).toBe(2);
    expect(b.clear()).toBe(3);
  });

  it('keeps the newest frames after overflow', () => {
    let open = false;
    const b = createFrameBuffer({
      maxQueuedFrames: 2,
      maxFrames: 100,
      budget: () => (open ? Infinity : 0),
      onFlush: (f) => flushed.push(f),
    });
    for (const f of ['1', '2', '3']) b.push(f);
    open = true;
    b.flush();
    expect(flushed).toEqual([['2', '3']]);
  });
});

describe('budget', () => {
  it('sends at most budget() frames per flush, oldest first, and holds the rest', () => {
    let budget = 2;
    const b = createFrameBuffer({
      maxFrames: 100,
      maxWaitMs: 1000,
      budget: () => budget,
      onFlush: (f) => flushed.push(f),
    });
    for (const f of ['1', '2', '3', '4', '5']) b.push(f);
    b.flush();
    expect(flushed).toEqual([['1', '2']]);
    expect(b.size).toBe(3);
    budget = 10;
    b.flush();
    expect(flushed).toEqual([
      ['1', '2'],
      ['3', '4', '5'],
    ]);
  });
});
