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

## Phase 3 measurements

Same environment as above (headless Chromium, Linux container, dev build), measured 2026-10-15.

### Experiment 15.2 — DOM rendering: naive vs virtualized

| Scenario                                           |                       DOM nodes | Time to build + lay out |
| -------------------------------------------------- | ------------------------------: | ----------------------: |
| Naive: 10,000 rows × 5 cells appended              |                          60,000 |                  491 ms |
| Naive: 100,000 rows × 5 cells appended             |                         600,000 |                5,077 ms |
| Virtualized grid, 100,000 rows held in the worker  | 21 rows (142 nodes in the grid) |                       — |
| Virtualized grid after scrolling to middle and end |                         21 rows |                       — |

Whole page: 455 DOM nodes with 100K events held. Jump-scroll to the end of 100K rows: rows filled
55 ms later (one worker round-trip + render). Worker query time: 1.7 ms for time-descending
(no sort), 43.7 ms for a value sort of 100K rows.

### Experiment 6.3 / 15.3 — Chart downsampling (raw resolution, ~16.9K points per metric, 6 charts)

| Algorithm | Points per metric | Worker downsample (all metrics) | Main render (all charts) |
| --------- | ----------------: | ------------------------------: | -----------------------: |
| None      |           ~16,900 |                    3.3 – 6.4 ms |           16.1 – 28.4 ms |
| Every Nth |              ~993 |                      0 – 0.1 ms |             5.7 – 7.2 ms |
| LTTB      |             1,000 |                    0.6 – 1.0 ms |             5.5 – 8.4 ms |

Four samples each. Rendering 17× fewer points cuts chart render time ~3×; LTTB costs < 1 ms in
the worker. ("None" still spends time building the index array it passes through.)

**Visual quality — error spikes kept** (errors metric is 0/1; ~2% are 1). Generator output,
~16.7K error events downsampled to 1,000 points, three runs:

| Run | Spikes in input | Every Nth kept | LTTB kept |
| --: | --------------: | -------------: | --------: |
|   1 |             319 |        13 (4%) | 230 (72%) |
|   2 |             339 |       33 (10%) | 240 (71%) |
|   3 |             325 |        24 (7%) | 228 (70%) |
