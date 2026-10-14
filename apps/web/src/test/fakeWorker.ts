/**
 * In-memory stand-in for a Worker, for testing main-thread ⇄ worker wiring in Vitest
 * (jsdom has no Worker). The `script` callback plays the role of the worker file.
 *
 * Mirrors the real behaviour that matters:
 *   - messages are COPIED (structuredClone): mutating an object after postMessage doesn't
 *     affect what the other side received, and functions/class instances can't be sent
 *   - delivery is async (next macrotask): use fake timers + vi.advanceTimersByTime(0),
 *     or `await flush()`
 *   - after terminate(), nothing is delivered in either direction
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
  script: (scope: FakeWorkerScope<In, Out>) => void,
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
      terminated = true;
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

  script(scope);
  return worker;
}

/** Let pending fake-worker deliveries run when NOT using fake timers. */
export const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
