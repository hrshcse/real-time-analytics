import styles from './App.module.css';
import { ConnectionBadge } from './components/ConnectionBadge';
import { StatsPanel } from './components/StatsPanel';
import { StreamControls } from './components/StreamControls';
import { appConnection, useConnection, type Connection } from './ws';

interface Props {
  /** Injectable so tests can pass a fake connection. */
  connection?: Connection;
}

export function App({ connection = appConnection }: Props) {
  const { status, lastClose, server, stats } = useConnection(connection);
  const connected = status === 'connected';

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <h1 className={styles.title}>Real-Time Analytics</h1>
        <div className={styles.headerRight}>
          <ConnectionBadge status={status} lastClose={lastClose} />
          {status === 'disconnected' && (
            <button type="button" className={styles.linkButton} onClick={connection.connect}>
              Connect
            </button>
          )}
        </div>
      </header>
      <main>
        <StreamControls connected={connected} server={server} send={connection.send} />
        <StatsPanel stats={stats} server={server} />
      </main>
    </div>
  );
}
