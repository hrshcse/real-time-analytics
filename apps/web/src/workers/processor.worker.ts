/**
 * Processing worker entry (WBS 4.1). Kept thin: all logic is in processor.ts / runtime.ts so it
 * can be unit-tested without a real Worker.
 *
 * Loaded from ws/connection.ts with exactly this form, so Vite can detect and bundle it:
 *   new Worker(new URL('../workers/processor.worker.ts', import.meta.url), { type: 'module' })
 *
 * Type-checked by tsconfig.worker.json (WebWorker lib, no DOM).
 */
import { startWorkerRuntime, type WorkerScopeLike } from './runtime';

// `self` is DedicatedWorkerGlobalScope here; it structurally matches WorkerScopeLike.
startWorkerRuntime(self as unknown as WorkerScopeLike);
