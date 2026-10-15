import 'fake-indexeddb/auto'; // installs IDBKeyRange etc. as globals, like a real browser/worker
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createFakeWorker } from '../test/fakeWorker';
import type { MainToWorker, WorkerToMain } from './contract';
import { startWorkerRuntime } from './runtime';

const T0 = 1_700_000_000_000;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frame = (seq: number, ts: number) =>
  JSON.stringify({
    type: 'batch',
    seq,
    sentAt: ts,
    serverDropped: 0,
    events: [
      { id: `e${seq}`, timestamp: ts, metric: 'cpu', value: seq, category: 'system', source: 'a' },
    ],
  });

/** Real timers on purpose: fake-indexeddb schedules its own work with timers. */
function boot(idb: IDBFactory, clock: { now: number }) {
  const worker = createFakeWorker<MainToWorker, WorkerToMain>((scope) =>
    startWorkerRuntime(scope, {
      now: () => clock.now,
      summaryIntervalMs: 10,
      aggregator: { graceMs: 0 },
      storage: { indexedDB: idb },
    }),
  );
  const got: WorkerToMain[] = [];
  worker.onmessage = (e) => got.push(e.data);
  return { worker, got };
}

describe('persistence through the worker runtime (fake IndexedDB)', () => {
  it('persists 1 s buckets, restores them after a reload, lists sessions and replays one', async () => {
    const idb = new IDBFactory();
    const clock = { now: T0 };

    // Session 1: 5 seconds of data
    const a = boot(idb, clock);
    await wait(30); // storage opens
    for (let s = 0; s < 5; s++) {
      a.worker.postMessage({ type: 'frames', raw: [frame(s, T0 + s * 1000 + 100)] });
      await wait(5);
    }
    clock.now = T0 + 6000;
    await wait(60); // ticks close the buckets and write them
    const ok = a.got.findLast((m) => m.type === 'summary');
    expect(ok?.type === 'summary' && ok.summary.storage).toMatchObject({ status: 'ok' });
    a.worker.terminate();

    // "Reload": a fresh worker restores history before any live data arrives
    clock.now = T0 + 10_000;
    const b = boot(idb, clock);
    await wait(40);
    b.worker.postMessage({
      type: 'view',
      view: {
        rangeMs: 60_000,
        metrics: ['cpu'],
        resolution: 'bucket',
        algorithm: 'none',
        maxPoints: 100,
      },
    });
    await wait(40);
    const chart = b.got.findLast((m) => m.type === 'chart');
    expect(chart?.type === 'chart' && chart.chart.series.cpu?.t).toEqual([
      T0,
      T0 + 1000,
      T0 + 2000,
      T0 + 3000,
      T0 + 4000,
    ]);
    const summary = b.got.findLast((m) => m.type === 'summary');
    expect(summary?.type === 'summary' && summary.summary.storage).toMatchObject({
      status: 'ok',
      restoredBuckets: 5,
    });

    // Sessions: the first one has buckets; the current one has none yet, so it's hidden
    b.worker.postMessage({ type: 'sessions' });
    await wait(30);
    const sessions = b.got.findLast((m) => m.type === 'sessions');
    expect(sessions?.type === 'sessions' && sessions.sessions).toHaveLength(1);
    const id = sessions?.type === 'sessions' ? sessions.sessions[0]!.id : '';

    // Replay at 30×: 5 s of session time passes in ~170 ms
    b.worker.postMessage({ type: 'replay', action: 'start', sessionId: id, speed: 30 });
    await wait(30);
    const started = b.got.findLast((m) => m.type === 'replay');
    expect(started?.type === 'replay' && started.state).toMatchObject({
      sessionId: id,
      from: T0,
      to: T0 + 5000,
    });
    for (let i = 0; i < 30; i++) {
      clock.now += 10;
      await wait(10);
    }
    const ended = b.got.findLast((m) => m.type === 'replay');
    expect(ended?.type === 'replay' && ended.state).toMatchObject({ ended: true });
    const replayChart = b.got.findLast((m) => m.type === 'chart');
    expect(replayChart?.type === 'chart' && replayChart.chart.replay?.sessionId).toBe(id);

    b.worker.postMessage({ type: 'replay', action: 'stop' });
    await wait(30);
    expect(b.got.findLast((m) => m.type === 'replay')).toEqual({ type: 'replay', state: null });
    b.worker.terminate();
  });

  it('runs without history when IndexedDB is unavailable', async () => {
    const blocked = {
      open: () => {
        throw new Error('blocked');
      },
    } as unknown as IDBFactory;
    const c = boot(blocked, { now: T0 });
    c.worker.postMessage({ type: 'frames', raw: [frame(0, T0)] });
    await wait(40);
    const s = c.got.findLast((m) => m.type === 'summary');
    expect(s?.type === 'summary' && s.summary).toMatchObject({
      totalEvents: 1,
      storage: { status: 'unavailable', message: 'blocked' },
    });
    c.worker.terminate();
  });
});
