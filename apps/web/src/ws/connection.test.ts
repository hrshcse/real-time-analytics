import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeWorker, type FakeWorker } from '../test/fakeWorker';
import type { MainToWorker, WorkerToMain } from '../workers/contract';
import { startWorkerRuntime } from '../workers/runtime';
import { createConnection, type Connection } from './connection';

/** Minimal controllable stand-in for the browser WebSocket. */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  closeCalls: Array<{ code?: number; reason?: string }> = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((e: { code: number; reason: string; wasClean: boolean }) => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close(code?: number, reason?: string) {
    this.closeCalls.push({ code, reason });
    this.readyState = FakeWebSocket.CLOSING;
  }

  // ---- test helpers ----
  serverOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  serverSend(message: unknown) {
    this.onmessage?.({ data: typeof message === 'string' ? message : JSON.stringify(message) });
  }
  serverClose(code = 1006, reason = '', wasClean = false) {
    this.readyState = FakeWebSocket.CLOSED;
    this.onerror?.();
    this.onclose?.({ code, reason, wasClean });
  }
}

const T0 = 1_700_000_000_000;
let clock: number;
let n = 0;
const event = (over: Record<string, unknown> = {}) => ({
  id: `e${n++}`,
  timestamp: clock - 10,
  metric: 'cpu',
  value: 1,
  category: 'system',
  source: 'api-01',
  ...over,
});
const batch = (seq: number, events: unknown[], serverDropped = 0) => ({
  type: 'batch',
  seq,
  sentAt: clock,
  serverDropped,
  events,
});
const hello = { type: 'hello', serverTime: T0, rate: 1000, tickMs: 50, running: true };

let conn: Connection;
let workers: Array<FakeWorker<MainToWorker, WorkerToMain>>;
const latest = () => FakeWebSocket.instances.at(-1)!;
const latestWorker = () => workers.at(-1)!;

function setup(bufferMs = 50) {
  conn = createConnection('ws://test', {
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    now: () => clock,
    publishIntervalMs: 250,
    buffer: { maxWaitMs: bufferMs },
    // The REAL processor + runtime, inside a fake worker (structuredClone + async delivery).
    createWorker: () => {
      const w = createFakeWorker<MainToWorker, WorkerToMain>((scope) =>
        startWorkerRuntime(scope, { now: () => clock, summaryIntervalMs: 250 }),
      );
      workers.push(w);
      return w.asWorker();
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  workers = [];
  clock = T0;
  setup();
});

afterEach(() => {
  conn.disconnect();
  vi.useRealTimers();
});

/** Advance fake timers and the injected clock together. */
function tick(ms: number) {
  for (let i = 0; i < ms; i += 50) {
    clock += 50;
    vi.advanceTimersByTime(50);
  }
}

function openWithHello() {
  conn.connect();
  latest().serverOpen();
  latest().serverSend(hello);
}

describe('status transitions', () => {
  it('disconnected → connecting → connected', () => {
    expect(conn.getSnapshot().status).toBe('disconnected');
    conn.connect();
    expect(conn.getSnapshot().status).toBe('connecting');
    latest().serverOpen();
    expect(conn.getSnapshot().status).toBe('connected');
  });

  it('server close → disconnected with the close code', () => {
    conn.connect();
    latest().serverOpen();
    latest().serverClose(1006);
    const snap = conn.getSnapshot();
    expect(snap.status).toBe('disconnected');
    expect(snap.lastClose).toEqual({ code: 1006, reason: '', wasClean: false });
  });

  it('connect() twice does not open a second socket or worker', () => {
    conn.connect();
    conn.connect();
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(workers).toHaveLength(1);
  });
});

describe('StrictMode-style connect → disconnect → connect', () => {
  it("ignores the old socket's late close so the new connection stays connected", () => {
    conn.connect();
    const first = latest();
    conn.disconnect();
    conn.connect();
    latest().serverOpen();
    first.serverClose(1000, '', true); // arrives late
    expect(conn.getSnapshot().status).toBe('connected');
  });

  it('terminates the first worker and starts a fresh one', () => {
    conn.connect();
    conn.disconnect();
    conn.connect();
    expect(workers).toHaveLength(2);
    expect(workers[0]!.terminated).toBe(true);
    expect(workers[1]!.terminated).toBe(false);
  });

  it('closes a CONNECTING socket only once it opens', () => {
    conn.connect();
    const first = latest();
    conn.disconnect();
    expect(first.closeCalls).toHaveLength(0);
    first.serverOpen();
    expect(first.closeCalls).toEqual([{ code: 1000, reason: 'Client disconnect' }]);
  });
});

describe('main thread → worker pipeline', () => {
  it('counts valid and invalid events in the worker and publishes them', () => {
    openWithHello();
    latest().serverSend(batch(0, [event(), event(), event({ value: 'NaN' })]));
    tick(1000);
    const { stats } = conn.getSnapshot();
    expect(stats.totalEvents).toBe(2);
    expect(stats.invalidEvents).toBe(1);
    expect(stats.invalidByReason.value).toBe(1);
    expect(stats.processing).not.toBeNull();
  });

  it('never parses batch frames on the main thread: truncated ones are counted by the worker', () => {
    openWithHello();
    const before = latestWorker().postedToWorker;
    latest().serverSend('{"type":"batch","events":[{"id":"trunc');
    tick(50);
    expect(latestWorker().postedToWorker - before).toBe(1); // forwarded, not parsed here
    latest().serverSend('not json at all'); // control path → main thread counts it
    tick(1000);
    expect(conn.getSnapshot().stats.malformedFrames).toBe(2);
  });

  it('buffers frames: many frames within maxWaitMs → one post to the worker', () => {
    openWithHello();
    const before = latestWorker().postedToWorker; // the reset from hello
    for (let i = 0; i < 10; i++) latest().serverSend(batch(i, [event()]));
    tick(50);
    expect(latestWorker().postedToWorker - before).toBe(1);
    tick(1000);
    expect(conn.getSnapshot().stats.totalEvents).toBe(10);
  });

  it('maxWaitMs 0 → one post per frame', () => {
    conn.disconnect();
    setup(0);
    openWithHello();
    const before = latestWorker().postedToWorker;
    for (let i = 0; i < 10; i++) latest().serverSend(batch(i, [event()]));
    expect(latestWorker().postedToWorker - before).toBe(10);
  });

  it('flushes buffered frames before reset, so a reconnect does not count false gaps', () => {
    openWithHello();
    latest().serverSend(batch(0, [event()]));
    latest().serverSend(batch(1, [event()]));
    latest().serverClose(1006); // flush, worker survives
    conn.connect();
    latest().serverOpen();
    latest().serverSend(hello); // reset
    latest().serverSend(batch(0, [event()])); // seq restarts
    tick(1000);
    const { stats } = conn.getSnapshot();
    expect(stats.totalEvents).toBe(3); // totals carried over: same worker (D16)
    expect(stats.missedFrames).toBe(0);
    expect(stats.duplicateFrames).toBe(0);
    expect(workers).toHaveLength(1);
  });

  it('disconnect() drops buffered frames and counts them (D13)', () => {
    openWithHello();
    latest().serverSend(batch(0, [event()]));
    latest().serverSend(batch(1, [event()]));
    conn.disconnect();
    expect(conn.getSnapshot().stats.droppedOnDisconnect).toBe(2);
    expect(latestWorker().terminated).toBe(true);
  });

  it('publishes the latest closed 1 s bucket per metric', () => {
    openWithHello();
    latest().serverSend(batch(0, [event({ value: 10 }), event({ value: 30 })]));
    tick(2000);
    expect(conn.getSnapshot().latest[1000]?.cpu).toMatchObject({ count: 2, min: 10, max: 30 });
  });

  it('surfaces worker errors without disconnecting', () => {
    openWithHello();
    latestWorker().crash('boom');
    tick(50);
    const snap = conn.getSnapshot();
    expect(snap.workerError).toBe('boom');
    expect(snap.status).toBe('connected');
  });

  it('applies hello and status to server state', () => {
    openWithHello();
    expect(conn.getSnapshot().server).toMatchObject({ rate: 1000, running: true, tickMs: 50 });
    latest().serverSend({
      type: 'status',
      running: false,
      rate: 50000,
      baseRate: 10000,
      burstEndsAt: T0 + 5000,
    });
    expect(conn.getSnapshot().server).toMatchObject({ running: false, rate: 50000, tickMs: 50 });
  });
});

describe('publishing (the render-rate guarantee)', () => {
  it('notifies at most ~4×/sec however many frames arrive', () => {
    openWithHello();
    const listener = vi.fn();
    conn.subscribe(listener);
    for (let i = 0; i < 200; i++) latest().serverSend(batch(i, [event()]));
    expect(listener).not.toHaveBeenCalled();
    tick(1000);
    expect(listener.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('getSnapshot returns the same object between publishes', () => {
    openWithHello();
    const a = conn.getSnapshot();
    latest().serverSend(batch(0, [event()]));
    expect(conn.getSnapshot()).toBe(a);
  });

  it('leaves no timers behind after disconnect (publish, buffer, worker)', () => {
    openWithHello();
    latest().serverSend(batch(0, [event()])); // buffer timer pending
    conn.disconnect();
    vi.advanceTimersByTime(1); // let already-scheduled (now no-op) fake deliveries drain
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('send', () => {
  it('returns false and sends nothing when not open', () => {
    conn.connect();
    expect(conn.send({ type: 'stop' })).toBe(false);
    expect(latest().sent).toEqual([]);
  });

  it('serialises the message when open', () => {
    conn.connect();
    latest().serverOpen();
    expect(conn.send({ type: 'setRate', rate: 10000 })).toBe(true);
    expect(latest().sent).toEqual(['{"type":"setRate","rate":10000}']);
  });
});

describe('chart and grid channels', () => {
  it('replays the current view to a fresh worker and routes chart data to its own store', () => {
    conn.setView({
      rangeMs: 60_000,
      metrics: ['cpu'],
      resolution: 'raw',
      algorithm: 'none',
      maxPoints: 100,
    });
    openWithHello(); // worker created AFTER setView: must still get the view
    const listener = vi.fn();
    conn.subscribe(listener);
    latest().serverSend(batch(0, [event({ value: 7 })]));
    tick(500);
    expect(conn.chart.get()?.series.cpu?.y).toEqual([7]);
  });

  it('answers a grid query with a page in the grid store', () => {
    openWithHello();
    latest().serverSend(batch(0, [event(), event()]));
    tick(100); // frames reach the worker
    conn.queryGrid(
      { sort: { key: 'timestamp', dir: 'desc' }, metrics: null, search: '', offset: 0, limit: 10 },
      true,
    );
    tick(50);
    expect(conn.grid.get()?.total).toBe(2);
  });
});

describe('backpressure (WBS 10)', () => {
  function setupBp(maxInFlightFrames: number) {
    conn.disconnect();
    conn = createConnection('ws://test', {
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      now: () => clock,
      buffer: { maxWaitMs: 0, maxQueuedFrames: 5 },
      maxInFlightFrames,
      scheduleFrame: (cb) => setTimeout(cb, 16) as unknown as number,
      cancelFrame: (id) => clearTimeout(id),
      // A worker that never acks: the slowest possible consumer.
      createWorker: () => {
        const w = createFakeWorker<MainToWorker, WorkerToMain>(() => {});
        workers.push(w);
        return w.asWorker();
      },
    });
    openWithHello();
  }

  it('stops posting once maxInFlightFrames are unacknowledged, then drops the oldest', () => {
    setupBp(3);
    const posted = () => latestWorker().postedToWorker;
    const start = posted(); // the reset
    for (let i = 0; i < 20; i++) latest().serverSend(batch(i, [event()]));
    expect(posted() - start).toBe(3); // 3 frames in flight, the rest held
    tick(300); // 250 ms sampling tick + one frame to publish
    const { stats } = conn.getSnapshot();
    expect(stats.inFlightFrames).toBe(3);
    expect(stats.backpressureDropped).toBe(12); // 17 held, cap 5 → 12 oldest dropped
  });

  it('with backpressure off, everything is posted (unbounded queue in the worker)', () => {
    setupBp(3);
    conn.setBackpressure(false);
    const start = latestWorker().postedToWorker;
    for (let i = 0; i < 20; i++) latest().serverSend(batch(i, [event()]));
    expect(latestWorker().postedToWorker - start).toBe(20);
  });
});

describe('render batching (WBS 10.4)', () => {
  it("'immediate' publishes on every socket message; 'raf' at most once per tick", () => {
    openWithHello();
    const listener = vi.fn();
    conn.subscribe(listener);
    conn.setPublishMode('immediate');
    for (let i = 0; i < 20; i++) latest().serverSend(batch(i, [event()]));
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(20);

    listener.mockClear();
    conn.setPublishMode('raf');
    for (let i = 20; i < 40; i++) latest().serverSend(batch(i, [event()]));
    tick(250);
    expect(listener.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
