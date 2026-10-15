import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeWorker } from '../test/fakeWorker';
import type { MainToWorker, WorkerToMain } from './contract';
import { createProcessor } from './processor';
import { startWorkerRuntime } from './runtime';

const T0 = 1_700_000_000_000; // aligned to a second
let clock = T0;
let n = 0;

const event = (over: Record<string, unknown> = {}) => ({
  id: `e${n++}`,
  timestamp: clock - 10,
  metric: 'cpu',
  value: 50,
  category: 'system',
  source: 'api-01',
  ...over,
});
const frame = (seq: number, events: unknown[], serverDropped = 0) =>
  JSON.stringify({ type: 'batch', seq, sentAt: clock, serverDropped, events });

const make = () =>
  createProcessor({
    now: () => clock,
    perfNow: (() => {
      let t = 0;
      return () => (t += 0.5); // each call advances 0.5 ms → 0.5 ms per batch
    })(),
    aggregator: { graceMs: 0 },
  });

beforeEach(() => {
  clock = T0 + 500;
});

describe('createProcessor', () => {
  it('parses, validates and counts batch frames', () => {
    const p = make();
    p.handle({
      type: 'frames',
      raw: [frame(0, [event(), event({ value: 'NaN' })]), frame(1, [event()])],
    });
    const s = p.tick().summary!;
    expect(s).toMatchObject({
      totalEvents: 2,
      batchFrames: 2,
      invalidEvents: 1,
      malformedFrames: 0,
      missedFrames: 0,
    });
    expect(s.invalidByReason.value).toBe(1);
    expect(s.processing).toEqual({ batches: 2, totalMs: 1, maxMs: 0.5 });
  });

  it('counts truncated JSON as malformed without throwing', () => {
    const p = make();
    p.handle({ type: 'frames', raw: ['{"type":"batch","events":[{"id":"tr'] });
    expect(p.tick().summary!.malformedFrames).toBe(1);
  });

  it('tracks seq gaps and duplicates; reset restarts seq for a new connection', () => {
    const p = make();
    p.handle({ type: 'frames', raw: [frame(0, []), frame(3, []), frame(3, [])] });
    expect(p.tick().summary).toMatchObject({ missedFrames: 2, duplicateFrames: 1 });
    p.handle({ type: 'reset' });
    p.handle({ type: 'frames', raw: [frame(0, [event()])] });
    expect(p.tick().summary).toMatchObject({ missedFrames: 2, duplicateFrames: 1, totalEvents: 1 });
  });

  it('takes serverDropped from the latest batch and clears it on reset', () => {
    const p = make();
    p.handle({ type: 'frames', raw: [frame(0, [], 4)] });
    expect(p.tick().summary!.serverDropped).toBe(4);
    p.handle({ type: 'reset' });
    expect(p.tick().summary!.serverDropped).toBe(0);
  });

  it('returns null from tick() when nothing changed', () => {
    const p = make();
    p.handle({ type: 'frames', raw: [frame(0, [])] });
    expect(p.tick().summary).not.toBeNull();
    expect(p.tick().summary).toBeNull();
  });

  it('publishes the latest closed 1 s bucket once the second has passed', () => {
    const p = make();
    p.handle({ type: 'frames', raw: [frame(0, [event({ value: 10 }), event({ value: 30 })])] });
    expect(p.tick().summary!.latest[1000]!.cpu).toBeUndefined(); // second still open
    clock = T0 + 1000;
    const s = p.tick().summary!;
    expect(s.latest[1000]!.cpu).toMatchObject({ start: T0, count: 2, avg: 20, min: 10, max: 30 });
  });

  it('measures events/sec in the worker', () => {
    const p = make();
    p.tick(); // first sample at 0 events
    clock += 500;
    p.handle({
      type: 'frames',
      raw: [
        frame(
          0,
          Array.from({ length: 50 }, () => event()),
        ),
      ],
    });
    expect(p.tick().summary!.eventsPerSec).toBe(100); // 50 events in 0.5 s
  });

  it('resets processing time after each summary', () => {
    const p = make();
    p.handle({ type: 'frames', raw: [frame(0, [])] });
    p.tick();
    p.handle({ type: 'frames', raw: [frame(1, [])] });
    expect(p.tick().summary!.processing.batches).toBe(1);
  });
});

describe('startWorkerRuntime (through the fake worker)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends a summary on the interval after frames arrive, and nothing while idle', () => {
    const worker = createFakeWorker<MainToWorker, WorkerToMain>((scope) =>
      startWorkerRuntime(scope, { now: () => clock, summaryIntervalMs: 250 }),
    );
    const received: WorkerToMain[] = [];
    worker.onmessage = (e) => {
      if (e.data.type === 'summary') received.push(e.data);
    };

    worker.postMessage({ type: 'frames', raw: [frame(0, [event()])] });
    vi.advanceTimersByTime(250);
    vi.advanceTimersByTime(1); // deliver the summary (0 ms timeouts fire at 1 ms under fake timers)
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ type: 'summary', summary: { totalEvents: 1 } });

    vi.advanceTimersByTime(1000); // idle, same clock → no change
    expect(received).toHaveLength(1);
    worker.terminate();
  });
});

describe('chart view', () => {
  it('builds downsampled bucket series once buckets close, and only when they change', () => {
    const p = make();
    p.handle({
      type: 'view',
      view: {
        rangeMs: 60_000,
        metrics: ['cpu'],
        resolution: 'bucket',
        algorithm: 'lttb',
        maxPoints: 3,
      },
    });
    // 10 seconds of data, one bucket per second
    for (let s = 0; s < 10; s++) {
      clock = T0 + s * 1000 + 100;
      p.handle({ type: 'frames', raw: [frame(s, [event({ value: s })])] });
    }
    clock = T0 + 10_000;
    const { chart } = p.tick();
    expect(chart?.inputPoints).toBe(10);
    expect(chart?.outputPoints).toBe(3);
    expect(chart?.series.cpu?.t[0]).toBe(T0);
    expect(chart?.series.memory).toBeUndefined();
    expect(p.tick().chart).toBeNull(); // nothing new closed
  });

  it('raw resolution uses individual events', () => {
    const p = make();
    p.handle({
      type: 'view',
      view: {
        rangeMs: 60_000,
        metrics: ['cpu'],
        resolution: 'raw',
        algorithm: 'none',
        maxPoints: 100,
      },
    });
    p.handle({ type: 'frames', raw: [frame(0, [event({ value: 1 }), event({ value: 2 })])] });
    const { chart } = p.tick();
    expect(chart?.series.cpu?.y).toEqual([1, 2]);
  });
});

describe('grid', () => {
  it('answers a query immediately and re-slices without rebuilding on scroll', () => {
    const p = make();
    p.handle({
      type: 'frames',
      raw: [
        frame(
          0,
          Array.from({ length: 10 }, (_, i) => event({ value: i })),
        ),
      ],
    });
    p.handle({
      type: 'grid',
      live: true,
      query: {
        sort: { key: 'value', dir: 'desc' },
        metrics: null,
        search: '',
        offset: 0,
        limit: 3,
      },
    });
    const page = p.takeGridPage()!;
    expect(page.total).toBe(10);
    expect(page.rows.map((r) => r.value)).toEqual([9, 8, 7]);
    expect(p.takeGridPage()).toBeNull(); // owed once

    p.handle({
      type: 'grid',
      live: true,
      query: {
        sort: { key: 'value', dir: 'desc' },
        metrics: null,
        search: '',
        offset: 3,
        limit: 3,
      },
    });
    expect(p.takeGridPage()!.rows.map((r) => r.value)).toEqual([6, 5, 4]);
  });

  it('refreshes live at most every gridRefreshMs, and not at all when paused', () => {
    const p = make();
    const q = {
      sort: { key: 'timestamp' as const, dir: 'desc' as const },
      metrics: null,
      search: '',
      offset: 0,
      limit: 5,
    };
    p.handle({ type: 'grid', live: true, query: q });
    p.takeGridPage();
    p.handle({ type: 'frames', raw: [frame(0, [event()])] });
    expect(p.tick().grid).toBeNull(); // < 1 s since last build
    clock += 1000;
    expect(p.tick().grid?.total).toBe(1);

    p.handle({ type: 'grid', live: false, query: q });
    p.takeGridPage();
    p.handle({ type: 'frames', raw: [frame(1, [event()])] });
    clock += 2000;
    expect(p.tick().grid).toBeNull();
  });
});

describe('backpressure support', () => {
  it('reports the newest processed event time', () => {
    const p = make();
    p.handle({
      type: 'frames',
      raw: [frame(0, [event({ timestamp: clock - 30 }), event({ timestamp: clock - 5 })])],
    });
    expect(p.tick().summary!.newestEventAt).toBe(clock - 5);
  });

  it('simulatedWorkMs makes each frame take at least that long', () => {
    let t = 0;
    const p = createProcessor({
      now: () => clock,
      perfNow: () => (t += 1),
      aggregator: { graceMs: 0 },
    });
    p.handle({ type: 'config', simulatedWorkMs: 20 });
    p.handle({ type: 'frames', raw: [frame(0, [event()])] });
    expect(p.tick().summary!.processing.maxMs).toBeGreaterThanOrEqual(20);
  });
});

describe('startWorkerRuntime acks', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('acks every frames message with its frame count', () => {
    const worker = createFakeWorker<MainToWorker, WorkerToMain>((scope) =>
      startWorkerRuntime(scope, { now: () => clock }),
    );
    const got: WorkerToMain[] = [];
    worker.onmessage = (e) => got.push(e.data);
    worker.postMessage({ type: 'frames', raw: [frame(0, []), frame(1, [])] });
    vi.advanceTimersByTime(2);
    expect(got).toContainEqual({ type: 'ack', frames: 2 });
    worker.terminate();
  });
});
