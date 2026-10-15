# Performance Measurements

> Actual measurements only (WBS 23.3). Every number below was measured, with its setup stated.
> Re-measure on your own machine before quoting numbers in an interview; Phase 4 adds
> in-app instrumentation for exactly that.

## Setup for all Phase 2 numbers

- Headless Chromium (Playwright 1.x) in a Linux container — **not** BK's Windows machine
- **Dev build** (Vite dev server, React development mode): absolute times are inflated
- Main-thread time from Chrome DevTools Protocol `Performance.getMetrics`
  (`ScriptDuration`, `TaskDuration`), delta over one 5 s window after a 4 s warm-up
- One sample per row: treat differences under ~10 ms/s as noise
- No fault injection (`BAD_EVENT_PCT=0`, `BAD_FRAME_PCT=0`) unless stated
- Measured 2026-10-14

## Experiment 15.1 — Main thread vs worker (validation location)

"Before" = Phase 1 build (parse + validate on the main thread). "After" = Phase 2 build
(main thread forwards raw strings; worker parses, validates, aggregates). Buffer 50 ms.

| Load                                   | Main-thread script ms/s — before | after | Main-thread task ms/s — before | after |
| -------------------------------------- | -------------------------------: | ----: | -----------------------------: | ----: |
| 10K events/s, 50 ms tick (20 frames/s) |                               34 |    40 |                             48 |    58 |
| 50K events/s, 50 ms tick (20 frames/s) |                               54 |    46 |                             86 |    82 |
| 50K events/s, 5 ms tick (200 frames/s) |                               70 |    48 |                            110 |    93 |

**Reading it:** at 10K/s the worker buys nothing; the main thread was never busy with
validation (Phase 2 also renders more UI). At 50K/s with 200 frames/s, main-thread script time
drops ~31%. Processing was not the main cost; fixed per-frame and render costs are. That points
Phase 3/4 at rendering, not parsing.

## Experiment — Frame buffer (Task D, WBS 4.5)

Phase 2 build, varying `VITE_BUFFER_MS` (0 = one post per frame).

| Load              | Buffer | Frames/s | Posts to worker/s | Worker ms per frame | Main script ms/s | Main task ms/s | Events/s measured |
| ----------------- | -----: | -------: | ----------------: | ------------------: | ---------------: | -------------: | ----------------: |
| 10K/s, 50 ms tick |      0 |     19.8 |              19.8 |                0.60 |               39 |             59 |             9,959 |
| 10K/s, 50 ms tick |  50 ms |     19.8 |              11.4 |                0.46 |               39 |             57 |             9,983 |
| 10K/s, 5 ms tick  |      0 |    192.2 |             192.2 |                0.10 |               44 |             76 |             9,996 |
| 10K/s, 5 ms tick  |  50 ms |    192.0 |              19.0 |                0.11 |               42 |             81 |            10,003 |
| 50K/s, 5 ms tick  |      0 |    192.6 |             192.6 |                0.34 |               44 |             91 |            50,038 |
| 50K/s, 5 ms tick  |  50 ms |    190.6 |              18.6 |                0.25 |               47 |             95 |            50,383 |

Missed frames and invalid events were 0 in every row (no loss through the buffer).

**Reading it:** buffering cuts `postMessage` calls ~10× at 200 frames/s, as designed, but
main-thread time does not move. Posting a string is a single copy and was never the expensive
part. Keep the buffer (it bounds message count, which matters for backpressure in Phase 4), but
don't claim it as a CPU win.

## Correctness checks

Events/s rows come from the buffer runs above. The rest come from a separate behaviour run at
10K/s with `BAD_EVENT_PCT=1`, `BAD_FRAME_PCT=1`.

| Check                        | Result                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------- |
| Events/s accuracy, no faults | 9,959 – 10,003 at 10K/s; 50,038 – 50,383 at 50K/s                               |
| Error rate from aggregates   | 2.06% (generator emits ~2%)                                                     |
| 5 s bucket count vs 1 s      | 8,217 vs 1,661 (≈ 5×)                                                           |
| Server killed → worker       | still running (D16); totals continued 72,465 → 76,364; 0 missed after reconnect |
| Disconnect → worker          | terminated (0 workers)                                                          |
