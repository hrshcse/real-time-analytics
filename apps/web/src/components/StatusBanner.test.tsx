import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { emptySnapshot, fakeConnection } from '../test/fakeConnection';
import type { ConnectionSnapshot } from '../ws';
import { StatusBanner } from './StatusBanner';

const show = (patch: Partial<ConnectionSnapshot>) => {
  const { connection } = fakeConnection();
  render(<StatusBanner snapshot={{ ...emptySnapshot(), ...patch }} connection={connection} />);
  return connection;
};

describe('StatusBanner (WBS 17.4)', () => {
  it('retries exhausted → error with a Reconnect action', () => {
    const c = show({
      status: 'disconnected',
      retryExhausted: true,
      lastClose: { code: 1006, reason: '', wasClean: false },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t reconnect');
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(c.connect).toHaveBeenCalled();
  });

  it('worker failure → error with Restart worker', () => {
    const c = show({ status: 'connected', workerError: 'boom' });
    fireEvent.click(screen.getByRole('button', { name: 'Restart worker' }));
    expect(c.restartWorker).toHaveBeenCalled();
  });

  it('reconnecting → attempt count and Retry now', () => {
    show({
      status: 'reconnecting',
      reconnect: { attempt: 3, maxAttempts: 10, nextRetryAt: Date.now() + 4000 },
    });
    expect(screen.getByRole('status')).toHaveTextContent('attempt 3 of 10');
    expect(screen.getByRole('button', { name: 'Retry now' })).toBeInTheDocument();
  });

  it('storage unavailable → partial failure, live data still OK', () => {
    show({
      status: 'connected',
      storage: { status: 'unavailable', message: 'blocked', restoredBuckets: 0, corruptRecords: 0 },
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Live data is fine, but history is off: blocked',
    );
  });

  it('connecting with no data → loading', () => {
    show({ status: 'connecting' });
    expect(screen.getByRole('status')).toHaveTextContent('Connecting to the stream');
  });

  it('stream stopped → empty state with Start', () => {
    const c = show({
      status: 'connected',
      server: { running: false, rate: 1000, baseRate: 1000, burstEndsAt: null, tickMs: 50 },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start stream' }));
    expect(c.send).toHaveBeenCalledWith({ type: 'start' });
  });

  it('healthy → no banner', () => {
    show({
      status: 'connected',
      server: { running: true, rate: 1000, baseRate: 1000, burstEndsAt: null, tickMs: 50 },
    });
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
