import type { ClientMessage, InvalidReason } from '@rta/shared';
import { createRateMeter, parseServerMessage, type LatestBuckets } from '../processing';
import type {
  ChartData,
  ChartView,
  GridPage,
  GridQuery,
  MainToWorker,
  WorkerSummary,
  WorkerToMain,
} from '../workers/contract';
import { createFrameBuffer, type FrameBufferOptions } from './frameBuffer';
import { createStore, type ReadableStore } from './store';

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
 *
 * Backpressure (WBS 10): the worker acks every frames message; while more than
 * maxInFlightFrames are unacknowledged the buffer holds new frames, dropping the oldest past
 * its cap. Render batching (WBS 10.4): a 250 ms tick decides whether anything changed, then
 * publishes on the next animation frame ('raf'). 'immediate' publishes on every message: the
 * naive baseline for experiment 15.4.
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
  /** Main-thread JS heap (Chrome-only `performance.memory`); null where unsupported. */
  heapMB: number | null;
  /** Frames posted to the worker but not yet acknowledged. */
  inFlightFrames: number;
  /** Frames dropped on the main thread by backpressure (oldest first). */
  backpressureDropped: number;
  /** Main-thread ms per second spent in socket + worker message handlers. */
  mainMsPerSec: number;
  /** Snapshot publishes (≈ React renders of the dashboard) per second. */
  publishesPerSec: number;
  /** Age of the newest processed event: how far behind live the dashboard is. */
  dataLagMs: number | null;
}

export interface ConnectionSnapshot {
  status: ConnectionStatus;
  lastClose: { code: number; reason: string; wasClean: boolean } | null;
  server: ServerState | null;
  stats: ConnectionStats;
  /** Latest closed bucket per metric, keyed by window (ms). */
  latest: Record<number, LatestBuckets>;
  workerError: string | null;
  /** When the current socket opened (ms since epoch); null when not connected. */
  connectedAt: number | null;
}

export interface Connection {
  connect(): void;
  disconnect(): void;
  /** Returns false (and drops the message) when the socket isn't open (D9). */
  send(message: ClientMessage): boolean;
  subscribe(listener: () => void): () => void;
  getSnapshot(): ConnectionSnapshot;
  /** Chart series built by the worker for the current view. */
  chart: ReadableStore<ChartData | null>;
  /** The current grid page from the worker. */
  grid: ReadableStore<GridPage | null>;
  /** What the chart wants (null = no chart). Remembered across worker restarts. */
  setView(view: ChartView | null): void;
  /** What the grid wants (null = grid hidden). Remembered across worker restarts. */
  queryGrid(query: GridQuery | null, live: boolean): void;
  /** Experiment switches (WBS 10, 15.4). */
  setPublishMode(mode: PublishMode): void;
  setBackpressure(enabled: boolean): void;
  setSimulatedWorkMs(ms: number): void;
  readonly experiments: Readonly<ExperimentState>;
}

export type PublishMode = 'raf' | 'immediate';

export interface ExperimentState {
  publishMode: PublishMode;
  backpressure: boolean;
  simulatedWorkMs: number;
}

export interface ConnectionOptions {
  /** How often the snapshot is published to subscribers. Status changes publish immediately. */
  publishIntervalMs?: number;
  /** Frame buffer limits (Task D). */
  buffer?: Omit<FrameBufferOptions, 'onFlush' | 'budget'>;
  /** Hold the buffer while more than this many frames are unacknowledged. */
  maxInFlightFrames?: number;
  publishMode?: PublishMode;
  /** Injectable frame scheduler (default requestAnimationFrame). */
  scheduleFrame?: (cb: () => void) => number;
  cancelFrame?: (id: number) => void;
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
  const maxInFlight = options.maxInFlightFrames ?? 32;
  const hasRaf = typeof requestAnimationFrame === 'function';
  const scheduleFrame =
    options.scheduleFrame ??
    (hasRaf
      ? (cb: () => void) => requestAnimationFrame(cb)
      : (cb: () => void) => setTimeout(cb, 16) as unknown as number);
  const cancelFrame =
    options.cancelFrame ??
    (hasRaf ? (id: number) => cancelAnimationFrame(id) : (id: number) => clearTimeout(id));
  const perfNow = () => performance.now();
  const experiments: ExperimentState = {
    publishMode: options.publishMode ?? 'raf',
    backpressure: true,
    simulatedWorkMs: 0,
  };

  // ---- mutable state, never read by React directly ----
  let socket: WebSocket | null = null;
  let worker: Worker | null = null;
  let status: ConnectionStatus = 'disconnected';
  let lastClose: ConnectionSnapshot['lastClose'] = null;
  let server: ServerState | null = null;
  let summary: WorkerSummary | null = null;
  let workerError: string | null = null;
  let publishTimer: ReturnType<typeof setInterval> | null = null;
  let connectedAt: number | null = null;
  let heapMB: number | null = null;
  let view: ChartView | null = null;
  let gridRequest: { query: GridQuery | null; live: boolean } = { query: null, live: true };
  const chartStore = createStore<ChartData | null>(null);
  const gridStore = createStore<GridPage | null>(null);

  const main = {
    framesReceived: 0,
    batchFrames: 0,
    malformedFrames: 0,
    droppedOnDisconnect: 0,
    lastMessageAt: null as number | null,
    postedFrames: 0,
    ackedFrames: 0,
    mainMs: 0,
    publishes: 0,
  };
  const framesRate = createRateMeter(1000);
  const postsRate = createRateMeter(1000);
  const mainMsRate = createRateMeter(1000);
  const publishRate = createRateMeter(1000);
  let frameHandle: number | null = null;

  const inFlight = () => main.postedFrames - main.ackedFrames;
  const buffer = createFrameBuffer({
    ...options.buffer,
    budget: () => (experiments.backpressure ? maxInFlight - inFlight() : Infinity),
    onFlush: (frames) => {
      main.postedFrames += frames.length;
      post({ type: 'frames', raw: frames });
    },
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
      connectedAt,
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
        heapMB,
        inFlightFrames: inFlight(),
        backpressureDropped: buffer.dropped,
        mainMsPerSec: mainMsRate.rate,
        publishesPerSec: publishRate.rate,
        dataLagMs: s?.newestEventAt != null ? Math.max(0, now() - s.newestEventAt) : null,
      },
    };
  }

  /** getSnapshot must return the same object between publishes, or useSyncExternalStore
   *  re-renders forever. */
  function publish() {
    if (frameHandle !== null) {
      cancelFrame(frameHandle);
      frameHandle = null;
    }
    snapshot = buildSnapshot();
    dirty = false;
    main.publishes++;
    for (const l of listeners) l();
  }

  /** Coalesce into one publish on the next animation frame (or right now, in 'immediate'). */
  function schedulePublish() {
    if (experiments.publishMode === 'immediate') return publish();
    if (frameHandle !== null) return;
    frameHandle = scheduleFrame(() => {
      frameHandle = null;
      publish();
    });
  }

  function startPublishing() {
    if (publishTimer !== null) return;
    for (const m of [framesRate, postsRate, mainMsRate, publishRate]) m.reset();
    publishTimer = setInterval(() => {
      const at = now();
      const before = [framesRate.rate, postsRate.rate, mainMsRate.rate, publishRate.rate];
      framesRate.sample(at, main.batchFrames);
      postsRate.sample(at, buffer.flushes);
      mainMsRate.sample(at, main.mainMs);
      publishRate.sample(at, main.publishes);
      const after = [framesRate.rate, postsRate.rate, mainMsRate.rate, publishRate.rate];
      if (after.some((v, i) => v !== before[i])) dirty = true;
      const mem = readHeapMB();
      if (mem !== heapMB) {
        heapMB = mem;
        dirty = true;
      }
      if (dirty) schedulePublish();
    }, publishIntervalMs);
  }

  function stopPublishing() {
    if (publishTimer !== null) clearInterval(publishTimer);
    publishTimer = null;
    if (frameHandle !== null) cancelFrame(frameHandle);
    frameHandle = null;
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
    main.postedFrames = 0;
    main.ackedFrames = 0;
    const w = createWorker();
    worker = w;
    w.onmessage = (event: MessageEvent<WorkerToMain>) => {
      if (worker !== w) return; // stale (terminated) worker
      const t0 = perfNow();
      handleWorkerMessage(event.data);
      main.mainMs += perfNow() - t0;
    };
    const handleWorkerMessage = (msg: WorkerToMain) => {
      switch (msg.type) {
        case 'ack':
          main.ackedFrames += msg.frames;
          if (buffer.size > 0) buffer.flush(); // backlog cleared: release held frames
          return;
        case 'summary':
          if (summary && msg.summary.version === summary.version) return;
          summary = msg.summary;
          dirty = true;
          if (experiments.publishMode === 'immediate') publish();
          return;
        case 'chart':
          chartStore.set(msg.chart);
          return;
        case 'grid':
          gridStore.set(msg.page);
          return;
        case 'error':
          workerError = msg.message;
          publish();
          return;
      }
    };
    w.onerror = (event: ErrorEvent) => {
      if (worker !== w) return;
      event.preventDefault?.(); // we surface it in the UI instead of the console
      workerError = event.message || 'Worker failed to start or crashed';
      publish();
    };
    // A fresh worker knows nothing: replay what the UI currently wants.
    if (experiments.simulatedWorkMs > 0)
      w.postMessage({
        type: 'config',
        simulatedWorkMs: experiments.simulatedWorkMs,
      } satisfies MainToWorker);
    if (view) w.postMessage({ type: 'view', view } satisfies MainToWorker);
    if (gridRequest.query) w.postMessage({ type: 'grid', ...gridRequest } satisfies MainToWorker);
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
      connectedAt = now();
      setStatus('connected');
    };
    ws.onmessage = (event: MessageEvent) => {
      if (socket !== ws) return;
      const t0 = perfNow();
      handleMessage(event.data);
      if (experiments.publishMode === 'immediate') publish(); // naive: render per message
      main.mainMs += perfNow() - t0;
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
      connectedAt = null;
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
    connectedAt = null;
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
    chart: chartStore,
    grid: gridStore,
    setView(next) {
      view = next;
      post({ type: 'view', view: next });
    },
    queryGrid(query, live) {
      gridRequest = { query, live };
      post({ type: 'grid', query, live });
    },
    setPublishMode(mode) {
      experiments.publishMode = mode;
    },
    setBackpressure(enabled) {
      experiments.backpressure = enabled;
      if (!enabled) buffer.flush();
    },
    setSimulatedWorkMs(ms) {
      experiments.simulatedWorkMs = ms;
      post({ type: 'config', simulatedWorkMs: ms });
    },
    experiments,
  };
}

/** Chrome exposes `performance.memory` (non-standard). Other browsers: null. */
function readHeapMB(): number | null {
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return mem ? Math.round(mem.usedJSHeapSize / 1048576) : null;
}
