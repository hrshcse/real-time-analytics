import type { AnalyticsEvent } from '@rta/shared';

/**
 * Fixed-capacity ring buffer of the most recent valid events (WBS 9.1, 9.4).
 *
 *   capacity 5:  [e5 e6 e2 e3 e4]   head ─▶ index 2 (oldest)
 *   push(e7)  :  [e5 e6 e7 e3 e4]   oldest (e2) overwritten, no array shifting
 *
 * Memory is bounded by `capacity` no matter how long the stream runs (WBS 16.4).
 */
export function createEventStore(capacity = 100_000) {
  const buf: Array<AnalyticsEvent | undefined> = new Array(capacity);
  let head = 0; // next write position
  let size = 0;
  let version = 0;

  return {
    push(events: readonly AnalyticsEvent[]) {
      if (events.length === 0) return;
      for (const e of events) {
        buf[head] = e;
        head = (head + 1) % capacity;
        if (size < capacity) size++;
      }
      version++;
    },
    /** i = 0 is the NEWEST event. */
    newest(i: number): AnalyticsEvent | undefined {
      if (i < 0 || i >= size) return undefined;
      return buf[(head - 1 - i + capacity * 2) % capacity];
    },
    /** Visit newest → oldest. Return false from the callback to stop early. */
    forEachNewest(fn: (e: AnalyticsEvent) => boolean | void) {
      for (let i = 0; i < size; i++) {
        if (fn(buf[(head - 1 - i + capacity * 2) % capacity]!) === false) return;
      }
    },
    clear() {
      buf.fill(undefined);
      head = 0;
      size = 0;
      version++;
    },
    get size() {
      return size;
    },
    get capacity() {
      return capacity;
    },
    /** Increments on every change; lets callers skip recomputing unchanged results. */
    get version() {
      return version;
    },
  };
}

export type EventStore = ReturnType<typeof createEventStore>;
