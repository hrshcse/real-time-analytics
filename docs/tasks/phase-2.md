# Phase 2 — Data processing (WBS 4–5)

Decision in force: **D7 — socket on the main thread, processing in the worker.**
Order: **C → D → E** (each builds on the previous). Ask when unclear; say "Claude, take this" for
anything familiar.

## Already done (Claude)

| What              | Where                                                                               | Why it matters to you                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Safe frame parser | `apps/web/src/processing/parse.ts`                                                  | `parseServerMessage(raw)` → `ServerMessage \| null`, never throws                                       |
| Batch validation  | `processing/validateEvents.ts`                                                      | Valid events + running invalid counts by reason                                                         |
| Seq tracking      | `processing/seqTracker.ts`                                                          | Missed / duplicate frames                                                                               |
| Worker toolchain  | `tsconfig.worker.json`, ESLint worker globals, `typecheck`/`build` run both configs | DOM and WebWorker types conflict in one TS program (TS6200), so worker entry files get their own config |
| Worker stub       | `src/workers/processor.worker.ts`                                                   | Proven to bundle and run in dev and prod. Replace its body                                              |
| Fake worker       | `src/test/fakeWorker.ts`                                                            | jsdom has no `Worker`; this copies messages (structuredClone) and delivers async like the real one      |

`connection.ts` already uses the three helpers, so moving work to the worker is mostly moving
calls, not rewriting logic.

**Rule:** everything under `src/processing/` must stay DOM-free (no `window`, `document`, React).
`tsc -p tsconfig.worker.json` fails if it isn't.

---

## Task C — Worker contract + main ⇄ worker plumbing (WBS 4.1, 3.3)

**Files:** `src/workers/contract.ts` (new) · `src/workers/processor.worker.ts` ·
`src/workers/processor.ts` (new, pure logic) · `src/ws/connection.ts` (wire it in)

### Requirements

1. Define the message types in `contract.ts` as discriminated unions, one per direction:
   `MainToWorker` and `WorkerToMain`. Both sides import them, so a typo in `type` is a compile error.
2. Batches go to the worker as the **raw string**. Parsing, seq tracking and validation happen there.
   Control frames (`hello`, `status`, `heartbeat`, `error`) stay on the main thread; the UI needs them.
3. The worker sends back a **summary** (totals, invalid by reason, missed/duplicate frames,
   processing time). Throttle it to about 4 per second, the same as the UI publish rate. Don't send
   one message per batch.
4. Lifecycle: create the worker in `connect()`, `terminate()` it in `disconnect()` and on close
   (WBS 12.2). Handle StrictMode the same way as the socket.
5. Worker errors (`onerror`) → surface in the snapshot (e.g. `workerError: string | null`). Don't crash.
6. Measure inside the worker: `performance.now()` around each batch → report `processingMs`
   (sum and max per summary).

### How to handle

```text
 MAIN THREAD                                         WORKER
 ───────────                                         ──────
 ws.onmessage(raw)
   │ peek type ──▶ control? ─▶ handle here (UI state)
   │
   └─ batch ─▶ worker.postMessage({type:'frame', raw}) ──▶ parse → seq → validate → counters
                                                                   │  every ~250 ms
 snapshot ◀── onmessage({type:'summary', …}) ◀────────────────────┘
```

- **Deciding batch vs. control without parsing the whole frame on the main thread** is the key
  design question. Options:
  - (a) Parse everything on main, send the parsed object. Simple, but it defeats the purpose:
    parsing _is_ the expensive part, and `postMessage` then deep-copies the object too.
  - (b) Prefix check: `raw.startsWith('{"type":"batch"')`. Our server always writes `type` first.
    Fast, but it couples you to the server's key order. Document it.
  - (c) Send everything raw to the worker, and have it send control messages back. One code path,
    but status updates take an extra hop.

  Pick one and record it as D12.

- **Vite only bundles the worker if you write exactly**
  `new Worker(new URL('../workers/processor.worker.ts', import.meta.url), { type: 'module' })`.
  A variable instead of the literal URL breaks detection.
- **Keep the worker file thin.** Put logic in `processor.ts` as
  `createProcessor()` → `{ handle(msg): void; summary(): WorkerSummary }`, test it directly, and
  have `processor.worker.ts` only wire `self.onmessage` to it.
- **postMessage costs:** strings are copied as one block (cheap); objects are walked field by field
  (expensive for 500 events). That's why raw strings go in and a small summary comes out.
- **Testability:** let `createConnection` accept an optional `createWorker: () => Worker` (like
  `WebSocketImpl`), so tests can pass `createFakeWorker(...).asWorker()`.
- `seq` must reset on `hello`. `hello` is handled on the main thread and seq lives in the worker,
  so you need a `reset` message in the contract.

### Done when

- [ ] Same numbers on screen as Phase 1 (events/sec, invalid by reason, malformed, missed), now
      computed in the worker
- [ ] Chrome DevTools → Sources → Threads shows the worker while connected, and it's gone after
      Disconnect
- [ ] `processingMs` visible (temporary card is fine)
- [ ] Tests: `processor.ts` unit tests + one wiring test with the fake worker
- [ ] `npm run typecheck` (both configs) and `npm run lint` clean

**Interview hooks:** "Why a worker?" · "What does `postMessage` cost?" · "How do you test worker code?"

---

## Task D — Batch buffer between socket and worker (WBS 4.5, prep for 10.2)

**Files:** `src/ws/frameBuffer.ts` (new, pure) + wiring in `connection.ts`

### Requirements

1. Collect batch frames on the main thread. Send them to the worker as **one** message
   (`{ type: 'frames', raw: string[] }`) when either limit is hit:
   - size: `maxFrames` (or `maxBytes`, summed `raw.length`)
   - time: `maxWaitMs` after the **first** frame entered an empty buffer
2. Both limits configurable. Try 16 / 50 / 100 ms (WBS 10.2).
3. Flush on disconnect, or drop and count it. Decide and record as D13. Never post to a
   terminated worker.
4. Count `postsToWorker` per second and show it next to frames/sec.

### How to handle

```text
frames:  ▮  ▮ ▮   ▮    ▮ ▮▮ ▮          (20/sec at 50 ms ticks, 200/sec at TICK_MS=5)
buffer: [▮ ▮ ▮ ▮]──flush──▶ worker   (1 post per maxWaitMs or maxFrames)
timer:   ↑ starts on first frame, not on an interval
```

- Use `setTimeout` started by the first frame, not `setInterval`: an idle stream then costs no
  wake-ups.
- You can't count events without parsing, so limit by **frames or bytes**. Bytes track real cost
  better (at 50 ms ticks a 50K/s frame holds 2,500 events, a 100/s frame holds 5).
- **Be honest about the gain:** the server already batches into 50 ms ticks, so at default settings
  you go from ~20 to ~20 posts/sec. Set `TICK_MS=5` in `apps/server/.env` to get 200 frames/sec;
  that's where buffering shows (200 → ~20 posts/sec at `maxWaitMs=50`).
- `frameBuffer.ts` takes a `flush(frames)` callback and is pure, so test it with
  `vi.useFakeTimers()`. `fakeWorker.postedToWorker` counts posts in wiring tests.

### Done when

- [ ] With `TICK_MS=5` at 10K/s: posts/sec ≈ 1000 / `maxWaitMs`, and totals still match (no loss)
- [ ] Unit tests: size flush, time flush, timer only starts when non-empty, flush/drop on dispose
- [ ] Before/after posts/sec noted for `PERFORMANCE.md` (measured, not estimated)

---

## Task E — Time-bucket aggregation with P95/P99 (WBS 5.1–5.3)

**Files:** `src/processing/aggregate.ts` (new, pure, DOM-free) + `aggregate.test.ts`, called from
`processor.ts`

### Requirements

1. Per **metric**, per **time bucket**: `count`, `sum` (→ avg), `min`, `max`, `p95`, `p99`.
2. Windows: 1 s, 5 s, 10 s, 1 min (WBS 5.2).
3. Derived metrics (WBS 5.3): events/sec, error rate (`errors` metric: share of events with
   value 1), dropped = invalid + missed + serverDropped.
4. Bounded memory: keep only the last N buckets per window (e.g. 15 min of 1 s buckets = 900).
   Evict older ones.
5. Late events (timestamp in an older bucket that's still kept): include or drop? Decide and record
   as D14.
6. The worker summary includes the latest **closed** 1 s bucket per metric. Charts come in Phase 3.

### How to handle

```text
event.timestamp = 10:00:03.742
bucketStart(ts, 1000) = ts - (ts % 1000) = 10:00:03.000

 cpu  ┌ 10:00:01 ┐┌ 10:00:02 ┐┌ 10:00:03 ┐ ← open (still filling)
      │ n,Σ,min, ││ n,Σ,min, ││          │
      │ max,p95  ││ max,p95  ││          │
      └──────────┘└──────────┘└──────────┘
                     ▲ latest closed → summary
```

- **count / sum / min / max can be merged:** a 5 s bucket = merge of five 1 s buckets. Do one pass
  over the events (into 1 s buckets) and build the larger windows from those.
- **Percentiles can't be merged by averaging.** The average of five p95s is not the p95 of the
  five seconds. This is the interview trap. Options:
  1. Keep raw values per 1 s bucket, sort on close, read the index. Exact; fine at ~1.7K values
     per metric per second.
  2. For 1 min windows, merge the sorted 1 s arrays (or the raw values) and sort. Exact, but costs
     up to 100K values per metric.
  3. Fixed histogram per bucket (e.g. log-spaced bins). Approximate, but merges by adding counts,
     and memory is fixed. This is what Prometheus / HDR Histogram do.

  Start with (1) for 1 s. Choose (2) or (3) for larger windows and record it as D15.

- **Percentile definition (nearest rank):** `sorted[Math.ceil((p * n) / 100) - 1]` (multiply first to dodge float error). Test with values
  1..100 → p95 = 95, p99 = 99. With 1 value, every percentile = that value.
- `Float64Array` for values cuts GC pressure versus `number[]` (Phase 4 measures it).
- Keep it pure: `createAggregator({ windowsMs, retain })` → `add(events)`, `closedBuckets(now)`. Test
  with hand-made timestamps; no timers needed.

### Done when

- [ ] Unit tests: bucket boundaries (…999 vs …000), min/max/avg, p95/p99 on 1..100, single value,
      eviction past `retain`, merge correctness for 5 s
- [ ] Error rate ≈ 2% with the default generator (it emits errors ~2% of the time)
- [ ] Summary shows the latest 1 s bucket for each metric (temporary text is fine)

**Interview hooks:** "Why can't you average percentiles?" · "How do you bound memory?" ·
"Exact vs approximate percentiles — trade-offs?"
