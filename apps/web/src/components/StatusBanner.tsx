import type { Connection, ConnectionSnapshot } from '../ws';
import styles from './dashboard.module.css';
import { useCountdown } from './useCountdown';

/**
 * One banner for the dashboard's state (WBS 17.4), most severe first:
 *   error (retries exhausted, worker failure) → reconnecting → partial failure (storage)
 *   → loading (connecting, no data yet) → empty (connected, stream stopped)
 * Errors use role="alert"; the rest are polite status messages.
 */
export function StatusBanner({
  snapshot,
  connection,
}: {
  snapshot: ConnectionSnapshot;
  connection: Connection;
}) {
  const { status, retryExhausted, workerError, storage, reconnect, lastClose, server, stats } =
    snapshot;
  const seconds = useCountdown(reconnect?.nextRetryAt ?? null);

  if (retryExhausted) {
    return (
      <Banner tone="error" action={{ label: 'Reconnect', onClick: connection.connect }}>
        Couldn’t reconnect after {reconnect?.maxAttempts ?? 'several'} attempts
        {lastClose ? ` (last close code ${lastClose.code})` : ''}. Showing the last data received.
      </Banner>
    );
  }
  if (status === 'disconnected' && lastClose?.code === 4401) {
    return (
      <Banner tone="error" action={{ label: 'Try again', onClick: connection.connect }}>
        The server refused the connection (4401 Unauthorized). Check that VITE_WS_TOKEN matches the
        server’s AUTH_TOKEN.
      </Banner>
    );
  }
  if (workerError) {
    return (
      <Banner tone="error" action={{ label: 'Restart worker', onClick: connection.restartWorker }}>
        Processing stopped: {workerError}
      </Banner>
    );
  }
  if (status === 'reconnecting' && reconnect) {
    return (
      <Banner tone="warn" action={{ label: 'Retry now', onClick: connection.connect }}>
        Connection lost{lastClose ? ` (code ${lastClose.code})` : ''}. Retrying
        {seconds ? ` in ${seconds}s` : ' now'} — attempt {reconnect.attempt} of{' '}
        {reconnect.maxAttempts}. Data shown is from before the drop.
      </Banner>
    );
  }
  if (storage.status === 'unavailable' || storage.status === 'error') {
    return (
      <Banner tone="warn">
        Live data is fine, but history is off: {storage.message}. Reload recovery and replay are
        unavailable.
      </Banner>
    );
  }
  if (status === 'connecting' && stats.totalEvents === 0) {
    return <Banner tone="info">Connecting to the stream…</Banner>;
  }
  if (status === 'connected' && server && !server.running) {
    return (
      <Banner
        tone="info"
        action={{ label: 'Start stream', onClick: () => connection.send({ type: 'start' }) }}
      >
        The stream is stopped — no new events are arriving.
      </Banner>
    );
  }
  return null;
}

function Banner({
  tone,
  children,
  action,
}: {
  tone: 'error' | 'warn' | 'info';
  children: React.ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div
      className={styles.statusBanner}
      data-tone={tone}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <span className={styles.bannerIcon} aria-hidden="true">
        {tone === 'error' ? '✕' : tone === 'warn' ? '!' : 'i'}
      </span>
      <p className={styles.bannerText}>{children}</p>
      {action && (
        <button type="button" className={styles.button} onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
