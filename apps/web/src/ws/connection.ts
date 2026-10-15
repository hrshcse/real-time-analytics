import type { ClientMessage, InvalidReason } from '@rta/shared';
import { createRateMeter, parseServerMessage, type LatestBuckets } from '../processing';
import type { MainToWorker, WorkerSummary, WorkerToMain } from '../workers/contract';
import { createFrameBuffer, type FrameBufferOptions } from './frameBuffer';

/**
 * WebSocket connection — plain TypeScript, no React (WBS 3.x, 4.1, 4.5).
 *
 *  MAIN THREAD                                                    WORKER
 *  ws.onmessage(raw)
 *    ├─ starts with {"type":"batch" ─▶ frameBuffer ─ flush ─▶ frames ─▶ parse/validate/aggregate
 *    └─ control frame ─▶ parse here ─▶ status / hello / heartbeat         │ summary ≤ 4/sec
 *                                                                          ▼
 *  subscribe / getSnapshot  ◀── publish every ~250 ms if dirty ◀── worker.onmessage
 *
 * Socket on the main thread, processing in the worker (D7). Batch frames are recognised by
 * prefix so the main thread never parses them (D12). The worker lives from connect() to
 * disconnect(), surviving unexpected closes so totals/aggregates carry over (D16).
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
  /** Valid events per second, measured in the worker. */
  eventsPerSec: number;
  totalEvents: number;
  /** Batch frames per second arriving on the main thread. */
  framesPerSec: number;
  /** postMessage calls to the worker per second (frame buffer flushes). */
  postsPerSec: number;
  framesReceived: number;
  /** Not valid JSON / unknown shape (main-thread control path + worker batch path). */
  malformedFrames: number;
  invalidEvents: number;
  invalidByReason: Record<InvalidReason, number>;
  missedFrames: number;
  duplicateFrames: number;
  serverDropped: number;
  lateEvents: number;
  /** Buffered frames discarded by disconnect() (D13). */
  droppedOnDisconnect: number;
  lastMessageAt: number | null;
  /** Worker time per batch during the last summary window. Null until the first summary. */
  processing: { batches: number; avgMs: number; maxMs: number } | null;
}

export interface ConnectionSnapshot {
  status: ConnectionStatus;
  lastClose: { code: number; reason: string; wasClean: boolean } | null;
  server: ServerState | null;
  stats: ConnectionStats;
  /** Latest closed bucket per metric, keyed by window (ms). */
  latest: Record<number, LatestBuckets>;
  workerError: string | null;
}

export interface Connection {
  connect(): void;
  disconnect(): void;
  /** Returns false (and drops the message) when the socket isn't open (D9). */
  send(message: ClientMessage): boolean;
  subscribe(listener: () => void): () => void;
  getSnapshot(): ConnectionSnapshot;
}

export interface ConnectionOptions {
  /** How often the snapshot is published to subscribers. Status changes publish immediately. */
  publishIntervalMs?: number;
  /** Frame buffer limits (Task D). */
  buffer?: Omit<FrameBufferOptions, 'onFlush'>;
  /** Injectable for tests. */
  WebSocketImpl?: typeof WebSocket;
  createWorker?: () => Worker;
  now?: () => number;
}

/** Our server serialises `type` first (JSON.stringify keeps insertion order). If that ever
 *  changes, batches fall through to the parse path below: slower, still correct. */
const BATCH_PREFIX = '{"type":"batch"';

const defaultCreateWorker = () =>
  new Worker(new URL('../workers/processor.worker.ts', import.meta.url), { type: 'module' });

const EMPTY_REASONS: Record<InvalidReason, number> = {
  'not-object': 0,
  id: 0,
  timestamp: 0,
  metric: 0,
  value: 0,
  category: 0,
  source: 0,
};

export function createConnection(url: string, options: ConnectionOptions = {}): Connection {
  const publishIntervalMs = options.publishIntervalMs ?? 250;
  const WS = options.WebSocketImpl ?? WebSocket;
  const createWorker = options.createWorker ?? defaultCreateWorker;
  const now = options.now ?? Date.now;

  // ---- mutable state, never read by React directly ----
  let socket: WebSocket | null = null;
  let worker: Worker | null = null;
  let status: ConnectionStatus = 'disconnected';
  let lastClose: ConnectionSnapshot['lastClose'] = null;
  let server: ServerState | null = null;
  let summary: WorkerSummary | null = null;
  let workerError: string | null = null;
  let publishTimer: ReturnType<typeof setInterval> | null = null;

  const main = {
    framesReceived: 0,
    batchFrames: 0,
    malformedFrames: 0,
    droppedOnDisconnect: 0,
    lastMessageAt: null as number | null,
  };
  const framesRate = createRateMeter(1000);
  const postsRate = createRateMeter(1000);

  const buffer = createFrameBuffer({
    ...options.buffer,
    onFlush: (frames) => post({ type: 'frames', raw: frames }),
  });

  function post(message: MainToWorker) {
    worker?.postMessage(message); // never posts to a terminated worker: it's nulled first
  }

  // ---- external store ----
  const listeners = new Set<() => void>();
  let snapshot: ConnectionSnapshot = buildSnapshot();
  let dirty = false;

  function buildSnapshot(): ConnectionSnapshot {
    const s = summary;
    const processing =
      s && s.processing.batches > 0
        ? {
            batches: s.processing.batches,
            avgMs: s.processing.totalMs / s.processing.batches,
            maxMs: s.processing.maxMs,
          }
        : null;
    return {
      status,
      lastClose,
      server,
      workerError,
      latest: s?.latest ?? {},
      stats: {
        eventsPerSec: worker ? (s?.eventsPerSec ?? 0) : 0,
        totalEvents: s?.totalEvents ?? 0,
        framesPerSec: framesRate.rate,
        postsPerSec: postsRate.rate,
        framesReceived: main.framesReceived,
        malformedFrames: main.malformedFrames + (s?.malformedFrames ?? 0),
        invalidEvents: s?.invalidEvents ?? 0,
        invalidByReason: s ? { ...s.invalidByReason } : { ...EMPTY_REASONS },
        missedFrames: s?.missedFrames ?? 0,
        duplicateFrames: s?.duplicateFrames ?? 0,
        serverDropped: s?.serverDropped ?? 0,
        lateEvents: s?.lateEvents ?? 0,
        droppedOnDisconnect: main.droppedOnDisconnect,
        lastMessageAt: main.lastMessageAt,
        processing,
      },
    };
  }

  /** getSnapshot must return the same object between publishes, or useSyncExternalStore
   *  re-renders forever. */
  function publish() {
    snapshot = buildSnapshot();
    dirty = false;
    for (const l of listeners) l();
  }

  function startPublishing() {
    if (publishTimer !== null) return;
    framesRate.reset();
    postsRate.reset();
    publishTimer = setInterval(() => {
      const at = now();
      const f = framesRate.rate;
      const p = postsRate.rate;
      if (framesRate.sample(at, main.batchFrames) !== f) dirty = true;
      if (postsRate.sample(at, buffer.flushes) !== p) dirty = true;
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

  // ---- worker ----
  function startWorker() {
    if (worker) return;
    workerError = null;
    const w = createWorker();
    worker = w;
    w.onmessage = (event: MessageEvent<WorkerToMain>) => {
      if (worker !== w) return; // stale (terminated) worker
      const msg = event.data;
      if (msg.type === 'summary') {
        if (summary && msg.summary.version === summary.version) return;
        summary = msg.summary;
        dirty = true;
      } else {
        workerError = msg.message;
        publish();
      }
    };
    w.onerror = (event: ErrorEvent) => {
      if (worker !== w) return;
      event.preventDefault?.(); // we surface it in the UI instead of the console
      workerError = event.message || 'Worker failed to start or crashed';
      publish();
    };
  }

  function stopWorker() {
    const w = worker;
    if (!w) return;
    worker = null; // null first, so post() and late messages are ignored
    w.terminate();
  }

  // ---- socket messages ----
  function handleMessage(raw: unknown) {
    main.framesReceived++;
    main.lastMessageAt = now();
    dirty = true;

    // Fast path (D12): forward batch frames unparsed. Parsing is the expensive part, and
    // postMessage copies a string as one block instead of walking 500 event objects.
    if (typeof raw === 'string' && raw.startsWith(BATCH_PREFIX)) {
      main.batchFrames++;
      buffer.push(raw);
      return;
    }

    const msg = parseServerMessage(raw);
    if (!msg) {
      main.malformedFrames++;
      return;
    }

    switch (msg.type) {
      case 'hello':
        // Flush BEFORE reset: postMessage is FIFO, so old-connection frames are processed with
        // the old seq numbers before the worker restarts seq at 0. onclose already flushes;
        // this is the backstop if a close is ever missed.
        buffer.flush();
        post({ type: 'reset' });
        server = {
          running: msg.running,
          rate: msg.rate,
          baseRate: msg.rate,
          burstEndsAt: null,
          tickMs: msg.tickMs,
        };
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

      case 'batch': // slow path: only if the server's key order changed
        main.batchFrames++;
        buffer.push(raw as string);
        return;

      case 'heartbeat':
        return; // lastMessageAt already updated

      case 'error':
        console.warn('[ws] server error:', msg.message);
        return;
    }
  }

  // ---- lifecycle ----
  function connect() {
    if (socket) return; // already connecting/connected
    lastClose = null;
    startWorker();
    startPublishing();
    setStatus('connecting');

    const ws = new WS(url);
    socket = ws;
    // Every handler checks `socket === ws`. After disconnect() + connect() (React StrictMode
    // does exactly this in dev), the OLD socket's close event still fires later; without the
    // check it would flip the NEW connection's status to 'disconnected'.
    ws.onopen = () => {
      if (socket !== ws) return;
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
      buffer.flush(); // worker is still alive (D16): nothing received is lost
      lastClose = { code: event.code, reason: event.reason, wasClean: event.wasClean };
      server = null;
      status = 'disconnected';
      publish();
    };
  }

  function disconnect() {
    const ws = socket;
    socket = null; // detach first, so this socket's late events are ignored
    main.droppedOnDisconnect += buffer.clear(); // D13: the worker is about to be terminated
    stopWorker();
    stopPublishing();
    server = null;
    status = 'disconnected';
    publish();

    if (!ws) return;
    if (ws.readyState === WS.CONNECTING) {
      // Closing a CONNECTING socket logs a browser warning; close as soon as it opens instead.
      ws.onopen = () => ws.close(1000, 'Client disconnect');
    } else if (ws.readyState === WS.OPEN) {
      ws.close(1000, 'Client disconnect');
    }
  }

  function send(message: ClientMessage): boolean {
    // Drop rather than queue (D9): a queued "setRate" replayed after a reconnect could apply a
    // stale command to a fresh server session.
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
