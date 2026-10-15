import type { ConnectionSnapshot, ConnectionStatus } from '../ws';
import styles from './dashboard.module.css';
import { useCountdown } from './useCountdown';

const LABEL: Record<ConnectionStatus, string> = {
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  disconnected: 'Disconnected',
};

interface Props {
  status: ConnectionStatus;
  lastClose: ConnectionSnapshot['lastClose'];
  reconnect?: ConnectionSnapshot['reconnect'];
}

/** Text + colour, never colour alone (WBS 19). aria-live announces status changes only,
 *  which are rare — streamed numbers are deliberately NOT announced. */
export function ConnectionBadge({ status, lastClose, reconnect = null }: Props) {
  const seconds = useCountdown(reconnect?.nextRetryAt ?? null);
  return (
    <span className={styles.badge} data-status={status} role="status" aria-live="polite">
      <span className={styles.dot} aria-hidden="true" />
      {LABEL[status]}
      {status === 'reconnecting' && reconnect && (
        <span className={styles.code}>
          {reconnect.attempt}/{reconnect.maxAttempts}
          {seconds !== null && seconds > 0 ? ` · ${seconds}s` : ''}
        </span>
      )}
      {status === 'disconnected' && lastClose && (
        <span className={styles.code}>code {lastClose.code}</span>
      )}
    </span>
  );
}
