# WebSocket Protocol

One JSON object per frame, discriminated by `type`. Types live in
`packages/shared/src/protocol.ts`.

```text
Browser                                Server
   │ ─── connect ───────────────────────▶ │
   │ ◀── hello {rate, tickMs, running} ── │
   │ ◀── batch {seq:0, events:[…]} ────── │  every TICK_MS (50 ms)
   │ ◀── batch {seq:1, events:[…]} ────── │
   │ ◀── heartbeat ────────────────────── │  every HEARTBEAT_MS (5 s)
   │ ─── setRate {rate:10000} ──────────▶ │
   │ ◀── status {rate:10000, …} ───────── │
```

## Server → client

| type        | Fields                                 | Notes                                                                       |
| ----------- | -------------------------------------- | --------------------------------------------------------------------------- |
| `hello`     | `serverTime, rate, tickMs, running`    | First frame after connect                                                   |
| `batch`     | `seq, sentAt, serverDropped, events[]` | `rate × tickMs / 1000` events per frame. 10K/s at 50 ms = ~500 events/frame |
| `status`    | `running, rate, baseRate, burstEndsAt` | Sent after every control message and when a burst ends                      |
| `heartbeat` | `serverTime`                           | Sent even when the stream is stopped, so silence = dead connection          |
| `error`     | `message`                              | Bad control message                                                         |

**`seq`** starts at 0 per connection and increments by 1 per batch. A gap means frames were lost.
**`serverDropped`** counts frames the server skipped because the client's socket buffer was
over `MAX_BUFFERED_BYTES` (server-side backpressure).

Events are spread evenly across the tick: timestamps fall in `[sentAt − elapsed, sentAt)`, in **ms since epoch**.

## Client → server

| Message                                                  | Effect                                     |
| -------------------------------------------------------- | ------------------------------------------ |
| `{ "type": "start" }`                                    | Resume streaming (auto-started on connect) |
| `{ "type": "stop" }`                                     | Pause streaming; heartbeats continue       |
| `{ "type": "setRate", "rate": 10000 }`                   | Base events/sec, clamped to `MAX_RATE`     |
| `{ "type": "burst", "rate": 50000, "durationMs": 5000 }` | Temporary rate, then back to base          |

Each connection has its own generator, so two tabs can run different rates.

## Close codes you'll see

| Code        | Meaning                                                                                                  |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| 1000        | Normal close (client called `close()`)                                                                   |
| 1001        | Server shut down gracefully (Ctrl+C). On Windows a hard kill may show 1006 instead                       |
| 1006        | Abnormal: no close frame (server crashed / network dropped). Never sent by code — the browser reports it |
| 4000        | Client-side: no frame for 15 s (heartbeat timeout). The client closes and reconnects                     |
| 4401 / 4403 | Reserved for auth refusals (Phase 7). Never retried                                                      |

Reconnection: every close except a user Disconnect and 4401/4403 is retried with backoff
(1 s, 2 s, 4 s … cap 30 s, ±20% jitter, 10 attempts). On `hello` the client re-sends the rate and
start/stop the user last chose.
