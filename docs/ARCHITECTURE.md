# Architecture

## 1. Data flow

```text
WebSocket ──▶ main thread ──▶ frame buffer ──▶ Worker ──▶ processing ──▶ stores ──▶ React
 (server)     prefix check     (≤ 50 ms,        parse      aggregate      stats      KPIs
              control msgs     backpressure)    validate   downsample     chart      charts
                                                 seq        grid query     grid       grid
```

| Stage                                         | Where  | Code                                                         |
| --------------------------------------------- | ------ | ------------------------------------------------------------ |
| Generate + batch (50 ms ticks)                | server | `apps/server/src/generator.ts`, `session.ts`                 |
| Receive, classify frame by prefix             | main   | `apps/web/src/ws/connection.ts` (D12)                        |
| Buffer + backpressure                         | main   | `ws/frameBuffer.ts` (D21)                                    |
| Parse, seq, validate                          | worker | `processing/parse.ts`, `seqTracker.ts`, `shared/validate.ts` |
| Aggregate 1 s → 5 s/10 s/1 min, exact P95/P99 | worker | `processing/aggregate.ts` (D15)                              |
| Ring buffer (100K), grid queries              | worker | `processing/eventStore.ts`, `gridQuery.ts` (D19)             |
| Downsample (LTTB / every-Nth)                 | worker | `processing/downsample.ts`, `workers/chart.ts` (D18)         |
| Persist / restore / replay                    | worker | `workers/storage.ts`, `replay.ts` (D25–D28)                  |
| Publish to React                              | main   | 250 ms change check + rAF → `useSyncExternalStore` (D22)     |

**Why processing is separated from rendering:** the main thread has one job, keeping frames under
16 ms. Everything proportional to event volume (parsing 500-event frames, validating, sorting 100K
rows, building chart series) happens in the worker. What crosses back is proportional to _screen
size_: a summary, ≤ 300 points per chart, ~75 grid rows.

## 2. Main thread ⇄ worker contract

`apps/web/src/workers/contract.ts` — discriminated unions both sides import.

```text
MAIN → WORKER                         WORKER → MAIN
frames  { raw: string[] }             ack      { frames }          after every frames message
reset                                  summary  { totals, latest buckets, storage, lag… } ≤ 4/s
view    { ChartView | null }           chart    { downsampled series }                    ≤ 4/s
grid    { GridQuery | null, live }     grid     { total, offset, rows }      on query; ≤ 1/s live
config  { simulatedWorkMs }            sessions { SessionMeta[] }
sessions                               replay   { ReplayState | null }
replay  { start | pause | resume | stop | speed }   error { message }
```

Raw strings go in (one cheap copy each); small objects come out. The worker file is thin:
`processor.worker.ts` → `runtime.ts` (timers, IndexedDB) → `processor.ts` (pure, unit-tested).

## 3. WebSocket lifecycle

```text
            connect()                open
 disconnected ──────▶ connecting ───────────▶ connected ◀──────────┐
      ▲                                           │ close / 15 s    │ open (attempt = 0)
      │ disconnect() (any state)                  │ silence         │
      │                                           ▼                 │
      │       attempts exhausted / 4401     reconnecting ── timer ──┘
      └──────────────────────────────────── (1 s × 2ⁿ ± 20%, cap 30 s, 10 tries)
```

- Every socket handler checks `socket === ws`: StrictMode's extra connect/disconnect and late
  `close` events can't corrupt the current connection (D10).
- `hello` from a new server session → flush the buffer, `reset` the worker's seq, re-send the
  user's rate / start / stop (D30).
- The worker lives from `connect()` to `disconnect()`, not per socket, so totals and history
  survive a reconnect (D16).

## 4. Backpressure strategy

Three layers, each counted separately in the UI:

| Layer       | Trigger                            | Action                                                         |
| ----------- | ---------------------------------- | -------------------------------------------------------------- |
| Server      | socket buffer > 8 MB               | skip the frame (`serverDropped`)                               |
| Main thread | > 32 frames un-acked by the worker | hold; queue > 64 → drop **oldest** (`backpressureDropped`)     |
| Rendering   | always                             | coalesce to one publish per 250 ms tick, on an animation frame |

Measured with a deliberately slow worker: without backpressure, lag grows without bound (13 s
after 20 s); with it, lag stays under 1 s and drops are explicit (PERFORMANCE.md).

## 5. Persistence

IndexedDB `rta` (in the worker): `sessions` and `buckets` keyed `[sessionId, metric, start]`,
indexes `by_start` and `by_session`. Closed 1 s buckets only (6 records/s), 30-minute retention,
quota → prune + retry once. Startup restores the last 15 minutes into the charts; replay plays one
session through the charts on a virtual clock while the live stream continues.

## 6. Failure handling

| Failure                             | Behaviour                                         | User sees                              |
| ----------------------------------- | ------------------------------------------------- | -------------------------------------- |
| Server down / network drop          | backoff reconnect, worker + data kept             | "Reconnecting… 2/10 · 4s", Retry now   |
| Silent dead connection              | heartbeat timeout (15 s) → close 4000 → reconnect | same                                   |
| Retries exhausted                   | stop                                              | error banner + Reconnect               |
| Auth refused (4401)                 | never retried                                     | error banner explaining the token      |
| Malformed frame / invalid event     | counted by reason, dropped                        | Data quality cards                     |
| Worker exception                    | caught, reported, worker keeps running            | error banner + Restart worker          |
| IndexedDB blocked / quota / corrupt | live stream continues without history             | "history is off" banner                |
| Browser storage blocked             | preferences don't persist                         | nothing (silent)                       |
| Slow consumer                       | backpressure drops oldest                         | in-flight / drops / lag in Performance |
