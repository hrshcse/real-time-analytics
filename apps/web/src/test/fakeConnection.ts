import { vi } from 'vitest';
import type { ChartData, GridPage } from '../workers/contract';
import type { Connection, ConnectionSnapshot } from '../ws';
import { createStore } from '../ws/store';

export function emptySnapshot(): ConnectionSnapshot {
  return {
    status: 'disconnected',
    lastClose: null,
    server: null,
    latest: {},
    workerError: null,
    connectedAt: null,
    stats: {
      eventsPerSec: 0,
      totalEvents: 0,
      framesPerSec: 0,
      postsPerSec: 0,
      framesReceived: 0,
      malformedFrames: 0,
      invalidEvents: 0,
      invalidByReason: {
        'not-object': 0,
        id: 0,
        timestamp: 0,
        metric: 0,
        value: 0,
        category: 0,
        source: 0,
      },
      missedFrames: 0,
      duplicateFrames: 0,
      serverDropped: 0,
      lateEvents: 0,
      droppedOnDisconnect: 0,
      lastMessageAt: null,
      processing: null,
      heapMB: null,
      inFlightFrames: 0,
      backpressureDropped: 0,
      mainMsPerSec: 0,
      publishesPerSec: 0,
      dataLagMs: null,
    },
  };
}

/** A Connection whose snapshot tests drive with `push`. All commands are spies. */
export function fakeConnection(initial: Partial<ConnectionSnapshot> = {}) {
  let snapshot: ConnectionSnapshot = { ...emptySnapshot(), ...initial };
  const listeners = new Set<() => void>();
  const connection = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    send: vi.fn(() => true),
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    getSnapshot: () => snapshot,
    chart: createStore<ChartData | null>(null),
    grid: createStore<GridPage | null>(null),
    setView: vi.fn(),
    queryGrid: vi.fn(),
    setPublishMode: vi.fn(),
    setBackpressure: vi.fn(),
    setSimulatedWorkMs: vi.fn(),
    experiments: { publishMode: 'raf' as const, backpressure: true, simulatedWorkMs: 0 },
  } satisfies Connection;
  const push = (patch: Partial<ConnectionSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((l) => l());
  };
  return { connection, push };
}
