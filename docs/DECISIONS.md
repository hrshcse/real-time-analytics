# Technical Decisions

Short records: what was decided, why, and what was traded away. "Owner" = who made the call.
Entries marked **BK to confirm** were made by Claude while implementing; keep, change or
overrule them.

---

## Phase 1

### D1. All `AnalyticsEvent` fields required — Claude, BK to confirm

The server always sends every field. Optional fields would push `undefined` checks into every
consumer (aggregation, chart, grid).

### D2. `metric` and `category` narrowed to unions; `source` left as `string` — BK

`metric: MetricType` lets later code use `Record<MetricType, …>` with exhaustiveness checks.
Categories are `user | system | application` (BK's list; the generator emits `system` and
`application`, `user` is reserved). `source` is an open set of host names.

### D3. Hand-written validator, not Zod — Claude, BK to confirm

Runs ~50K times/sec. A hand-written check does no allocation on the happy path and returns the
same object. Zod gives a single source of truth for types + validation and better error messages,
at a per-event cost. Revisit if the event shape grows or changes often.

### D4. Validator returns `{ ok, event } | { ok: false, reason }` — Claude

A plain type guard (`x is AnalyticsEvent`) can't say _why_ an event failed, and WBS 4.3 needs
invalid counts by reason. `reason` is a union so `Record<InvalidReason, number>` stays exhaustive.

### D5. Timestamp window: ≤ 1 h old, ≤ 60 s in the future — Claude, BK to confirm

Rejects garbage (0, seconds instead of ms, far future) while tolerating clock differences between
server and browser. `now` is a parameter so the function stays pure and tests are deterministic.
Risk: a client clock more than 60 s behind the server rejects everything. That shows up clearly as
`timestamp` in the invalid-by-reason counter.

### D6. No range checks on `value` (e.g. cpu 0–100) — Claude, BK to confirm

The validator checks shape, not business rules. An out-of-range CPU value is a data-quality signal
to display, not malformed input to drop.

### D7. WebSocket stays on the main thread; processing moves to the worker — BK (2026-10-13)

The socket lives in `apps/web/src/ws/connection.ts` on the main thread and forwards raw frames to
the worker, as the WBS describes. Chosen over opening the socket inside the worker.

- **Gain:** connection state, close codes and control messages stay where the UI is, with no
  round trip through the worker. Simpler to debug in DevTools.
- **Cost:** every frame arrives on the main thread first and is copied once more by `postMessage`
  (structured clone). At 10K events/sec with 50 ms ticks that's ~20 frames/sec and ~1.5 MB/s copied.
- **Watch:** if main-thread time from `onmessage` + `postMessage` shows up in Phase 4 profiling,
  revisit. Only `connection.ts` and the worker contract would change.

### D8. React reads the connection via `useSyncExternalStore`, published ≤ 4×/sec — Claude

Counters are plain variables; a 250 ms timer publishes a new snapshot only when something changed.
Status changes publish immediately. Measured: the events/sec card updated 19 times in 5 s at
10K events/sec (20 frames/sec of ~500 events each).

### D9. `send()` drops (returns `false`) when the socket isn't open — Claude, BK to confirm

Queueing risks replaying stale commands (e.g. an old `setRate`) into a fresh server session after
a reconnect. Phase 5 should re-apply the desired state on reconnect instead.

### D10. Stale-socket guard instead of relying on close order — Claude

Every socket handler checks `socket === ws`. StrictMode (dev) does connect → disconnect → connect,
and the first socket's `close` fires after the second connects. A CONNECTING socket is closed when
it opens, which avoids the browser's "closed before the connection is established" warning.

### D11. `seq` gaps → missed frames; `seq` below expected → skipped as duplicate — Claude

WebSocket runs over TCP, so gaps and duplicates can't happen within one connection today. The
check makes the guarantee explicit and becomes useful if a resume-after-reconnect protocol is added.

---

## Phase 2

### D12. Batch frames recognised by prefix and forwarded unparsed — Claude, BK to confirm

`raw.startsWith('{"type":"batch"')` → straight into the frame buffer; everything else (`hello`,
`status`, `heartbeat`, `error`) is parsed on the main thread. Our server always writes `type` first
(`JSON.stringify` keeps insertion order). If that ever changes, batches fall through to the parse
path and are still forwarded: slower, never wrong. Chosen over parsing everything on main (defeats
the worker) and sending control frames through the worker (extra hop for UI state).

### D13. `disconnect()` drops buffered frames and counts them; an unexpected close flushes them — Claude, BK to confirm

`disconnect()` terminates the worker, so anything still buffered has nowhere to go:
`droppedOnDisconnect` records it. On an unexpected close the worker is still alive (D16), so the
buffer is flushed and nothing received is lost.

### D14. Late events are dropped and counted — Claude, BK to confirm

A 1 s bucket closes 250 ms (grace) after its end and is then published. An event that arrives
for a closed bucket increments `lateEvents` instead of changing a published number. With our
generator late events don't occur; the counter proves it.

### D15. Exact percentiles for every window — Claude, BK to confirm

Each 1 s bucket sorts its values once on close (`Float64Array.sort()` is numeric; plain
`Array.sort()` would sort as strings). 5 s / 10 s / 1 min buckets concatenate the sorted 1 s
arrays and sort again. Raw values are kept only for the largest window (60 s), then dropped.
Cost at 10K events/sec: ~100K values per metric once a minute, in the worker. Alternative if that
grows: fixed log-spaced histograms (approximate, mergeable by adding counts, constant memory).
Never average percentiles: the tests show the average of five 1 s p99s differs from the 5 s p99.

### D16. Worker lives from `connect()` to `disconnect()`, not per socket — Claude, BK to confirm

An unexpected close (server restart, network drop) keeps the worker, so totals and aggregate
history survive and Phase 5 reconnection can resume into the same pipeline. `hello` sends `reset`
so `seq` restarts without false gaps. `disconnect()` (user action / unmount) terminates it (WBS 12.2).
Verified in the browser: worker count 1 after the server died, 0 after Disconnect.

---

## Phase 3

### D17. Small multiples: one chart per metric, avg + p95 — Claude

Metrics have unrelated units (%, ms, KB/s), so one shared y-axis would flatten most lines and a
dual axis misleads. Each metric gets its own chart and scale. p95 is drawn dashed (colour + dash
pattern + legend, so identity is never colour alone) and hidden for `errors`, whose 0/1 values make
p95 meaningless; its bucket average _is_ the error rate and is shown as a percentage. Colours
(`#3987e5`, `#d95926`) passed the palette validator on the dark surface.

### D18. Downsampling in the worker; LTTB by default, 300 points — Claude

The worker sends ≤ `maxPoints` per metric, so the main thread never touches the full series.
LTTB is the default because it keeps outliers: on ~16.7K raw error events it kept ~70% of error
spikes, every-Nth kept 4–10% (see PERFORMANCE.md). Chart.js runs with `animation: false`,
`parsing: false`, `normalized: true`, and a linear x-axis with our own time formatting (no date
adapter dependency).

### D19. The grid queries the worker; the main thread renders only visible rows — Claude

Sort/filter/search over 100K events runs in the worker; the main thread asks for a page
(offset, limit ≈ 75) and renders ~20 rows. Live refresh is capped at 1 Hz because a non-time sort
of 100K rows costs ~45 ms in the worker; time-descending needs no sort (ring buffer order).
"Freeze" stops refreshing. Rows are fixed-height (28 px), which keeps index ↔ pixel math trivial;
variable heights would need measurement and an offset index.
Events are immutable, so "update existing records" (WBS 9.4) reduces to add-new / evict-oldest.

### D20. Separate external stores for stats, chart and grid — Claude

A chart update re-renders only the charts; a grid page only the grid. One combined snapshot would
re-render the whole dashboard for each.
