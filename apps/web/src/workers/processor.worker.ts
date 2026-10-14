/**
 * Processing worker — Task C (BK) builds this out. See docs/tasks/phase-2.md.
 *
 * This stub exists so the worker toolchain (tsconfig.worker.json, ESLint worker globals,
 * Vite worker bundling) is verified before real code goes in. It's not wired up yet.
 *
 * Load it from the main thread with exactly this form, so Vite can detect and bundle it:
 *   new Worker(new URL('../workers/processor.worker.ts', import.meta.url), { type: 'module' })
 */
import { parseServerMessage } from '../processing';

self.onmessage = (event: MessageEvent<unknown>) => {
  // `self` here is the worker scope (lib: WebWorker): postMessage takes no targetOrigin.
  // Importing ../processing means tsconfig.worker.json also checks that folder is DOM-free.
  self.postMessage({ type: 'echo', parsedType: parseServerMessage(event.data)?.type ?? null });
};
