import { useEffect, useState } from 'react';
import type { Connection, ConnectionStats } from '../ws';
import styles from '../components/dashboard.module.css';
import { leakedNodeCount, releaseLeaks } from './leakRegistry';
import { LeakSubject, type LeakKind } from './leaks';

const fmt = new Intl.NumberFormat();
const CYCLES = 50;

/**
 * Leak Lab (WBS 16): mount/unmount a subject N times in leaky or fixed mode and watch what
 * survives. Use with Chrome DevTools → Memory → heap snapshot (docs/MEMORY.md).
 */
export default function LeakLab({
  connection,
  stats,
}: {
  connection: Connection;
  stats: ConnectionStats;
}) {
  const [kind, setKind] = useState<LeakKind>('subscription');
  const [leaky, setLeaky] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [cycles, setCycles] = useState(0);
  const [, refresh] = useState(0);

  // Drive mount → unmount pairs, one per frame, so React commits each.
  useEffect(() => {
    if (remaining === 0) return;
    const id = requestAnimationFrame(() => {
      if (mounted) {
        setMounted(false);
        setRemaining((r) => r - 1);
        setCycles((c) => c + 1);
      } else {
        setMounted(true);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [remaining, mounted]);

  // Re-read the counters once a second (they're not React state).
  useEffect(() => {
    const t = setInterval(() => refresh((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <details className={styles.pipeline}>
      <summary>Leak lab (dev only)</summary>
      <div className={styles.lab}>
        <label className={styles.label} htmlFor="leak-kind">
          Leak
        </label>
        <select
          id="leak-kind"
          className={styles.select}
          value={kind}
          onChange={(e) => setKind(e.target.value as LeakKind)}
        >
          <option value="detached-dom">Detached DOM retention</option>
          <option value="subscription">Subscription without unsubscribe</option>
          <option value="closure">Closure retaining large data</option>
        </select>
        <label className={styles.label} htmlFor="leak-mode">
          Mode
        </label>
        <select
          id="leak-mode"
          className={styles.select}
          value={leaky ? 'leaky' : 'fixed'}
          onChange={(e) => setLeaky(e.target.value === 'leaky')}
        >
          <option value="leaky">Leaky</option>
          <option value="fixed">Fixed</option>
        </select>
        <button
          type="button"
          className={styles.button}
          disabled={remaining > 0}
          onClick={() => setRemaining(CYCLES)}
        >
          Mount/unmount ×{CYCLES}
        </button>
        <button type="button" className={styles.button} onClick={() => releaseLeaks()}>
          Release pinned nodes
        </button>
      </div>
      <dl className={styles.grid}>
        <div className={styles.card}>
          <dt>Cycles run</dt>
          <dd>{fmt.format(cycles)}</dd>
        </div>
        <div
          className={styles.card}
          data-tone={connection.chart.listenerCount > 2 ? 'warn' : undefined}
        >
          <dt>Chart store listeners</dt>
          <dd>{fmt.format(connection.chart.listenerCount)}</dd>
          <dd className={styles.hint}>should stay at the number of live subscribers</dd>
        </div>
        <div className={styles.card} data-tone={leakedNodeCount() > 0 ? 'warn' : undefined}>
          <dt>Pinned detached subtrees</dt>
          <dd>{fmt.format(leakedNodeCount())}</dd>
        </div>
        <div className={styles.card}>
          <dt>Main heap</dt>
          <dd>{stats.heapMB === null ? 'n/a' : `${fmt.format(stats.heapMB)} MB`}</dd>
          <dd className={styles.hint}>force GC in DevTools before reading</dd>
        </div>
      </dl>
      {mounted && <LeakSubject kind={kind} leaky={leaky} store={connection.chart} />}
    </details>
  );
}
