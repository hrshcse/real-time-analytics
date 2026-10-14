import type { ConnectionSnapshot, ConnectionStatus } from '../ws';
import styles from './dashboard.module.css';

const LABEL: Record<ConnectionStatus, string> = {
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  disconnected: 'Disconnected',
};

interface Props {
  status: ConnectionStatus;
  lastClose: ConnectionSnapshot['lastClose'];
}

/** Text + colour, never colour alone (WBS 19). aria-live announces status changes only,
 *  which are rare — streamed numbers are deliberately NOT announced. */
export function ConnectionBadge({ status, lastClose }: Props) {
  return (
    <span className={styles.badge} data-status={status} role="status" aria-live="polite">
      <span className={styles.dot} aria-hidden="true" />
      {LABEL[status]}
      {status === 'disconnected' && lastClose && (
        <span className={styles.code}>code {lastClose.code}</span>
      )}
    </span>
  );
}
