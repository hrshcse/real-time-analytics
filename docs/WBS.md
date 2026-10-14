# Real-Time Analytics Dashboard — Detailed WBS

## Project Overview

**Goal:** Build a high-performance real-time analytics dashboard capable of handling high-volume streaming data while keeping the UI responsive.

### Core Technologies

- React
- TypeScript
- Vite
- Node.js
- WebSocket
- Web Workers
- Chart.js
- IndexedDB
- Virtualization
- Jest/Vitest
- Playwright
- GitHub Actions
- Vercel / Node.js deployment

### Target Capabilities

- Real-time WebSocket streaming
- 10K+ events/sec simulation
- Web Worker-based processing
- Data aggregation
- LTTB/downsampling
- Virtualized data grid
- Backpressure handling
- IndexedDB persistence
- Session replay
- Reconnection with exponential backoff
- Memory profiling and leak prevention
- Performance instrumentation
- Automated testing
- CI/CD and performance gates

---

# 0. Project Definition

## 0.1 Define Objective

- [ ] Define the dashboard's primary purpose
- [ ] Define target users
- [ ] Define the real-time data use case
- [ ] Define performance goals

## 0.2 Define Success Criteria

- [ ] Real-time updates
- [ ] 10K+ events/sec simulation
- [ ] Smooth chart updates
- [ ] 100K+ table records
- [ ] Virtualized rendering
- [ ] Worker-based processing
- [ ] WebSocket reconnection
- [ ] Backpressure handling
- [ ] IndexedDB persistence
- [ ] Memory-conscious architecture

## 0.3 Define User Flows

### Primary Flow

```text
Open Dashboard
      ↓
Connect WebSocket
      ↓
Receive Live Data
      ↓
Process Data
      ↓
Update Metrics
      ↓
Update Chart
      ↓
Update Table
```

### Recovery Flow

```text
Connection Lost
      ↓
Reconnect
      ↓
Resume Stream
```

---

# 1. Project Setup

## 1.1 Repository

```text
real-time-analytics/
│
├── apps/
│   ├── web/
│   └── server/
│
├── packages/
│   └── shared/
│
├── workers/
│
├── docs/
│
└── README.md
```

- [ ] Create repository
- [ ] Initialize Git
- [ ] Configure `.gitignore`
- [ ] Create project structure

## 1.2 Frontend Setup

- [ ] Initialize React + TypeScript
- [ ] Configure Vite
- [ ] Install Chart.js
- [ ] Install/configure styling solution
- [ ] Configure ESLint
- [ ] Configure Prettier
- [ ] Configure testing framework

## 1.3 Backend Setup

- [ ] Initialize Node.js + TypeScript
- [ ] Add WebSocket server
- [ ] Add development scripts
- [ ] Add environment configuration

## 1.4 Development Tooling

- [ ] Configure linting
- [ ] Configure formatting
- [ ] Configure unit tests
- [ ] Configure E2E tests
- [ ] Add Git hooks if needed

---

# 2. Data Model

## 2.1 Define Event Structure

Example:

```ts
interface AnalyticsEvent {
  id: string;
  timestamp: number;
  metric: string;
  value: number;
  category: string;
  source: string;
}
```

- [ ] Define TypeScript interfaces
- [ ] Define required fields
- [ ] Define optional fields
- [ ] Define validation rules

## 2.2 Define Event Types

- [ ] CPU
- [ ] Memory
- [ ] Network
- [ ] Requests
- [ ] Latency
- [ ] Errors

## 2.3 Event Generator

- [ ] Generate 100 events/sec
- [ ] Generate 1,000 events/sec
- [ ] Generate 10,000 events/sec
- [ ] Make throughput configurable

## 2.4 Burst Simulation

```text
Normal
  ↓
10K/sec
  ↓
50K/sec Burst
  ↓
Normal
```

- [ ] Implement normal traffic
- [ ] Implement burst traffic
- [ ] Make burst duration configurable

---

# 3. WebSocket Layer

## 3.1 Establish Connection

```text
React
  ↓
WebSocket.connect()
  ↓
Server
  ↓
Connection Established
```

- [ ] Create WebSocket client
- [ ] Connect to server
- [ ] Handle connection success
- [ ] Handle connection failure

## 3.2 Connection State

```ts
type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
```

- [ ] Implement connection state
- [ ] Display connected state
- [ ] Display reconnecting state
- [ ] Display disconnected state

## 3.3 Message Handling

```text
WebSocket
    ↓
message event
    ↓
raw payload
```

- [ ] Receive messages
- [ ] Validate payload
- [ ] Send processing work to Worker
- [ ] Handle malformed messages

---

# 4. Web Worker Processing

## 4.1 Worker Architecture

```text
Main Thread
     │
     │ Raw Data
     ▼
Web Worker
     │
     ├── Parse
     ├── Validate
     ├── Transform
     ├── Aggregate
     └── Downsample
     │
     ▼
Processed Data
     │
     ▼
Main Thread
```

- [ ] Create Worker
- [ ] Define Worker message contract
- [ ] Implement main-thread → Worker communication
- [ ] Implement Worker → main-thread communication

## 4.2 Parsing

- [ ] Parse raw WebSocket payload
- [ ] Convert payload to typed event
- [ ] Handle malformed JSON

## 4.3 Validation

- [ ] Validate required fields
- [ ] Ignore invalid events
- [ ] Log invalid event counts

## 4.4 Transformation

- [ ] Normalize event format
- [ ] Convert timestamps
- [ ] Normalize metric values

## 4.5 Batch Processing

Avoid sending every event individually:

```text
Events
  ↓
Batch 100 / 500 / 1000
  ↓
Worker
```

- [ ] Implement event buffer
- [ ] Implement configurable batch size
- [ ] Process batches in Worker

---

# 5. Data Transformation

## 5.1 Aggregation

```text
10,000 Events
      ↓
1 Second Bucket
      ↓
CPU Avg
CPU Max
CPU Min
```

- [ ] Implement average
- [ ] Implement minimum
- [ ] Implement maximum
- [ ] Implement event count

## 5.2 Time-Window Aggregation

Support:

- [ ] 1 second
- [ ] 5 seconds
- [ ] 10 seconds
- [ ] 1 minute

## 5.3 Metrics

Calculate:

- [ ] Events/sec
- [ ] Average
- [ ] Minimum
- [ ] Maximum
- [ ] P95
- [ ] P99
- [ ] Error rate
- [ ] Dropped events

---

# 6. Downsampling

## 6.1 Basic Downsampling

Start with:

```text
Every Nth Point
```

- [ ] Implement basic sampling
- [ ] Make target point count configurable

## 6.2 LTTB

Implement:

**Largest Triangle Three Buckets**

```text
10,000 Points
      ↓
LTTB Downsampling
      ↓
1,000 Points
      ↓
Chart
```

- [ ] Implement LTTB
- [ ] Test output
- [ ] Compare visual quality

## 6.3 Performance Comparison

Compare:

```text
No Downsampling
        vs
Basic Sampling
        vs
LTTB
```

Measure:

- [ ] Rendering time
- [ ] CPU usage
- [ ] Visual quality

---

# 7. Chart Engine

## 7.1 Real-Time Line Chart

- [ ] Integrate Chart.js
- [ ] Render real-time line chart
- [ ] Update chart incrementally
- [ ] Limit retained chart data

## 7.2 Multiple Metrics

Display:

- [ ] CPU
- [ ] Memory
- [ ] Network
- [ ] Latency
- [ ] Requests/sec
- [ ] Error rate

## 7.3 Time Window

Implement:

- [ ] 1 minute
- [ ] 5 minutes
- [ ] 15 minutes
- [ ] 1 hour

## 7.4 Chart Controls

- [ ] Pause chart
- [ ] Resume chart
- [ ] Clear chart
- [ ] Change metric
- [ ] Change time window

Important behavior:

```text
Live Stream → Continues
                    ↓
               Chart Paused
```

---

# 8. Real-Time Metrics Dashboard

Create KPI cards:

```text
┌────────────┐
│ Events/sec │
│   9,842    │
└────────────┘

┌────────────┐
│ Avg Latency│
│   42 ms    │
└────────────┘

┌────────────┐
│ Error Rate │
│   0.12%    │
└────────────┘
```

- [ ] Events/sec card
- [ ] Average latency card
- [ ] Error rate card
- [ ] Dropped events card
- [ ] Active connection card
- [ ] Memory usage card

---

# 9. Virtualized Data Grid

## 9.1 Large Dataset

- [ ] Generate 100,000 records
- [ ] Support continuous updates

## 9.2 Virtualization

```text
100,000 Rows
      ↓
Viewport
      ↓
~30 Visible Rows
```

- [ ] Implement windowed rendering
- [ ] Keep DOM node count stable
- [ ] Measure scrolling performance

## 9.3 Grid Features

- [ ] Sorting
- [ ] Filtering
- [ ] Search
- [ ] Row selection
- [ ] Column resizing
- [ ] Column visibility
- [ ] Timestamp formatting

## 9.4 Live Updates

```text
WebSocket
   ↓
Worker
   ↓
Data Store
   ↓
Virtualized Grid
```

- [ ] Add new records
- [ ] Update existing records
- [ ] Remove old records
- [ ] Keep UI responsive during updates

---

# 10. Backpressure

## 10.1 Identify the Problem

```text
Incoming:
10,000 events/sec
        ↓
Browser processes:
3,000 events/sec
        ↓
Queue grows
        ↓
Memory increases
```

- [ ] Simulate producer faster than consumer
- [ ] Measure queue growth
- [ ] Measure memory growth

## 10.2 Buffering

```text
Incoming Events
      ↓
Buffer
      ↓
Batch Every 16/50/100ms
```

- [ ] Implement buffer
- [ ] Configure batch interval
- [ ] Flush batches

## 10.3 Drop Strategy

- [ ] Define maximum buffer size
- [ ] Drop obsolete intermediate points
- [ ] Preserve latest data
- [ ] Track dropped event count

## 10.4 Render Batching

```text
WebSocket
    ↓
Buffer
    ↓
Worker
    ↓
Batch
    ↓
requestAnimationFrame
    ↓
React
```

- [ ] Batch UI updates
- [ ] Flush using `requestAnimationFrame`
- [ ] Avoid per-event React updates

---

# 11. IndexedDB Persistence

## 11.1 Store Streaming Data

```text
WebSocket
    ↓
Processed Data
    ↓
IndexedDB
```

- [ ] Create IndexedDB database
- [ ] Define object stores
- [ ] Store processed events
- [ ] Store session metadata

## 11.2 Reload Recovery

```text
Browser Refresh
      ↓
IndexedDB
      ↓
Restore Previous Session
```

- [ ] Restore recent data
- [ ] Restore selected metrics
- [ ] Restore dashboard state where useful

## 11.3 Retention Policy

- [ ] Keep last 30 minutes
- [ ] Delete older records
- [ ] Handle storage limits
- [ ] Handle quota errors

## 11.4 Session Replay

```text
▶ Start Replay

10:00 ─────────────── 10:30
       ↑
     Replay
```

- [ ] Select session
- [ ] Start replay
- [ ] Pause replay
- [ ] Resume replay
- [ ] Change replay speed
- [ ] Stop replay

---

# 12. Connection Recovery

## 12.1 Reconnection

```text
Connected
   ↓
Network Failure
   ↓
Disconnected
   ↓
Retry
   ↓
1 sec
   ↓
2 sec
   ↓
4 sec
   ↓
8 sec
   ↓
Connected
```

- [ ] Implement exponential backoff
- [ ] Configure maximum retries
- [ ] Display retry status
- [ ] Add manual reconnect

## 12.2 Cleanup

- [ ] Close WebSocket
- [ ] Terminate Worker
- [ ] Remove event listeners
- [ ] Clear timers
- [ ] Unsubscribe from stores

---

# 13. Dashboard Controls

## 13.1 Connection

```text
[ Connected 🟢 ]
```

- [ ] Connection indicator
- [ ] Reconnect button

## 13.2 Stream Controls

```text
[ Start ] [ Pause ] [ Stop ]
```

- [ ] Start stream
- [ ] Pause processing
- [ ] Stop stream

## 13.3 Data Rate

```text
100
1,000
10,000
50,000 events/sec
```

- [ ] Add data-rate selector
- [ ] Allow custom rate if useful

## 13.4 Time Range

```text
1m | 5m | 15m | 1h
```

- [ ] Add time-range selector

## 13.5 Metrics

```text
☑ CPU
☑ Memory
☑ Network
☐ Errors
```

- [ ] Add metric toggles

---

# 14. Performance Instrumentation

Measure:

```text
┌───────────────────────┐
│ Events/sec            │
│ Worker processing     │
│ Main thread time      │
│ Render time           │
│ Dropped events        │
│ Memory usage          │
│ FPS                   │
└───────────────────────┘
```

- [ ] Events/sec measurement
- [ ] Worker processing time
- [ ] Main-thread processing time
- [ ] Render duration
- [ ] Dropped event count
- [ ] Memory usage
- [ ] FPS
- [ ] Long-task measurement

Tools:

- [ ] Chrome Performance
- [ ] Chrome Memory
- [ ] React DevTools Profiler
- [ ] Lighthouse
- [ ] Performance API

---

# 15. Performance Experiments

## 15.1 Main Thread vs Worker

### Before

```text
10K Events
   ↓
Main Thread Processing
```

### After

```text
10K Events
   ↓
Web Worker
```

- [ ] Measure main-thread time
- [ ] Measure Worker processing time
- [ ] Compare results

## 15.2 DOM Rendering

### Before

```text
100K DOM Rows ❌
```

### After

```text
100K Records
      ↓
Virtualization
      ↓
Visible Rows Only
```

- [ ] Measure DOM node count
- [ ] Measure scroll performance
- [ ] Compare before/after

## 15.3 Chart Downsampling

### Before

```text
10K Chart Points
```

### After

```text
10K Points
   ↓
LTTB
   ↓
1K Points
```

- [ ] Measure rendering time
- [ ] Measure CPU usage
- [ ] Compare visual quality

## 15.4 Render Batching

### Before

```text
Update React Every Event ❌
```

### After

```text
Batch
 ↓
requestAnimationFrame
 ↓
React Update
```

- [ ] Measure render count
- [ ] Measure frame time
- [ ] Compare INP/responsiveness

---

# 16. Memory Management

## 16.1 Deliberate Memory Leak

Create a controlled test:

```text
Subscription
     ↓
Forgot Cleanup
     ↓
Objects Retained
     ↓
Memory Grows
```

- [ ] Create detached DOM retention
- [ ] Create subscription leak
- [ ] Create closure retaining large data

## 16.2 Detect Leak

```text
Memory
 ↓
Heap Snapshot
 ↓
Comparison
 ↓
Retainers
```

- [ ] Capture baseline
- [ ] Capture stressed state
- [ ] Compare snapshots
- [ ] Identify retainers

## 16.3 Fix Leak

- [ ] Close WebSocket
- [ ] Terminate Worker
- [ ] Remove listeners
- [ ] Clear intervals
- [ ] Unsubscribe
- [ ] Release retained objects

## 16.4 Data Retention

```text
Keep Last 10 Minutes
        ↓
Delete Older Events
```

- [ ] Implement maximum in-memory window
- [ ] Remove stale events
- [ ] Measure memory before/after

---

# 17. Error Handling

## 17.1 WebSocket Errors

Handle:

- [ ] Connection failure
- [ ] Unexpected disconnect
- [ ] Retry exhaustion
- [ ] Invalid payload

## 17.2 Worker Errors

Handle:

- [ ] Worker initialization failure
- [ ] Worker runtime error
- [ ] Invalid data
- [ ] Worker termination

## 17.3 IndexedDB Errors

Handle:

- [ ] Storage failure
- [ ] Quota exceeded
- [ ] Database initialization failure
- [ ] Corrupt data

## 17.4 UI States

Implement:

- [ ] Loading
- [ ] Empty
- [ ] Error
- [ ] Partial failure
- [ ] Reconnecting

---

# 18. Testing

## 18.1 Unit Tests

Test:

- [ ] Data validation
- [ ] Aggregation
- [ ] Downsampling
- [ ] Metrics calculation
- [ ] Retry logic
- [ ] Buffer logic
- [ ] Backpressure logic

## 18.2 React Tests

Test:

- [ ] Dashboard rendering
- [ ] Connection state
- [ ] Pause/resume
- [ ] Filters
- [ ] Error states
- [ ] Metric selection

## 18.3 E2E Tests

```text
Open Dashboard
      ↓
Connect
      ↓
Receive Data
      ↓
Pause
      ↓
Resume
      ↓
Disconnect
      ↓
Reconnect
```

- [ ] Implement Playwright flow
- [ ] Test reconnection
- [ ] Test dashboard controls
- [ ] Test error state

---

# 19. Accessibility

- [ ] Keyboard navigation
- [ ] Accessible buttons
- [ ] Proper labels
- [ ] Connection status announcement
- [ ] Reduced-motion support
- [ ] Accessible data table
- [ ] Status indicators that don't rely only on color
- [ ] Carefully evaluate `aria-live` for real-time updates

> Do not announce every incoming event to screen readers. Use accessibility announcements selectively.

---

# 20. Security

- [ ] Validate WebSocket messages
- [ ] Validate server payloads
- [ ] Avoid unsafe HTML rendering
- [ ] Add authentication placeholder
- [ ] Add server-side rate limiting
- [ ] Validate user-controlled inputs
- [ ] Review WebSocket connection security

---

# 21. CI/CD

Pipeline:

```text
Push
 ↓
Lint
 ↓
Type Check
 ↓
Unit Tests
 ↓
Build
 ↓
E2E
 ↓
Performance Test
 ↓
Deploy
```

## 21.1 CI Steps

- [ ] Install dependencies
- [ ] Lint
- [ ] Type check
- [ ] Run unit tests
- [ ] Build
- [ ] Run E2E tests
- [ ] Run performance checks

## 21.2 Performance Gate

```text
Bundle Size > Threshold
        ↓
       FAIL
```

- [ ] Define bundle-size threshold
- [ ] Add bundle-size check
- [ ] Add Lighthouse/performance check
- [ ] Fail CI when threshold is exceeded

---

# 22. Deployment

## 22.1 Frontend

- [ ] Deploy React application
- [ ] Configure environment variables
- [ ] Configure production WebSocket URL

## 22.2 WebSocket Server

- [ ] Deploy Node.js server
- [ ] Configure production port
- [ ] Configure CORS/origin rules
- [ ] Configure environment variables

## 22.3 Production Architecture

```text
                 Internet
                    │
          ┌─────────┴─────────┐
          ↓                   ↓
       Vercel              Node.js
       React UI           WebSocket
          │                   │
          └─────────┬─────────┘
                    ↓
                IndexedDB
```

---

# 23. Documentation

## 23.1 README.md

Document:

- [ ] Project overview
- [ ] Problem statement
- [ ] Features
- [ ] Architecture
- [ ] Tech stack
- [ ] Local setup
- [ ] Environment variables
- [ ] Screenshots
- [ ] Performance results

## 23.2 ARCHITECTURE.md

Explain:

```text
WebSocket
    ↓
Worker
    ↓
Processing
    ↓
State
    ↓
UI
```

Document:

- [ ] Data flow
- [ ] Worker architecture
- [ ] WebSocket lifecycle
- [ ] Backpressure strategy
- [ ] Persistence architecture
- [ ] Failure handling

## 23.3 PERFORMANCE.md

Record actual measurements.

| Scenario               | Before |  After |
| ---------------------- | -----: | -----: |
| Main-thread processing | Actual | Actual |
| Rendering              | Actual | Actual |
| Memory                 | Actual | Actual |
| FPS                    | Actual | Actual |
| DOM nodes              | Actual | Actual |

> Use actual measurements. Do not manufacture performance numbers.

## 23.4 DECISIONS.md

Document important technical decisions:

- [ ] Why WebSocket?
- [ ] Why Web Worker?
- [ ] Why IndexedDB?
- [ ] Why virtualization?
- [ ] Why LTTB?
- [ ] Why batching?
- [ ] Why `requestAnimationFrame`?
- [ ] Why Chart.js?

---

# 24. Interview Story Preparation

Prepare concise answers for:

## Architecture

- [ ] Explain the complete architecture
- [ ] Explain the data flow
- [ ] Explain why processing is separated from rendering

## WebSocket

- [ ] Why WebSocket instead of polling?
- [ ] How do you handle disconnects?
- [ ] How do you reconnect?
- [ ] How do you prevent duplicate processing?

## Web Worker

- [ ] Why did you use a Worker?
- [ ] What work happens inside the Worker?
- [ ] How do you communicate with the Worker?
- [ ] What are the costs of `postMessage`?

## Performance

- [ ] How did you keep the UI responsive?
- [ ] How did you measure performance?
- [ ] What caused the biggest bottleneck?
- [ ] How did you improve INP?

## Backpressure

- [ ] What happens when incoming data is faster than rendering?
- [ ] How does your buffer work?
- [ ] When do you drop events?
- [ ] Why preserve the latest data?

## Virtualization

- [ ] Why can't you render 100K rows?
- [ ] How does virtualization work?
- [ ] How do you handle live updates?

## Downsampling

- [ ] Why downsample?
- [ ] What is LTTB?
- [ ] Why LTTB instead of simple sampling?

## Memory

- [ ] How did you prevent memory growth?
- [ ] How did you identify a leak?
- [ ] What did the heap snapshot show?
- [ ] What resources need cleanup?

## IndexedDB

- [ ] Why IndexedDB instead of localStorage?
- [ ] What do you persist?
- [ ] How do you handle quota limits?
- [ ] How does session replay work?

## Reliability

- [ ] What happens if the WebSocket server goes down?
- [ ] How does exponential backoff work?
- [ ] How do you recover after a browser refresh?

## Scaling

- [ ] What happens at 100K events/sec?
- [ ] What becomes the next bottleneck?
- [ ] How would you scale the server?
- [ ] What would you change if multiple users connect simultaneously?

---

# Final Project WBS

```text
1.  Project Definition
2.  Project Setup
3.  Data Model
4.  WebSocket Layer
5.  Web Worker Processing
6.  Data Transformation
7.  Downsampling
8.  Chart Engine
9.  Real-Time Metrics
10. Virtualized Data Grid
11. Backpressure
12. IndexedDB Persistence
13. Connection Recovery
14. Dashboard Controls
15. Performance Instrumentation
16. Performance Experiments
17. Memory Management
18. Error Handling
19. Testing
20. Accessibility
21. Security
22. CI/CD
23. Deployment
24. Documentation
25. Interview Story Preparation
```

# Recommended Build Order

## Phase 1 — Foundation

- [ ] Project setup
- [ ] Data model
- [ ] Node.js event generator
- [ ] WebSocket connection
- [ ] Basic dashboard

## Phase 2 — Data Processing

- [ ] Web Worker
- [ ] Parsing
- [ ] Transformation
- [ ] Aggregation
- [ ] Metrics

## Phase 3 — Visualization

- [ ] Chart.js
- [ ] Downsampling
- [ ] LTTB
- [ ] Virtualized data grid

## Phase 4 — Performance

- [ ] Batching
- [ ] Backpressure
- [ ] `requestAnimationFrame`
- [ ] Performance instrumentation

## Phase 5 — Persistence & Reliability

- [ ] IndexedDB
- [ ] Session replay
- [ ] Reconnection
- [ ] Exponential backoff
- [ ] Error handling

## Phase 6 — Memory

- [ ] Create controlled memory leak
- [ ] Heap profiling
- [ ] Fix leak
- [ ] Data retention strategy

## Phase 7 — Quality

- [ ] Unit tests
- [ ] React tests
- [ ] Playwright
- [ ] Accessibility
- [ ] Security

## Phase 8 — Delivery

- [ ] CI/CD
- [ ] Performance gates
- [ ] Deployment
- [ ] Documentation

## Phase 9 — Interview Preparation

- [ ] Architecture explanation
- [ ] Performance story
- [ ] Tradeoff discussion
- [ ] Failure scenarios
- [ ] Scaling questions
- [ ] Mock interview
