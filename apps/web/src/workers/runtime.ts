import type { MainToWorker, WorkerToMain } from './contract';
import { createProcessor, type ProcessorOptions } from './processor';

/** The part of the worker global scope we use. Lets tests pass a fake scope. */
export interface WorkerScopeLike {
  onmessage: ((event: { data: MainToWorker }) => void) | null;
  postMessage(message: WorkerToMain): void;
}

export interface WorkerRuntimeOptions extends ProcessorOptions {
  /** How often to send summaries/chart data (only if changed). Matches the UI publish rate. */
  summaryIntervalMs?: number;
}

/**
 * Wires a scope's messages to a processor and sends updates on a timer.
 * Returns a stop function (clears the timer). The real worker never stops; terminate() kills it.
 */
export function startWorkerRuntime(scope: WorkerScopeLike, options: WorkerRuntimeOptions = {}) {
  const processor = createProcessor(options);
  const report = (err: unknown) =>
    scope.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });

  scope.onmessage = (event) => {
    try {
      processor.handle(event.data);
      if (event.data.type === 'frames')
        scope.postMessage({ type: 'ack', frames: event.data.raw.length });
      // A grid query is answered immediately: scrolling must not wait for the next tick.
      const page = processor.takeGridPage();
      if (page) scope.postMessage({ type: 'grid', page });
    } catch (err) {
      report(err); // keep running: one bad message shouldn't kill the pipeline (WBS 17.2)
    }
  };

  const timer = setInterval(() => {
    try {
      const { summary, chart, grid } = processor.tick();
      if (summary) scope.postMessage({ type: 'summary', summary });
      if (chart) scope.postMessage({ type: 'chart', chart });
      if (grid) scope.postMessage({ type: 'grid', page: grid });
    } catch (err) {
      report(err);
    }
  }, options.summaryIntervalMs ?? 250);

  return () => clearInterval(timer);
}
