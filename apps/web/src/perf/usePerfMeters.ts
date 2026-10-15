import { useEffect, useState } from 'react';
import { drainRenderStats } from './renderStats';

export interface PerfMeters {
  fps: number | null;
  /** Long tasks (> 50 ms) in the last 10 s; null where PerformanceObserver('longtask') is unsupported. */
  longTasks: { count: number; totalMs: number } | null;
  /** React commits and render time per second, by Profiler id. */
  renders: Record<string, { commits: number; totalMs: number; maxMs: number }>;
}

/**
 * FPS (rAF loop), long tasks (PerformanceObserver) and React render stats, sampled once a
 * second. Runs only while `enabled`, so the measuring itself costs nothing when the panel is
 * closed (WBS 14).
 */
export function usePerfMeters(enabled: boolean): PerfMeters {
  const [meters, setMeters] = useState<PerfMeters>({ fps: null, longTasks: null, renders: {} });

  useEffect(() => {
    if (!enabled) return;
    let frames = 0;
    let raf = 0;
    const loop = () => {
      frames++;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const tasks: Array<{ at: number; ms: number }> = [];
    let observer: PerformanceObserver | null = null;
    const supportsLongTask =
      typeof PerformanceObserver !== 'undefined' &&
      (PerformanceObserver.supportedEntryTypes ?? []).includes('longtask');
    if (supportsLongTask) {
      observer = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) tasks.push({ at: e.startTime, ms: e.duration });
      });
      observer.observe({ type: 'longtask' });
    }

    drainRenderStats(); // start a clean window
    let last = performance.now();
    const timer = setInterval(() => {
      const t = performance.now();
      const fps = Math.round((frames * 1000) / (t - last));
      frames = 0;
      last = t;
      while (tasks.length && t - tasks[0]!.at > 10_000) tasks.shift();
      setMeters({
        fps,
        longTasks: supportsLongTask
          ? { count: tasks.length, totalMs: tasks.reduce((s, x) => s + x.ms, 0) }
          : null,
        renders: drainRenderStats(),
      });
    }, 1000);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(timer);
      observer?.disconnect();
    };
  }, [enabled]);

  return meters;
}
