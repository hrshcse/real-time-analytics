import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const NOW = 1_700_000_000_000;
const event = (i: number) => ({
  id: `e${i}`,
  timestamp: NOW - 10,
  metric: 'cpu',
  value: i,
  category: 'system',
  source: 'api-01',
});
const batch = (seq: number, events: unknown[], serverDropped = 0) => ({
  type: 'batch',
  seq,
  sentAt: NOW,
  serverDropped,
  events,
});
const hello = { type: 'hello', serverTime: NOW, rate: 1000, tickMs: 50, running: true };

let conn: Connection;
let clock: number;
const latest = () => FakeWebSocket.instances.at(-1)!;

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  clock = NOW;
  conn = createConnection('ws://test', {
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    now: () => clock,
    publishIntervalMs: 250,
  });
});

afterEach(() => {
  conn.disconnect();
  vi.useRealTimers();
});

/** Advance fake timers and the injected clock together. */
function tick(ms: number) {
  clock += ms;
  vi.advanceTimersByTime(ms);
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

  it('failed connect (server down) ends in disconnected', () => {
    conn.connect();
    latest().serverClose(1006);
    expect(conn.getSnapshot().status).toBe('disconnected');
  });

  it('connect() twice does not open a second socket', () => {
    conn.connect();
    conn.connect();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

describe('StrictMode-style connect → disconnect → connect', () => {
  it("ignores the old socket's late close so the new connection stays connected", () => {
    conn.connect();
    const first = latest();
    conn.disconnect();
    conn.connect();
    const second = latest();
    second.serverOpen();

    first.serverClose(1000, '', true); // arrives late
    expect(conn.getSnapshot().status).toBe('connected');
    expect(second).not.toBe(first);
  });

  it('closes a CONNECTING socket only once it opens (avoids the browser warning)', () => {
    conn.connect();
    const first = latest();
    conn.disconnect();
    expect(first.closeCalls).toHaveLength(0);
    first.serverOpen();
    expect(first.closeCalls).toEqual([{ code: 1000, reason: 'Client disconnect' }]);
  });

  it('closes an OPEN socket immediately with code 1000', () => {
    conn.connect();
    latest().serverOpen();
    conn.disconnect();
    expect(latest().closeCalls).toEqual([{ code: 1000, reason: 'Client disconnect' }]);
    expect(conn.getSnapshot().status).toBe('disconnected');
  });
});

describe('message handling', () => {
  beforeEach(() => {
    conn.connect();
    latest().serverOpen();
    latest().serverSend(hello);
  });

  it('counts valid events and computes events/sec', () => {
    latest().serverSend(batch(0, [event(1), event(2)]));
    tick(250);
    latest().serverSend(batch(1, [event(3), event(4)]));
    tick(250);
    const { stats } = conn.getSnapshot();
    expect(stats.totalEvents).toBe(4);
    expect(stats.eventsPerSec).toBe(8); // 2 events per 250 ms
  });

  it('counts invalid events by reason', () => {
    const bad = { ...event(1), value: 'NaN' };
    latest().serverSend(batch(0, [event(0), bad, { ...event(2), metric: 'nope' }]));
    tick(250);
    const { stats } = conn.getSnapshot();
    expect(stats.totalEvents).toBe(1);
    expect(stats.invalidEvents).toBe(2);
    expect(stats.invalidByReason.value).toBe(1);
    expect(stats.invalidByReason.metric).toBe(1);
  });

  it('counts malformed frames without throwing', () => {
    latest().serverSend('{"type":"batch","events":[{"id":"trunc');
    latest().serverSend('42');
    latest().serverSend({ type: 'batch', seq: 0, events: 'not-an-array' });
    latest().serverSend({ type: 'mystery' });
    tick(250);
    expect(conn.getSnapshot().stats.malformedFrames).toBe(4);
  });

  it('detects missed frames from seq gaps and skips duplicates', () => {
    latest().serverSend(batch(0, [event(0)]));
    latest().serverSend(batch(3, [event(1)])); // 1 and 2 missing
    latest().serverSend(batch(3, [event(2)])); // duplicate
    tick(250);
    const { stats } = conn.getSnapshot();
    expect(stats.missedFrames).toBe(2);
    expect(stats.duplicateFrames).toBe(1);
    expect(stats.totalEvents).toBe(2);
  });

  it('tracks serverDropped from the latest batch', () => {
    latest().serverSend(batch(0, [], 5));
    tick(250);
    expect(conn.getSnapshot().stats.serverDropped).toBe(5);
  });

  it('applies hello and status to server state', () => {
    expect(conn.getSnapshot().server).toMatchObject({ rate: 1000, running: true, tickMs: 50 });
    latest().serverSend({
      type: 'status',
      running: false,
      rate: 50000,
      baseRate: 10000,
      burstEndsAt: NOW + 5000,
    });
    expect(conn.getSnapshot().server).toEqual({
      running: false,
      rate: 50000,
      baseRate: 10000,
      burstEndsAt: NOW + 5000,
      tickMs: 50,
    });
  });

  it('heartbeat updates lastMessageAt', () => {
    tick(1000);
    latest().serverSend({ type: 'heartbeat', serverTime: NOW });
    tick(250);
    expect(conn.getSnapshot().stats.lastMessageAt).toBe(NOW + 1000);
  });
});

describe('publishing (the render-rate guarantee)', () => {
  it('notifies at most once per publish interval, however many frames arrive', () => {
    conn.connect();
    latest().serverOpen();
    const listener = vi.fn();
    conn.subscribe(listener);

    for (let i = 0; i < 200; i++) latest().serverSend(batch(i, [event(i)])); // 1 s at a 5 ms tick
    expect(listener).not.toHaveBeenCalled(); // nothing published mid-burst

    tick(1000);
    expect(listener.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('getSnapshot returns the same object between publishes', () => {
    conn.connect();
    latest().serverOpen();
    const a = conn.getSnapshot();
    latest().serverSend(batch(0, [event(0)]));
    expect(conn.getSnapshot()).toBe(a);
    tick(250);
    expect(conn.getSnapshot()).not.toBe(a);
  });

  it('stops its timer after disconnect', () => {
    conn.connect();
    latest().serverOpen();
    conn.disconnect();
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
