/**
 * Collects raw batch frames on the main thread and hands them to the worker in one
 * postMessage (WBS 4.5, 10.2).
 *
 *   frames:  ▮   ▮ ▮    ▮            ▮ ▮
 *   buffer: [▮ ▮ ▮ ▮] ─ flush ─▶     [▮ ▮] ─ flush ─▶
 *            ↑ timer starts on the first frame into an EMPTY buffer (no idle wake-ups)
 *
 * Flushes when the first of these is hit: maxFrames, maxBytes, or maxWaitMs after the first
 * frame. maxWaitMs = 0 disables buffering (one post per frame): the "before" for experiments.
 */
export interface FrameBufferOptions {
  /** Flush when this many frames are waiting. */
  maxFrames?: number;
  /** Flush when this many characters are waiting (≈ bytes for our ASCII JSON). */
  maxBytes?: number;
  /** Flush this long after the first frame entered an empty buffer. 0 = no buffering. */
  maxWaitMs?: number;
  onFlush: (frames: string[]) => void;
}

export const DEFAULT_BUFFER = { maxFrames: 64, maxBytes: 1_000_000, maxWaitMs: 50 } as const;

export function createFrameBuffer(options: FrameBufferOptions) {
  const maxFrames = options.maxFrames ?? DEFAULT_BUFFER.maxFrames;
  const maxBytes = options.maxBytes ?? DEFAULT_BUFFER.maxBytes;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_BUFFER.maxWaitMs;

  let frames: string[] = [];
  let bytes = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let flushes = 0;

  function cancelTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function flush() {
    cancelTimer();
    if (frames.length === 0) return;
    const out = frames;
    frames = [];
    bytes = 0;
    flushes++;
    options.onFlush(out);
  }

  return {
    push(raw: string) {
      frames.push(raw);
      bytes += raw.length;
      if (maxWaitMs <= 0 || frames.length >= maxFrames || bytes >= maxBytes) flush();
      else if (timer === null) timer = setTimeout(flush, maxWaitMs);
    },
    flush,
    /** Discard everything waiting. Returns how many frames were dropped. */
    clear(): number {
      cancelTimer();
      const dropped = frames.length;
      frames = [];
      bytes = 0;
      return dropped;
    },
    get size() {
      return frames.length;
    },
    /** Number of flushes so far = posts to the worker. */
    get flushes() {
      return flushes;
    },
  };
}

export type FrameBuffer = ReturnType<typeof createFrameBuffer>;
