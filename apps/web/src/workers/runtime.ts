import type { MainToWorker, WorkerToMain } from './contract';
import { createProcessor, type ProcessorOptions } from './processor';
import { openStorage, type SessionMeta, type Storage, type StorageOptions } from './storage';

/** The part of the worker global scope we use. Lets tests pass a fake scope. */
export interface WorkerScopeLike {
  onmessage: ((event: { data: MainToWorker }) => void) | null;
  postMessage(message: WorkerToMain): void;
}

export interface WorkerRuntimeOptions extends ProcessorOptions {
  /** How often to send summaries/chart data (only if changed). Matches the UI publish rate. */
  summaryIntervalMs?: number;
  /** IndexedDB persistence; false disables it. */
  storage?: StorageOptions | false;
  /** On start, restore this much history from IndexedDB (WBS 11.2). */
  restoreMs?: number;
}

const PRUNE_EVERY_MS = 60_000;

/**
 * Wires a scope's messages to a processor, sends updates on a timer, and owns the async parts
 * (IndexedDB persistence, session list, replay loading).
 * Returns a stop function. The real worker never stops; terminate() kills it.
 */
export function startWorkerRuntime(scope: WorkerScopeLike, options: WorkerRuntimeOptions = {}) {
  const processor = createProcessor(options);
  const now = options.now ?? Date.now;
  const report = (err: unknown) =>
    scope.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

  // ---- persistence (WBS 11): failures degrade to "no history", never break the live pipeline ----
  let storage: Storage | null = null;
  let session: SessionMeta | null = null;
  let restoredBuckets = 0;
  let lastPrune = 0;
  const storageReady: Promise<Storage | null> =
    options.storage === false
      ? Promise.resolve(null)
      : openStorage({ now, ...options.storage })
          .then(async (s) => {
            await s.prune();
            session = await s.startSession();
            const recent = await s.loadSince(now() - (options.restoreMs ?? 15 * 60_000));
            processor.restore(recent);
            restoredBuckets = recent.length;
            storage = s;
            processor.setStorage({
              status: 'ok',
              sessionId: session.id,
              restoredBuckets,
              corruptRecords: s.corruptRecords,
            });
            return s;
          })
          .catch((err) => {
            processor.setStorage({
              status: 'unavailable',
              message: message(err),
              restoredBuckets: 0,
              corruptRecords: 0,
            });
            return null;
          });

  function persist() {
    const closed = processor.takeClosedBuckets();
    const s = storage;
    if (!s || !session || closed.length === 0) return;
    s.appendBuckets(session, closed).catch((err) => {
      storage = null; // stop trying; keep running live
      processor.setStorage({
        status: 'error',
        message: message(err),
        restoredBuckets,
        corruptRecords: s.corruptRecords,
      });
    });
    if (now() - lastPrune > PRUNE_EVERY_MS) {
      lastPrune = now();
      s.prune().catch(() => {});
    }
  }

  async function handleAsync(msg: MainToWorker) {
    if (msg.type === 'sessions') {
      const s = await storageReady;
      scope.postMessage({ type: 'sessions', sessions: s ? await s.listSessions() : [] });
    } else if (msg.type === 'replay') {
      if (msg.action === 'start') {
        const s = await storageReady;
        if (!s) throw new Error('Replay needs IndexedDB, which is unavailable');
        const buckets = await s.loadSession(msg.sessionId);
        processor.startReplay(msg.sessionId, buckets, msg.speed);
      } else {
        processor.replayCommand(msg);
      }
    }
  }

  scope.onmessage = (event) => {
    try {
      const msg = event.data;
      processor.handle(msg);
      if (msg.type === 'frames') scope.postMessage({ type: 'ack', frames: msg.raw.length });
      if (msg.type === 'sessions' || msg.type === 'replay') handleAsync(msg).catch(report);
      // A grid query is answered immediately: scrolling must not wait for the next tick.
      const page = processor.takeGridPage();
      if (page) scope.postMessage({ type: 'grid', page });
    } catch (err) {
      report(err); // keep running: one bad message shouldn't kill the pipeline (WBS 17.2)
    }
  };

  const timer = setInterval(() => {
    try {
      const out = processor.tick();
      if (out.summary) scope.postMessage({ type: 'summary', summary: out.summary });
      if (out.chart) scope.postMessage({ type: 'chart', chart: out.chart });
      if (out.grid) scope.postMessage({ type: 'grid', page: out.grid });
      if (out.replay !== undefined) scope.postMessage({ type: 'replay', state: out.replay });
      persist();
    } catch (err) {
      report(err);
    }
  }, options.summaryIntervalMs ?? 250);

  return () => {
    clearInterval(timer);
    storageReady.then((s) => s?.close()).catch(() => {});
  };
}
