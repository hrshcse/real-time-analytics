import { METRICS, type MetricType } from '@rta/shared';
import type { MetricBucket } from '../processing';

/**
 * IndexedDB persistence, used from the worker (WBS 11). IndexedDB works in workers, so writes
 * never touch the main thread.
 *
 *   db "rta" v1
 *   ├── sessions  key: id          { id, startedAt, endedAt, bucketCount }
 *   └── buckets   key: [sessionId, metric, start]   index by_start: start
 *                                                    index by_session: [sessionId, start]
 *
 * What's stored: closed 1 s buckets (6 small records/s), not raw events (10K+/s). That keeps
 * history, reload recovery and replay possible at a few KB per second.
 */

export interface SessionMeta {
  id: string;
  startedAt: number;
  /** Last time a bucket was written for this session. */
  endedAt: number;
  bucketCount: number;
}

export interface StoredBucket extends MetricBucket {
  sessionId: string;
}

export type StorageState =
  | { status: 'ok'; sessionId: string }
  | { status: 'unavailable'; message: string } // init failed: run without history
  | { status: 'error'; message: string }; // was working, now failing

export interface StorageOptions {
  dbName?: string;
  /** Delete buckets older than this (WBS 11.3: keep last 30 minutes). */
  retentionMs?: number;
  indexedDB?: IDBFactory;
  now?: () => number;
}

const DB_VERSION = 1;

/** Promise wrapper for an IDBRequest. */
function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** Resolves when a transaction commits (or rejects with its error, e.g. QuotaExceededError). */
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

export function isQuotaError(err: unknown): boolean {
  return err instanceof DOMException && (err.name === 'QuotaExceededError' || err.code === 22);
}

const METRIC_SET = new Set<string>(METRICS);

/** Corrupt-data guard (WBS 17.3): a stored record must still look like a bucket. */
export function isStoredBucket(x: unknown): x is StoredBucket {
  if (typeof x !== 'object' || x === null) return false;
  const b = x as Record<string, unknown>;
  return (
    typeof b.sessionId === 'string' &&
    typeof b.metric === 'string' &&
    METRIC_SET.has(b.metric) &&
    ['start', 'windowMs', 'count', 'sum', 'avg', 'min', 'max', 'p95', 'p99'].every(
      (k) => typeof b[k] === 'number' && Number.isFinite(b[k]),
    )
  );
}

export async function openStorage(options: StorageOptions = {}) {
  const idb = options.indexedDB ?? (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!idb) throw new Error('IndexedDB is not available');
  const now = options.now ?? Date.now;
  const retentionMs = options.retentionMs ?? 30 * 60_000;

  const openReq = idb.open(options.dbName ?? 'rta', DB_VERSION);
  openReq.onupgradeneeded = () => {
    const db = openReq.result;
    if (!db.objectStoreNames.contains('sessions'))
      db.createObjectStore('sessions', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('buckets')) {
      const buckets = db.createObjectStore('buckets', {
        keyPath: ['sessionId', 'metric', 'start'],
      });
      buckets.createIndex('by_start', 'start');
      buckets.createIndex('by_session', ['sessionId', 'start']);
    }
  };
  const db = await req(openReq);
  let corruptRecords = 0;

  async function prune(cutoff = now() - retentionMs): Promise<number> {
    const tx = db.transaction(['buckets', 'sessions'], 'readwrite');
    const byStart = tx.objectStore('buckets').index('by_start');
    let deleted = 0;
    await new Promise<void>((resolve, reject) => {
      const cursorReq = byStart.openCursor(IDBKeyRange.upperBound(cutoff, true));
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return resolve();
        cursor.delete();
        deleted++;
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
    // Sessions whose last bucket is past retention go too.
    const sessions = tx.objectStore('sessions');
    for (const s of (await req(sessions.getAll())) as SessionMeta[]) {
      if (s.endedAt < cutoff) sessions.delete(s.id);
    }
    await done(tx);
    return deleted;
  }

  return {
    async startSession(): Promise<SessionMeta> {
      const startedAt = now();
      const meta: SessionMeta = {
        id: `s-${startedAt}`,
        startedAt,
        endedAt: startedAt,
        bucketCount: 0,
      };
      const tx = db.transaction('sessions', 'readwrite');
      tx.objectStore('sessions').put(meta);
      await done(tx);
      return meta;
    },

    /**
     * One transaction per call (the worker calls this ≤ once a second).
     * On QuotaExceededError: prune to half the retention and retry once (WBS 11.3).
     */
    async appendBuckets(session: SessionMeta, buckets: readonly MetricBucket[]): Promise<void> {
      if (buckets.length === 0) return;
      const write = async () => {
        const tx = db.transaction(['buckets', 'sessions'], 'readwrite');
        const store = tx.objectStore('buckets');
        for (const b of buckets) store.put({ ...b, sessionId: session.id } satisfies StoredBucket);
        session.bucketCount += buckets.length;
        session.endedAt = Math.max(session.endedAt, ...buckets.map((b) => b.start + b.windowMs));
        tx.objectStore('sessions').put(session);
        await done(tx);
      };
      try {
        await write();
      } catch (err) {
        if (!isQuotaError(err)) throw err;
        await prune(now() - retentionMs / 2);
        await write(); // a second failure propagates: the caller marks storage as errored
      }
    },

    async listSessions(): Promise<SessionMeta[]> {
      const all = (await req(
        db.transaction('sessions').objectStore('sessions').getAll(),
      )) as SessionMeta[];
      return all.filter((s) => s.bucketCount > 0).sort((a, b) => b.startedAt - a.startedAt);
    },

    /** All buckets of one session, oldest first (replay). Corrupt records are skipped and counted. */
    async loadSession(sessionId: string): Promise<StoredBucket[]> {
      const index = db.transaction('buckets').objectStore('buckets').index('by_session');
      const rows = await req(
        index.getAll(IDBKeyRange.bound([sessionId, -Infinity], [sessionId, Infinity])),
      );
      const ok = rows.filter(isStoredBucket);
      corruptRecords += rows.length - ok.length;
      return ok;
    },

    /** Buckets from any session since `from` (reload recovery). */
    async loadSince(from: number): Promise<StoredBucket[]> {
      const index = db.transaction('buckets').objectStore('buckets').index('by_start');
      const rows = await req(index.getAll(IDBKeyRange.lowerBound(from)));
      const ok = rows.filter(isStoredBucket);
      corruptRecords += rows.length - ok.length;
      return ok;
    },

    prune,

    get corruptRecords() {
      return corruptRecords;
    },

    close() {
      db.close();
    },
  };
}

export type Storage = Awaited<ReturnType<typeof openStorage>>;
export type { MetricType };
