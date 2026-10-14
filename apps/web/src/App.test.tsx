import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { Connection, ConnectionSnapshot } from './ws';

function fakeConnection(initial: Partial<ConnectionSnapshot> = {}) {
  let snapshot: ConnectionSnapshot = {
    status: 'disconnected',
    lastClose: null,
    server: null,
    stats: {
      eventsPerSec: 0,
      totalEvents: 0,
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
      lastMessageAt: null,
    },
    ...initial,
  };
  const listeners = new Set<() => void>();
  const connection: Connection = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    send: vi.fn(() => true),
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getSnapshot: () => snapshot,
  };
  const push = (patch: Partial<ConnectionSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((l) => l());
  };
  return { connection, push };
}

describe('App', () => {
  it('connects on mount and disconnects on unmount', () => {
    const { connection } = fakeConnection();
    const { unmount } = render(<App connection={connection} />);
    expect(connection.connect).toHaveBeenCalled();
    unmount();
    expect(connection.disconnect).toHaveBeenCalled();
  });

  it('shows status as text, including the close code', () => {
    const { connection, push } = fakeConnection();
    render(<App connection={connection} />);
    act(() => push({ status: 'connected' }));
    expect(screen.getByRole('status')).toHaveTextContent('Connected');

    act(() =>
      push({ status: 'disconnected', lastClose: { code: 1006, reason: '', wasClean: false } }),
    );
    expect(screen.getByRole('status')).toHaveTextContent('Disconnected');
    expect(screen.getByRole('status')).toHaveTextContent('code 1006');
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
  });

  it('sends stream commands from the controls', () => {
    const { connection, push } = fakeConnection();
    render(<App connection={connection} />);
    act(() =>
      push({
        status: 'connected',
        server: { running: true, rate: 1000, baseRate: 1000, burstEndsAt: null, tickMs: 50 },
      }),
    );
    screen.getByRole('button', { name: 'Stop' }).click();
    expect(connection.send).toHaveBeenCalledWith({ type: 'stop' });
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });
});
