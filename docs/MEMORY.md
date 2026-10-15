# Memory: leaks, detection, retention (WBS 16)

## The Leak Lab

Dev builds only (`npm run dev` → **Leak lab (dev only)** at the bottom). Production builds don't
contain it: the lazy `import()` sits behind `import.meta.env.DEV`.

| Leak         | Leaky code                                           | What keeps memory alive                                     | Fix                                        |
| ------------ | ---------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------ |
| Detached DOM | node pushed into a module-level array                | `leakedNodes` → unmounted `<div>` subtree (+ its payload)   | don't hold DOM nodes outside the component |
| Subscription | `store.subscribe(…)` in an effect with no cleanup    | store's listener `Set` → listener closure → captured buffer | `return unsubscribe`                       |
| Closure      | `window.addEventListener('resize', …)` never removed | `window` → handler closure → captured 1 MB array            | remove the listener in cleanup             |

Each mount pins a 1 MB `Float64Array` so the effect is obvious.

## Measured (headless Chromium, dev build, 50 mount/unmount cycles, forced GC)

| Leak         | Mode  | JS heap Δ | ArrayBuffer backing store Δ | Other evidence                      |
| ------------ | ----- | --------: | --------------------------: | ----------------------------------- |
| Detached DOM | leaky |   +6.9 MB |                  **+50 MB** | 10,050 detached `<div>`s (50 × 201) |
| Detached DOM | fixed |   +0.7 MB |                           0 | 0 detached                          |
| Subscription | leaky |   +0.6 MB |                 **+100 MB** | 101 store listeners (should be 1)   |
| Subscription | fixed |   +0.7 MB |                           0 | 1 listener                          |
| Closure      | leaky |   +2.3 MB |                 **+100 MB** | —                                   |
| Closure      | fixed |   +0.6 MB |                           0 | —                                   |

Source: CDP `Runtime.getHeapUsage` (`usedSize`, `backingStorageSize`), `Runtime.queryObjects` for
`HTMLDivElement`, the lab's listener counter.

### Two findings worth knowing

1. **The usual heap number hid the leak.** The subscription leak retained 100 MB but moved
   `usedJSHeapSize` by 0.6 MB: typed-array data lives in ArrayBuffer _backing stores_, outside the
   JS heap that `performance.memory` and the DevTools "JS heap" line report. A heap snapshot still
   shows it (the `Float64Array` entries with large retained size); a heap-size graph alone doesn't.
2. **StrictMode doubles a missing cleanup.** In development React runs each effect, its cleanup,
   then the effect again. With no cleanup, every mount subscribes twice: 50 mounts → 100 leaked
   listeners / 100 MB. That's the point of StrictMode: it makes missing cleanups louder.
   (Detached DOM shows 50 MB, not 100: the second effect run re-pins the _same_ node.)

## Finding a leak with Chrome DevTools (WBS 16.2)

1. `npm run dev`, open the dashboard, open **Leak lab**, choose a leak, Mode **Leaky**.
2. DevTools → **Memory** → _Heap snapshot_ → collect garbage (🗑) → **Take snapshot** (baseline).
3. Click **Mount/unmount ×50**, wait for "Cycles run 50".
4. Collect garbage → **Take snapshot** again.
5. In snapshot 2 choose **Comparison** against snapshot 1, sort by **# Delta** / **Size Delta**.
   - Detached DOM: filter `Detached` → `Detached HTMLDivElement` +10,050.
   - Subscription / closure: `Float64Array` +100, each ~1 MB retained.
6. Select one entry → **Retainers** panel shows the path that keeps it alive:
   - `leakedNodes` (array) → `HTMLDivElement` — the module-level cache
   - `Set` (store `listeners`) → `(closure)` → `Context` → `buffer`
   - `Window` → `EventListener` → `onResize` → `Context` → `big`
7. Switch Mode to **Fixed**, reload, repeat: the comparison shows no growth.

Reading retainers bottom-up is the skill: the object isn't the bug, the thing still pointing at it is.

## Cleanup audit (WBS 12.2, 16.3)

Every long-lived resource and where it's released. Verified by tests ("leaves no timers behind
after disconnect", "no subscriptions after 20 mount/unmount cycles") and in the browser
(Chart.js instances stay at 6 after toggling a metric 20×).

| Resource                                    | Created                       | Released                                                                                     |
| ------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------- |
| WebSocket                                   | `connect()` / retry           | `disconnect()` closes (or closes on open if still CONNECTING); handlers ignore stale sockets |
| Worker                                      | `connect()`                   | `disconnect()` → `terminate()`; late messages ignored                                        |
| Publish interval, rAF publish               | `connect()`                   | `disconnect()`                                                                               |
| Retry timer                                 | unexpected close              | `connect()` / `disconnect()`                                                                 |
| Frame-buffer timer                          | first frame into empty buffer | flush / `clear()`                                                                            |
| Store subscriptions                         | `useSyncExternalStore`        | React unsubscribes on unmount                                                                |
| Chart.js instance (canvas, resize observer) | `MetricChart` mount           | `chart.destroy()` in cleanup                                                                 |
| PerformanceObserver, FPS rAF loop           | Performance panel open        | panel close / unmount                                                                        |
| Countdown interval                          | reconnecting                  | target cleared / unmount                                                                     |
| IndexedDB connection                        | worker start                  | `close()` on runtime stop; worker termination                                                |

## Data retention (WBS 16.4): memory is bounded by design

| Data                          | Bound                                                     |
| ----------------------------- | --------------------------------------------------------- |
| Raw events (grid, raw charts) | ring buffer, 100,000 events                               |
| 1 s buckets                   | 3,600 per metric (1 h); raw values only for the last 60 s |
| 5 s / 10 s / 1 min buckets    | 3,600 each per metric                                     |
| Main-thread frame queue       | 64 frames (drop oldest) + 32 in flight                    |
| IndexedDB                     | 30 minutes, pruned every minute                           |

Measured at 50K events/s for 120 s, heap after forced GC:

|     t | Main thread JS heap | Worker JS heap | Grid rows held |
| ----: | ------------------: | -------------: | -------------: |
|   0 s |             10.7 MB |         1.0 MB |              0 |
|  20 s |             11.7 MB |        15.3 MB |        100,000 |
|  40 s |             12.1 MB |        11.7 MB |        100,000 |
|  60 s |             12.4 MB |        14.5 MB |        100,000 |
|  80 s |             12.7 MB |        11.4 MB |        100,000 |
| 100 s |             12.8 MB |        12.3 MB |        100,000 |
| 120 s |             12.8 MB |        12.1 MB |        100,000 |

The worker fills its 100K ring buffer in ~2 s and then stays between 11 and 15 MB. Worker heap
was read by attaching CDP to the worker target (`performance.memory` isn't available in workers).
The main thread grows ~2 MB over the first minute (1 s series filling toward their 1 h cap) and
then flattens.
