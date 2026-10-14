import type { ClientMessage, InvalidReason } from '@rta/shared';
import {
  createInvalidCounts,
  createSeqTracker,
  parseServerMessage,
  validateEvents,
} from '../processing';

/**
 * WebSocket connection — plain TypeScript, no React (WBS 3.1–3.3).
 *
 *   WebSocket ─▶ onmessage ─▶ JSON.parse ─▶ route by type ─▶ counters (plain variables)
 *                                                              │ published every ~250 ms
 *   subscribe(listener) / getSnapshot()  ◀─────────────────────┘
 *
 * React reads it through useSyncExternalStore (see useConnection.ts). Keeping the socket out
 * of React means frame rate (20/sec at 50 ms ticks, 200/sec at 5 ms) never becomes render
 * rate. Parsing and validation live in ../processing so the worker (Phase 2) can reuse them.
 */

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface ServerState {
  running: boolean;
  /** Effective rate including an active burst. */
  rate: number;
  baseRate: number;
  burstEndsAt: number | null;
  tickMs: number;
}

export interface ConnectionStats {
  /** Valid events per second, averaged over the last ~1 s. */
  eventsPerSec: number;
  /** Valid events received since the page loaded. */
  totalEvents: number;
  framesReceived: number;
  /** Frames that were not valid JSON or not a known message shape. */
  malformedFrames: number;
  /** Events that failed validateEvent, by reason. */
  invalidEvents: number;
  invalidByReason: Record<InvalidReason, number>;
  /** Batches lost in transit, detected from gaps in `seq`. */
  missedFrames: number;
  /** Batches with an already-seen `seq`, skipped to avoid double processing. */
  duplicateFrames: number;
  /** Frames the server skipped because this client fell behind (current connection). */
  serverDropped: number;
  /** Local time of the last frame of any type, including heartbeats. */
  lastMessageAt: number | null;
}

export interface ConnectionSnapshot {
  status: ConnectionStatus;
  lastClose: { code: number; reason: string; wasClean: boolean } | null;
  server: ServerState | null;
  stats: ConnectionStats;
}

export interface Connection {
  connect(): void;
  disconnect(): void;
  /** Returns false (and drops the message) when the socket isn't open. */
  send(message: ClientMessage): boolean;
  subscribe(listener: () => void): () => void;
  getSnapshot(): ConnectionSnapshot;
}

export interface ConnectionOptions {
  /** How often stats are published to subscribers. Status changes publish immediately. */
  publishIntervalMs?: number;
  /** Injectable for tests. */
  WebSocketImpl?: typeof WebSocket;
  now?: () => number;
}

const RATE_WINDOW_SAMPLES = 4; // 4 × 250 ms ≈ 1 s window for events/sec

export function createConnection(url: string, options: ConnectionOptions = {}): Connection {
  const publishIntervalMs = options.publishIntervalMs ?? 250;
  const WS = options.WebSocketImpl ?? WebSocket;
  const now = options.now ?? Date.now;

  // ---- mutable state, never read by React directly ----
  let socket: WebSocket | null = null;
  let status: ConnectionStatus = 'disconnected';
  let lastClose: ConnectionSnapshot['lastClose'] = null;
  let server: ServerState | null = null;
  const seq = createSeqTracker();
  const invalid = createInvalidCounts();
  let publishTimer: ReturnType<typeof setInterval> | null = null;
  let rateSamples: Array<{ at: number; total: number }> = [];
  const counters = {
    totalEvents: 0,
    framesReceived: 0,
    malformedFrames: 0,
    serverDropped: 0,
    lastMessageAt: null as number | null,
  };
  let eventsPerSec = 0;

  // ---- external store ----
  const listeners = new Set<() => void>();
  let snapshot: ConnectionSnapshot = buildSnapshot();
  let dirty = false;

  function buildSnapshot(): ConnectionSnapshot {
    return {
      status,
      lastClose,
      server,
      stats: {
        ...counters,
        eventsPerSec,
        invalidEvents: invalid.total,
        invalidByReason: { ...invalid.byReason },
        missedFrames: seq.missed,
        duplicateFrames: seq.duplicates,
      },
    };
  }

  /** Replace the snapshot object and notify. getSnapshot must return the same object between
   *  publishes, otherwise useSyncExternalStore re-renders forever. */
  function publish() {
    snapshot = buildSnapshot();
    dirty = false;
    for (const l of listeners) l();
  }

  function updateRate() {
    const at = now();
    rateSamples.push({ at, total: counters.totalEvents });
    if (rateSamples.length > RATE_WINDOW_SAMPLES + 1) rateSamples.shift();
    const first = rateSamples[0];
    const last = rateSamples[rateSamples.length - 1];
    if (first && last && last.at > first.at) {
      const next = Math.round(((last.total - first.total) * 1000) / (last.at - first.at));
      if (next !== eventsPerSec) {
        eventsPerSec = next;
        dirty = true;
      }
    }
  }

  function startPublishing() {
    stopPublishing();
    rateSamples = [];
    publishTimer = setInterval(() => {
      updateRate();
      if (dirty) publish();
    }, publishIntervalMs);
  }

  function stopPublishing() {
    if (publishTimer !== null) clearInterval(publishTimer);
    publishTimer = null;
  }

  function setStatus(next: ConnectionStatus) {
    if (status === next) return;
    status = next;
    publish(); // rare and important: publish immediately
  }

  // ---- message handling ----
  function handleMessage(raw: unknown) {
    counters.framesReceived++;
    counters.lastMessageAt = now();
    dirty = true;

    const msg = parseServerMessage(raw);
    if (!msg) {
      counters.malformedFrames++;
      return;
    }

    switch (msg.type) {
      case 'hello':
        seq.reset(); // seq restarts per connection
        server = {
          running: msg.running,
          rate: msg.rate,
          baseRate: msg.rate,
          burstEndsAt: null,
          tickMs: msg.tickMs,
        };
        counters.serverDropped = 0;
        publish();
        return;

      case 'status':
        server = {
          running: msg.running,
          rate: msg.rate,
          baseRate: msg.baseRate,
          burstEndsAt: msg.burstEndsAt,
          tickMs: server?.tickMs ?? 0,
        };
        publish();
        return;

      case 'batch': {
        if (!seq.accept(msg.seq)) return; // duplicate: already processed
        if (typeof msg.serverDropped === 'number') counters.serverDropped = msg.serverDropped;

        // Phase 1: validation runs on the main thread. Phase 2 (Task C) moves this into the
        // worker, and this line becomes the "before" number for experiment 15.1.
        const valid = validateEvents(msg.events, now(), invalid); // now() once per batch
        counters.totalEvents += valid.length;
        return;
      }

      case 'heartbeat':
        return; // lastMessageAt already updated

      case 'error':
        console.warn('[ws] server error:', msg.message);
        return;

      default:
        counters.malformedFrames++;
    }
  }

  // ---- lifecycle ----
  function connect() {
    if (socket) return; // already connecting/connected
    lastClose = null;
    setStatus('connecting');

    const ws = new WS(url);
    socket = ws;
    // Every handler checks `socket === ws`. After disconnect() + connect() (React StrictMode
    // does exactly this in dev), the OLD socket's close event still fires later; without the
    // check it would flip the NEW connection's status to 'disconnected'.
    ws.onopen = () => {
      if (socket !== ws) return;
      startPublishing();
      setStatus('connected');
    };
    ws.onmessage = (event: MessageEvent) => {
      if (socket !== ws) return;
      handleMessage(event.data);
    };
    // `error` carries no details (browser security) and is always followed by `close`,
    // so all state changes happen in onclose.
    ws.onerror = () => {};
    ws.onclose = (event: CloseEvent) => {
      if (socket !== ws) return;
      socket = null;
      stopPublishing();
      eventsPerSec = 0;
      lastClose = { code: event.code, reason: event.reason, wasClean: event.wasClean };
      server = null;
      status = 'disconnected';
      publish();
    };
  }

  function disconnect() {
    const ws = socket;
    if (!ws) return;
    socket = null; // detach first, so this socket's late events are ignored
    stopPublishing();
    eventsPerSec = 0;
    server = null;
    status = 'disconnected';
    publish();

    if (ws.readyState === WS.CONNECTING) {
      // Closing a CONNECTING socket logs a browser warning; close as soon as it opens instead.
      ws.onopen = () => ws.close(1000, 'Client disconnect');
    } else if (ws.readyState === WS.OPEN) {
      ws.close(1000, 'Client disconnect');
    }
  }

  function send(message: ClientMessage): boolean {
    // Decision: drop rather than queue. A queued "setRate" replayed after a reconnect could
    // apply a stale command to a fresh server session.
    if (!socket || socket.readyState !== WS.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }

  return {
    connect,
    disconnect,
    send,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
  };
}
