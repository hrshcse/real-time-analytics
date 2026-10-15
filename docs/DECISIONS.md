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

---

## Phase 4

### D21. Backpressure = in-flight budget + drop-oldest queue — Claude

The worker acks each frames message. The main thread posts at most `maxInFlightFrames` (32)
unacknowledged frames; extra frames wait in the buffer, which keeps at most 64 and drops the
**oldest** beyond that (WBS 10.3: preserve the latest data). First version only gated _whether_ to
flush and then sent the whole queue: in-flight sat at 256, not 64. Measured, then fixed by giving
the buffer a budget (send at most what the worker can take).

Dropped frames show up twice on purpose: `backpressureDropped` (main thread, deliberate) and as
seq gaps in `missedFrames` (worker). Server-side drops (`serverDropped`) are a third, separate
layer for a slow socket.

### D22. Publish = 250 ms change check + requestAnimationFrame — Claude

Socket and worker messages only mark state dirty. A 250 ms tick samples the rate meters and, if
anything changed, schedules one publish on the next animation frame. Status changes still publish
immediately. In a background tab rAF pauses, so the dashboard stops rendering at no cost. The
naive "publish on every message" mode stays in the app as the experiment baseline.

### D23. Instrumentation is opt-in and costs nothing when closed — Claude

The Performance panel's FPS loop and long-task observer only run while it's open. React render
times come from `<Profiler>` writing into plain counters (no setState), drained once a second.
`<Profiler>` is inert in production builds; the panel says so instead of showing zeros as data.

### D24. A "slow worker" switch instead of a separate load test — Claude

`simulatedWorkMs` busy-waits per frame inside the worker, making "producer faster than consumer"
(WBS 10.1) reproducible on any machine without changing the server.

---

## Phase 5

### D25. IndexedDB stores 1 s buckets, written from the worker; UI prefs use localStorage — Claude

Raw events (10K+/s) would make IndexedDB the bottleneck; closed 1 s buckets are 6 records/s
(measured: 72 records after 12 s) and are exactly what charts, reload recovery and replay need.
Writes happen in the worker (IndexedDB is available there), one transaction per second.
Chart preferences (range, metrics, downsampling) go to localStorage: a few hundred bytes, needed
synchronously at startup, per browser. Every storage access is wrapped: blocked or full storage
degrades features, it never breaks the live stream.

### D26. Retention: 30 minutes, pruned at start and every minute; quota → prune to 15 min and retry once — Claude

`QuotaExceededError` triggers one aggressive prune (half the retention) and a single retry. A
second failure marks storage as `error`, stops writing, and the banner says history is off while
live data continues (WBS 17.3 partial failure). Records are shape-checked on read; corrupt ones are
skipped and counted.

### D27. Reload recovery restores the last 15 minutes into the 1 s series only — Claude

Restored buckets carry stats but not raw values, so they can't feed exact 5 s / 1 min percentiles
(D15). They're display-only history; live buckets win on the same timestamp.

### D28. Replay runs in the worker on a virtual clock — Claude

The worker loads one session's buckets and advances `at` by real elapsed time × speed
(1/2/5/10/30×). While replaying the chart source switches; the live stream, KPIs and grid keep
running. Replay is bucket-resolution only (raw events aren't stored).

### D29. Reconnect: 1 s × 2ⁿ, cap 30 s, ±20% jitter, 10 attempts; heartbeat timeout 15 s — Claude

Jitter stops a fleet of clients reconnecting in lockstep after a server restart. The attempt
counter resets on a successful open. After 10 failures the client stops and shows "Reconnect".
Close codes 4401/4403 (auth refusals, Phase 7) are never retried. The server sends a heartbeat
every 5 s, so 15 s of silence means the connection is dead even if TCP hasn't noticed; the client
closes with 4000 and reconnects.

### D30. After reconnecting, re-apply what the user chose (closes the D9 follow-up) — Claude

`send()` records the last requested rate and start/stop. On `hello` from a new server session the
client re-sends only what differs. Commands are not queued while disconnected (D9); intent is.
Verified in the browser: server killed at 10K/s → reconnected automatically → server log shows
`setRate 10000` from the new connection.

---

## Phase 6

### D31. A dev-only Leak Lab instead of leaving deliberate leaks in the app — Claude

The three WBS leaks live in `src/lab/` behind `import.meta.env.DEV` and a lazy import, so they're
reproducible on demand and absent from production bundles (checked: no lab code in `dist/`).
Each leak ships with its fix, switchable in place, which makes before/after measurement trivial.

### D32. Measure retained memory with backing-store size, not just JS heap — Claude

Measured: a 100 MB leak moved the JS heap by 0.6 MB because typed-array data lives in
ArrayBuffer backing stores. Memory checks in this project use `Runtime.getHeapUsage`'s
`backingStorageSize` alongside `usedSize`, plus heap snapshots for retainer paths (docs/MEMORY.md).

### D33. `listenerCount` on stores — Claude

A cheap leak detector: after unmounting everything, every store must report 0 listeners. Used by
the app-level test and shown live in the Leak Lab.

---

## Phase 7

### D34. Auth placeholder via WebSocket subprotocol, refusals close with 4401 — Claude

Browsers can't set `Authorization` on a WebSocket, so the token rides in `Sec-WebSocket-Protocol`
(`token.<value>`), checked after the handshake so the client gets a meaningful close code (4401)
instead of a generic 1006. The client never retries 4401. Clearly a placeholder: the token ships in
the bundle; SECURITY.md describes the production design (single-use ticket).

### D35. Token-bucket rate limiting per connection, plus a per-IP connection cap — Claude

10 control messages/s with a burst of 10 is far above what a human clicking produces and stops a
script from spamming `setRate`. Rejections get an `error` reply; 5 s worth of rejections closes the
socket with 1008 (policy violation). The per-IP cap (20) answers 429 at the handshake.

### D36. CSP injected at build time only — Claude

Vite's dev server needs inline scripts for React Fast Refresh, so a strict CSP would break `npm run
dev`. A small Vite plugin adds the meta tag to production builds; verified the built app runs under
it (worker, WebSocket, Chart.js, no violations). Hosting should also send it as a header.

### D37. E2E tests run against the real server; network faults via `page.routeWebSocket` — Claude

No mocked backend: the suite starts the actual WebSocket server and Vite. Drops and auth refusals
are injected with Playwright's WebSocket routing (forward to the real server, then close with a
chosen code). Two tests had to account for React StrictMode's extra dev-only socket: "drop the
connection that's live", not "the first one".

---

## Phase 8

### D38. Two performance gates: bundle size (static) and runtime (browser) — Claude

`perf-budget.json` + `scripts/check-bundle-size.mjs` fail CI when gzip sizes exceed budgets
(~15% headroom over measured) or when dev-only code ships. `e2e-perf/perf.spec.ts` runs the
production build at 200 frames/s and fails on FPS < 40, > 10 publishes/s, > 40 in-flight frames,
heap > 60 MB or > 5 long tasks; a second test proves the gate would catch the naive renderer.
Budgets are looser than measured values so shared CI runners don't flake. Lighthouse was skipped:
it measures page load, and this app's risk is sustained runtime load.

### D39. Server on a container host, web on Vercel; `/healthz` on the same port — Claude

WebSockets need a long-lived process, which serverless functions aren't. The server now creates
its own HTTP server so platforms get a 200 health check on the WebSocket port; any other plain
HTTP request gets 426. Verified: replayed the Dockerfile's install/build steps, ran the bundle,
`/healthz` → 200, WebSocket `hello` received. (No Docker daemon was available, so the image
itself wasn't built here; CI builds it.)

### D40. Deploy jobs skip themselves until secrets exist — Claude

The deploy workflow is safe to merge before Vercel or Azure are set up: each job checks for its
secrets and logs a skip instead of failing. Workflows were validated with actionlint.
