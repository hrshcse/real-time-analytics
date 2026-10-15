import type { MainToWorker, WorkerToMain } from './contract';
import { createProcessor, type ProcessorOptions } from './processor';

/** The part of the worker global scope we use. Lets tests pass a fake scope. */
export interface WorkerScopeLike {
  onmessage: ((event: { data: MainToWorker }) => void) | null;
  postMessage(message: WorkerToMain): void;
}

export interface WorkerRuntimeOptions extends ProcessorOptions {
  /** How often to send a summary (only if changed). Matches the UI publish rate. */
  summaryIntervalMs?: number;
}

/**
 * Wires a scope's messages to a processor and sends summaries on a timer.
 * Returns a stop function (clears the timer). The real worker never stops; terminate() kills it.
 */
export function startWorkerRuntime(scope: WorkerScopeLike, options: WorkerRuntimeOptions = {}) {
  const processor = createProcessor(options);

  scope.onmessage = (event) => {
    try {
      processor.handle(event.data);
    } catch (err) {
      // Report and keep running: one bad message shouldn't kill the pipeline (WBS 17.2).
      scope.postMessage({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const timer = setInterval(() => {
    const summary = processor.tick();
    if (summary) scope.postMessage({ type: 'summary', summary });
  }, options.summaryIntervalMs ?? 250);

  return () => clearInterval(timer);
}
