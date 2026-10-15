import { lazy, Profiler, Suspense, useEffect, useState } from 'react';
import styles from './App.module.css';
import { ChartPanel } from './components/ChartPanel';
import { ConnectionBadge } from './components/ConnectionBadge';
import { DataGrid } from './components/DataGrid';
import { KpiCards } from './components/KpiCards';
import { MetricsTable } from './components/MetricsTable';
import { PerfPanel } from './components/PerfPanel';
import { StatsPanel } from './components/StatsPanel';
import { StatusBanner } from './components/StatusBanner';
import { StreamControls } from './components/StreamControls';
import dash from './components/dashboard.module.css';
import { onRenderProfile } from './perf/renderStats';
import { loadChartView, saveChartView } from './prefs';
import type { ChartView } from './workers/chart';
import { appConnection, useConnection, type Connection } from './ws';

// Dev-only: the import() sits behind import.meta.env.DEV, so production builds drop it entirely.
const LeakLab = import.meta.env.DEV ? lazy(() => import('./lab/LeakLab')) : null;

interface Props {
  /** Injectable so tests can pass a fake connection. */
  connection?: Connection;
}

export function App({ connection = appConnection }: Props) {
  const snapshot = useConnection(connection);
  const { status, lastClose, server, stats, latest, reconnect } = snapshot;
  const connected = status === 'connected';
  const [view, setView] = useState<ChartView>(loadChartView); // restored after reload (WBS 11.2)
  useEffect(() => saveChartView(view), [view]);

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <h1 className={styles.title}>Real-Time Analytics</h1>
        <div className={styles.headerRight}>
          <ConnectionBadge status={status} lastClose={lastClose} reconnect={reconnect} />
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
        <StatusBanner snapshot={snapshot} connection={connection} />
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
        {LeakLab && (
          <Suspense fallback={null}>
            <LeakLab connection={connection} stats={stats} />
          </Suspense>
        )}
        <details className={dash.pipeline}>
          <summary>Pipeline details</summary>
          <StatsPanel stats={stats} server={server} />
          <MetricsTable latest={latest} />
        </details>
      </main>
    </div>
  );
}
