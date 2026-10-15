import { Profiler, useState } from 'react';
import styles from './App.module.css';
import { ChartPanel } from './components/ChartPanel';
import { ConnectionBadge } from './components/ConnectionBadge';
import { DataGrid } from './components/DataGrid';
import { KpiCards } from './components/KpiCards';
import { MetricsTable } from './components/MetricsTable';
import { PerfPanel } from './components/PerfPanel';
import { StatsPanel } from './components/StatsPanel';
import { StreamControls } from './components/StreamControls';
import dash from './components/dashboard.module.css';
import { onRenderProfile } from './perf/renderStats';
import { DEFAULT_VIEW, type ChartView } from './workers/chart';
import { appConnection, useConnection, type Connection } from './ws';

interface Props {
  /** Injectable so tests can pass a fake connection. */
  connection?: Connection;
}

export function App({ connection = appConnection }: Props) {
  const snapshot = useConnection(connection);
  const { status, lastClose, server, stats, latest, workerError } = snapshot;
  const connected = status === 'connected';
  const [view, setView] = useState<ChartView>(DEFAULT_VIEW);

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
        <Profiler id="kpis" onRender={onRenderProfile}>
          <KpiCards snapshot={snapshot} />
        </Profiler>
        <Profiler id="charts" onRender={onRenderProfile}>
          <ChartPanel connection={connection} view={view} onViewChange={setView} />
        </Profiler>
        <Profiler id="grid" onRender={onRenderProfile}>
          <DataGrid connection={connection} />
        </Profiler>
        <PerfPanel connection={connection} stats={stats} />
        <details className={dash.pipeline}>
          <summary>Pipeline details</summary>
          <StatsPanel stats={stats} server={server} />
          <MetricsTable latest={latest} />
        </details>
      </main>
    </div>
  );
}
