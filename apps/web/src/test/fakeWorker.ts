/**
 * In-memory stand-in for a Worker, for testing main-thread ⇄ worker wiring in Vitest
 * (jsdom has no Worker). The `script` callback plays the role of the worker file.
 *
 * Mirrors the real behaviour that matters:
 *   - messages are COPIED (structuredClone): mutating an object after postMessage doesn't
 *     affect what the other side received, and functions/class instances can't be sent
 *   - delivery is async (next macrotask, via setTimeout 0): with fake timers use
 *     vi.advanceTimersByTime(1) — fake timers treat a 0 ms timeout as 1 ms, so (0) does
 *     NOT deliver; with real timers `await flush()`
 *   - after terminate(), nothing is delivered in either direction, and the cleanup function
 *     returned by `script` runs (a real terminate() kills the worker's timers)
 *
 * Usage:
 *   const worker = createFakeWorker<MainToWorker, WorkerToMain>((scope) => {
 *     scope.onmessage = (e) => scope.postMessage({ type: 'ready' });
 *   });
 *   const conn = createConnection(url, { createWorker: () => worker.asWorker() });
 */

export interface FakeWorkerScope<In, Out> {
  onmessage: ((event: { data: In }) => void) | null;
  postMessage(message: Out): void;
}

export interface FakeWorker<In, Out> {
  onmessage: ((event: { data: Out }) => void) | null;
  onerror: ((event: { message: string }) => void) | null;
  postMessage(message: In): void;
  terminate(): void;
  /** Simulate an uncaught error inside the worker (WBS 17.2). */
  crash(message: string): void;
  /** Typed as a real Worker for code that expects one. */
  asWorker(): Worker;
  readonly terminated: boolean;
  /** Number of postMessage calls from the main side (for batching tests, Task D). */
  readonly postedToWorker: number;
}

const nextTask = (fn: () => void) => setTimeout(fn, 0);

export function createFakeWorker<In, Out>(
  script: (scope: FakeWorkerScope<In, Out>) => void | (() => void),
): FakeWorker<In, Out> {
  let terminated = false;
  let postedToWorker = 0;

  const scope: FakeWorkerScope<In, Out> = {
    onmessage: null,
    postMessage(message) {
      if (terminated) return;
      const copy = structuredClone(message);
      nextTask(() => {
        if (!terminated) worker.onmessage?.({ data: copy });
      });
    },
  };

  const worker: FakeWorker<In, Out> = {
    onmessage: null,
    onerror: null,
    postMessage(message) {
      if (terminated) return;
      postedToWorker++;
      const copy = structuredClone(message);
      nextTask(() => {
        if (!terminated) scope.onmessage?.({ data: copy });
      });
    },
    terminate() {
      if (terminated) return;
      terminated = true;
      cleanup?.();
    },
    crash(message) {
      if (terminated) return;
      nextTask(() => worker.onerror?.({ message }));
    },
    asWorker() {
      return worker as unknown as Worker;
    },
    get terminated() {
      return terminated;
    },
    get postedToWorker() {
      return postedToWorker;
    },
  };

  // Declared after `worker` on purpose: terminate() only reads it once script() has returned.
  const cleanup = script(scope);
  return worker;
}

/** Let pending fake-worker deliveries run when NOT using fake timers. */
export const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
