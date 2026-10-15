import { describe, expect, it } from 'vitest';
import { createFakeWorker, flush } from './fakeWorker';

type In = { type: 'double'; values: number[] };
type Out = { type: 'result'; values: number[] };

const doubler = () =>
  createFakeWorker<In, Out>((scope) => {
    scope.onmessage = (e) =>
      scope.postMessage({ type: 'result', values: e.data.values.map((v) => v * 2) });
  });

describe('createFakeWorker', () => {
  it('round-trips messages asynchronously', async () => {
    const worker = doubler();
    const received: Out[] = [];
    worker.onmessage = (e) => received.push(e.data);
    worker.postMessage({ type: 'double', values: [1, 2] });
    expect(received).toEqual([]); // not synchronous
    await flush();
    await flush();
    expect(received).toEqual([{ type: 'result', values: [2, 4] }]);
    expect(worker.postedToWorker).toBe(1);
  });

  it('copies messages like structured clone', async () => {
    let seen: number[] = [];
    const worker = createFakeWorker<In, Out>((scope) => {
      scope.onmessage = (e) => (seen = e.data.values);
    });
    const values = [1, 2];
    worker.postMessage({ type: 'double', values });
    values.push(3); // mutate after sending
    await flush();
    expect(seen).toEqual([1, 2]);
  });

  it('delivers nothing after terminate', async () => {
    const worker = doubler();
    const received: Out[] = [];
    worker.onmessage = (e) => received.push(e.data);
    worker.postMessage({ type: 'double', values: [1] });
    worker.terminate();
    await flush();
    await flush();
    expect(received).toEqual([]);
    expect(worker.terminated).toBe(true);
  });

  it('reports crashes through onerror', async () => {
    const worker = doubler();
    let error = '';
    worker.onerror = (e) => (error = e.message);
    worker.crash('boom');
    await flush();
    expect(error).toBe('boom');
  });
});

describe('createFakeWorker cleanup', () => {
  it('runs the script cleanup on terminate', () => {
    let cleaned = 0;
    const worker = createFakeWorker<In, Out>(() => () => cleaned++);
    worker.terminate();
    worker.terminate();
    expect(cleaned).toBe(1);
  });
});
