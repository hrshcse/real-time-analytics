import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { MetricBucket } from '../processing';
import { isQuotaError, isStoredBucket, openStorage } from './storage';

let clock = 1_700_000_000_000;
const bucket = (start: number, metric: MetricBucket['metric'] = 'cpu'): MetricBucket => ({
  metric,
  start,
  windowMs: 1000,
  count: 10,
  sum: 100,
  avg: 10,
  min: 1,
  max: 20,
  p95: 19,
  p99: 20,
});
const open = (opts = {}) => openStorage({ indexedDB: new IDBFactory(), now: () => clock, ...opts });

describe('storage', () => {
  it('stores buckets per session and loads them back in order', async () => {
    const s = await open();
    const session = await s.startSession();
    await s.appendBuckets(session, [
      bucket(clock + 2000),
      bucket(clock + 1000),
      bucket(clock + 1000, 'memory'),
    ]);
    const rows = await s.loadSession(session.id);
    expect(rows.map((r) => [r.metric, r.start - clock])).toEqual([
      ['cpu', 1000],
      ['memory', 1000],
      ['cpu', 2000],
    ]);
    const sessions = await s.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ bucketCount: 3, endedAt: clock + 3000 });
  });

  it('lists sessions newest first and hides empty ones', async () => {
    const s = await open();
    const a = await s.startSession();
    await s.appendBuckets(a, [bucket(clock)]);
    clock += 10_000;
    const b = await s.startSession();
    await s.appendBuckets(b, [bucket(clock)]);
    clock += 10_000;
    await s.startSession(); // empty
    expect((await s.listSessions()).map((x) => x.id)).toEqual([b.id, a.id]);
  });

  it('loadSince returns buckets from all sessions after a time (reload recovery)', async () => {
    const s = await open();
    const a = await s.startSession();
    await s.appendBuckets(a, [bucket(clock - 5000), bucket(clock - 1000)]);
    expect((await s.loadSince(clock - 2000)).map((r) => r.start)).toEqual([clock - 1000]);
  });

  it('prunes buckets and sessions past retention (30 min)', async () => {
    const s = await open({ retentionMs: 60_000 });
    const old = await s.startSession();
    await s.appendBuckets(old, [bucket(clock - 120_000)]);
    const fresh = await s.startSession();
    await s.appendBuckets(fresh, [bucket(clock - 10_000)]);
    expect(await s.prune()).toBe(1);
    expect((await s.listSessions()).map((x) => x.id)).toEqual([fresh.id]);
  });

  it('rejects corrupt records', () => {
    expect(isStoredBucket({ ...bucket(0), sessionId: 's' })).toBe(true);
    expect(isStoredBucket({ ...bucket(0), sessionId: 's', avg: 'NaN' })).toBe(false);
    expect(isStoredBucket({ ...bucket(0), sessionId: 's', metric: 'disk' })).toBe(false);
    expect(isStoredBucket(null)).toBe(false);
  });

  it('rejects when IndexedDB cannot open (private mode / blocked): caller runs without history', async () => {
    const blocked = {
      open: () => {
        throw new DOMException('The user denied permission', 'SecurityError');
      },
    } as unknown as IDBFactory;
    await expect(openStorage({ indexedDB: blocked })).rejects.toThrow('denied');
  });

  it('recognises quota errors', () => {
    expect(isQuotaError(new DOMException('full', 'QuotaExceededError'))).toBe(true);
    expect(isQuotaError(new Error('other'))).toBe(false);
  });
});
