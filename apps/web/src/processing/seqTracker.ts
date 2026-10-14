/**
 * Tracks batch sequence numbers for one connection.
 *
 *   expected 0 ─▶ seq 0 ✓ ─▶ seq 3 ✓ (missed += 2) ─▶ seq 3 ✗ duplicate ─▶ seq 4 ✓
 *
 * WebSocket runs over TCP, so gaps/duplicates can't happen within one connection today; this
 * makes the guarantee explicit and is what a resume-after-reconnect protocol would build on.
 */
export function createSeqTracker() {
  let expected = 0;
  let missed = 0;
  let duplicates = 0;

  return {
    /** Returns false if the batch was already processed and must be skipped. */
    accept(seq: number): boolean {
      if (seq < expected) {
        duplicates++;
        return false;
      }
      if (seq > expected) missed += seq - expected;
      expected = seq + 1;
      return true;
    },
    /** Call on a new connection (`hello`): seq restarts at 0 per connection. */
    reset() {
      expected = 0;
    },
    get missed() {
      return missed;
    },
    get duplicates() {
      return duplicates;
    },
  };
}

export type SeqTracker = ReturnType<typeof createSeqTracker>;
