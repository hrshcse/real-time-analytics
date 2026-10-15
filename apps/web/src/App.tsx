import styles from './App.module.css';
import dash from './components/dashboard.module.css';
import { ConnectionBadge } from './components/ConnectionBadge';
import { MetricsTable } from './components/MetricsTable';
import { StatsPanel } from './components/StatsPanel';
import { StreamControls } from './components/StreamControls';
import { appConnection, useConnection, type Connection } from './ws';

interface Props {
  /** Injectable so tests can pass a fake connection. */
  connection?: Connection;
}

export function App({ connection = appConnection }: Props) {
  const { status, lastClose, server, stats, latest, workerError } = useConnection(connection);
  const connected = status === 'connected';

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <h1 className={styles.title}>Real-Time Analytics</h1>
        <div className={styles.headerRight}>
          <ConnectionBadge status={status} lastClose={lastClose} />
          {status === 'disconnected' ? (
            <button type="button" className={styles.linkButton} onClick={connection.connect}>
              Connect
            </button>
          ) : (
            <button type="button" className={styles.linkButton} onClick={connection.disconnect}>
              Disconnect
            </button>
          )}
        </div>
      </header>
      <main>
        <StreamControls connected={connected} server={server} send={connection.send} />
        {workerError && (
          <p role="alert" className={dash.banner}>
            Processing worker error: {workerError}
          </p>
        )}
        <StatsPanel stats={stats} server={server} />
        <MetricsTable latest={latest} />
      </main>
    </div>
  );
}
