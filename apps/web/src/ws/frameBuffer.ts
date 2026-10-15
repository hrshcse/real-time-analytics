/**
 * Collects raw batch frames on the main thread and hands them to the worker in one
 * postMessage (WBS 4.5, 10.2), with backpressure (WBS 10.3).
 *
 *   frames:  ▮   ▮ ▮    ▮            ▮ ▮
 *   buffer: [▮ ▮ ▮ ▮] ─ flush ─▶     [▮ ▮] ─ flush ─▶
 *            ↑ timer starts on the first frame into an EMPTY buffer (no idle wake-ups)
 *
 * Backpressure: `budget()` says how many frames the worker can take right now. A flush sends at
 * most that many (oldest first) and holds the rest; 0 holds everything. Held frames pile up to
 * `maxQueuedFrames`; past that the OLDEST are dropped (and counted), so the newest data always
 * survives and memory stays bounded.
 *
 *   worker busy:  [▮1 ▮2 ▮3 … ▮256] + ▮257  →  drop ▮1  →  [▮2 … ▮257]
 *
 * maxWaitMs = 0 disables buffering (one post per frame): the "before" for experiments.
 */
export interface FrameBufferOptions {
  /** Flush when this many frames are waiting. */
  maxFrames?: number;
  /** Flush when this many characters are waiting (≈ bytes for our ASCII JSON). */
  maxBytes?: number;
  /** Flush this long after the first frame entered an empty buffer. 0 = no buffering. */
  maxWaitMs?: number;
  /** Hard cap while flushing is blocked; beyond it the oldest frames are dropped. */
  maxQueuedFrames?: number;
  /** Frames the consumer can accept now (backpressure). Call flush() again when it grows. */
  budget?: () => number;
  onFlush: (frames: string[]) => void;
}

export const DEFAULT_BUFFER = {
  maxFrames: 64,
  maxBytes: 1_000_000,
  maxWaitMs: 50,
  maxQueuedFrames: 64,
} as const;

export function createFrameBuffer(options: FrameBufferOptions) {
  const maxFrames = options.maxFrames ?? DEFAULT_BUFFER.maxFrames;
  const maxBytes = options.maxBytes ?? DEFAULT_BUFFER.maxBytes;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_BUFFER.maxWaitMs;
  const maxQueued = options.maxQueuedFrames ?? DEFAULT_BUFFER.maxQueuedFrames;
  const budget = options.budget ?? (() => Infinity);

  let frames: string[] = [];
  let bytes = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let flushes = 0;
  let dropped = 0;

  function cancelTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function flush() {
    cancelTimer();
    const n = Math.min(frames.length, Math.max(0, Math.floor(budget())));
    if (n === 0) return; // empty, or held: the owner calls flush() again later
    const out = n === frames.length ? frames : frames.slice(0, n);
    frames = n === frames.length ? [] : frames.slice(n);
    bytes = frames.reduce((sum, f) => sum + f.length, 0);
    flushes++;
    options.onFlush(out);
  }

  return {
    push(raw: string) {
      frames.push(raw);
      bytes += raw.length;
      if (frames.length > maxQueued) {
        const old = frames.shift()!; // drop the oldest, keep the latest (WBS 10.3)
        bytes -= old.length;
        dropped++;
      }
      if (maxWaitMs <= 0 || frames.length >= maxFrames || bytes >= maxBytes) flush();
      else if (timer === null) timer = setTimeout(flush, maxWaitMs);
    },
    flush,
    /** Discard everything waiting. Returns how many frames were dropped. */
    clear(): number {
      cancelTimer();
      const n = frames.length;
      frames = [];
      bytes = 0;
      return n;
    },
    get size() {
      return frames.length;
    },
    /** Number of flushes so far = posts to the worker. */
    get flushes() {
      return flushes;
    },
    /** Frames dropped because the queue overflowed while held (backpressure). */
    get dropped() {
      return dropped;
    },
  };
}

export type FrameBuffer = ReturnType<typeof createFrameBuffer>;
