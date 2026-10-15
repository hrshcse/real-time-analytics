import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { fakeConnection } from './test/fakeConnection';

describe('App', () => {
  it('shows a worker error as an alert and the latest bucket per metric', () => {
    const { connection, push } = fakeConnection();
    render(<App connection={connection} />);
    act(() =>
      push({
        status: 'connected',
        workerError: 'boom',
        latest: {
          1000: {
            cpu: {
              start: 0,
              windowMs: 1000,
              count: 3,
              sum: 60,
              avg: 20,
              min: 10,
              max: 30,
              p95: 30,
              p99: 30,
            },
          },
        },
      }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Processing stopped: boom');
    const cpuRow = screen.getByRole('row', { name: /cpu/ });
    expect(cpuRow).toHaveTextContent('3');
    expect(cpuRow).toHaveTextContent('20');
  });

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
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
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
    screen.getByRole('button', { name: 'Disconnect' }).click();
    expect(connection.disconnect).toHaveBeenCalled();
    screen.getByRole('button', { name: 'Stop' }).click();
    expect(connection.send).toHaveBeenCalledWith({ type: 'stop' });
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });
});

describe('App memory hygiene (WBS 16.3)', () => {
  it('leaves no subscriptions behind after 20 mount/unmount cycles', () => {
    const { connection, snapshotListeners } = fakeConnection();
    for (let i = 0; i < 20; i++) {
      const { unmount } = render(<App connection={connection} />);
      unmount();
    }
    expect(snapshotListeners()).toBe(0);
    expect(connection.chart.listenerCount).toBe(0);
    expect(connection.grid.listenerCount).toBe(0);
    expect(connection.replay.listenerCount).toBe(0);
    expect(connection.disconnect).toHaveBeenCalledTimes(20);
  });
});
