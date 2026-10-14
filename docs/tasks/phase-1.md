# Phase 1 — BK's tasks

> **Status: implemented by Claude (2026-10-13) at BK's request.** Decisions made along the way are in
> [`../DECISIONS.md`](../DECISIONS.md) (D1–D11), several marked _BK to confirm_. The brief below is
> kept as the spec the code was built against.
>
> Where to look: Task A → `packages/shared/src/validate.ts` (+ `validate.test.ts`).
> Task B → `apps/web/src/ws/connection.ts`, `useConnection.ts`, `components/`.

---

## Task A — Event contract + validation (WBS 2.1, 4.3)

**Files:** `packages/shared/src/events.ts` (refine) · `packages/shared/src/validate.ts` (new) ·
`packages/shared/src/validate.test.ts` (new). Run: `npm test -w @rta/shared`

### Requirements

1. Decide, per field of `AnalyticsEvent`: required or optional; and whether `metric` should be
   narrowed from `string` to `MetricType` (and `category` to a union).
2. Write a validator that takes `unknown` and **never throws**. It returns either the event or the
   **reason** it was rejected. The reason is needed later to count invalid events by type (4.3).
3. Rules to cover:
   - `id`: non-empty string
   - `timestamp`: finite number, in **ms** — decide on a sane range (watch clock skew)
   - `metric`: one of `METRICS`
   - `value`: finite number — reject `NaN`, `Infinity`, and numeric strings like `"42"`
   - `category`, `source`: non-empty strings
   - Optional: per-metric ranges (cpu 0–100). Your call — write down why.
4. Tests: one valid case + one test per rule. Must reject all 4 server fault types:
   missing `timestamp`, `value: "NaN"`, `metric: "unknown-metric"`, `id: null`.

### How to handle

```text
unknown ──▶ is object? ──▶ id ok? ──▶ timestamp ok? ──▶ … ──▶ { ok: true, event }
               │              │             │
               ▼              ▼             ▼
       { ok:false,     { ok:false,   { ok:false, reason:'timestamp' }
         reason:'shape' } reason:'id' }
```

- Return type: a **discriminated union** `{ ok: true; event } | { ok: false; reason }` beats a
  plain `x is AnalyticsEvent` type guard, because a guard can't tell you _why_ it failed.
- Use `Number.isFinite(v)`, not `isNaN(v)`. `isNaN('')` is `false` (coerces to 0); `Number.isFinite('5')` is `false` (no coercion).
- TS trap: `METRICS.includes(x)` won't compile when `x` is `string`, because the array is
  `readonly MetricType[]`. Write a small `isMetric(x: unknown): x is MetricType` helper.
- This runs **~50K times/sec** in the worker. Keep it allocation-light: check fields in place, return
  the same object, no spreading/cloning. Have an answer for "why not Zod?" (cost per event vs safety
  and maintenance — either answer is fine if you can defend it).

### Done when

- [ ] All rule tests pass, including the 4 server fault cases
- [ ] `npm run typecheck` and `npm run lint` are clean
- [ ] Decisions (optional fields, timestamp range, Zod or not) noted in 1–2 lines each — they go into `DECISIONS.md` later

---

## Task B — WebSocket connection + ConnectionStatus (WBS 3.1–3.3)

**Suggested files:** `apps/web/src/ws/connection.ts` (plain TS, no React) ·
`apps/web/src/ws/useConnection.ts` (hook) · status indicator in `App.tsx`.
Protocol reference: `docs/PROTOCOL.md`. Types: `ServerMessage`, `ClientMessage` from `@rta/shared`.

### Requirements

1. `ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'`.
   `reconnecting` stays unused until Phase 5. For now, close → `disconnected`.
2. Connect on mount to `WS_URL` (`src/config.ts`); close on unmount.
3. Handle `open` / `message` / `error` / `close`. Parse each frame safely and route by `type`.
   Count **malformed frames** (invalid JSON), and count **missed frames** from `seq` gaps.
4. Expose: `status`, `send(msg: ClientMessage)`, last close code, and live stats
   (events/sec, malformed frames, missed frames, `serverDropped`).
5. **No React state update per message.** At a 50 ms tick that's 20 frames/sec (500 events each); at `TICK_MS=5` it's 200. Keep counters outside React
   and publish a snapshot at most ~4×/sec.
6. Header indicator: **text + colour** (e.g. "● Connected"), never colour alone.
7. Minimal test controls: Start, Stop, and a rate select (100 / 1K / 10K / 50K) that call `send()`.
   Unstyled is fine. Claude builds the real controls later (WBS 13).

### How to handle

```text
┌──────────── connection.ts (no React) ────────────┐
│  WebSocket ─▶ onmessage ─▶ JSON.parse ─▶ route   │
│                              │                   │
│                     counters (plain vars)        │
│  subscribe(listener)  getSnapshot()  send(msg)   │
└───────────────┬──────────────────────────────────┘
                │  snapshot every ~250 ms
                ▼
      useConnection()  ── useSyncExternalStore ──▶  <App/>
```

- **Keep the socket out of React.** Put it in a plain module with `subscribe` / `getSnapshot`, and
  read it in the hook with `useSyncExternalStore` (React 18+). This also makes Phase 2 easy if you
  decide to move the socket into the worker: only `connection.ts` changes.
- `getSnapshot` must return the **same object** until something changes. Returning a new object on
  every call causes an infinite re-render loop.
- **StrictMode (dev) mounts → unmounts → mounts.** You'll see 2 connections in the server log; the
  first must be closed. Trap: the old socket's `onclose` fires _after_ the new one connects and sets
  status to `disconnected`. Fix: detach handlers before `close()`, or ignore events from a socket
  that isn't the current one.
- `error` carries no details (browser security) and is always followed by `close`. Drive state from
  `close`, and log `event.code` (1000 / 1001 / 1006 — see PROTOCOL.md). Phase 5 reconnect logic will
  depend on it.
- `send()` when not OPEN: **drop or queue?** Your decision — note why.
- Heartbeat arrives every 5 s. Record `lastMessageAt` now; the "silent for 15 s → dead" check comes in Phase 5.

### Done when

- [ ] `npm run dev`: status goes connecting → connected; events/sec ≈ selected rate (±5%)
- [ ] Ctrl+C the server → `disconnected` with close code shown; restart server + reload → `connected`
- [ ] Server log shows only **one** open connection after page load (StrictMode handled)
- [ ] React DevTools Profiler at 10K/s: `App` renders ≤ ~4×/sec
- [ ] `BAD_FRAME_PCT=10` in `apps/server/.env` → malformed counter rises, nothing crashes
- [ ] Typecheck + lint clean

### Interview hooks this task gives you (WBS 24)

"Why not polling?" · "How do you detect disconnects?" · "How do you prevent duplicate processing?" (`seq`) ·
"Why is the socket outside React?"
