import { useState } from 'react';
import { METRICS, type MetricType } from '@rta/shared';
import type { BucketStats, LatestBuckets } from '../processing';
import styles from './dashboard.module.css';

const WINDOWS = [
  { ms: 1000, label: '1 s' },
  { ms: 5000, label: '5 s' },
  { ms: 10_000, label: '10 s' },
  { ms: 60_000, label: '1 min' },
] as const;

const UNIT: Record<MetricType, string> = {
  cpu: '%',
  memory: '%',
  network: 'KB/s',
  requests: 'req/s',
  latency: 'ms',
  errors: '',
};

const num = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const pct = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 2 });
const time = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function cells(metric: MetricType, b: BucketStats | undefined) {
  if (!b) return ['—', '—', '—', '—', '—', '—'];
  if (metric === 'errors') {
    // values are 0/1, so avg = error rate; min/max/percentiles say little
    return [num.format(b.count), `${pct.format(b.avg)} rate`, '', '', '', ''];
  }
  return [b.count, b.avg, b.min, b.max, b.p95, b.p99].map((v) => num.format(v));
}

interface Props {
  latest: Record<number, LatestBuckets>;
}

/** Temporary view of the worker's aggregates (WBS 5). Charts replace this in Phase 3. */
export function MetricsTable({ latest }: Props) {
  const [windowMs, setWindowMs] = useState<number>(1000);
  const buckets = latest[windowMs] ?? {};
  const start = Object.values(buckets).find(Boolean)?.start;

  return (
    <section aria-label="Aggregates" className={styles.tableSection}>
      <div className={styles.tableHeader}>
        <h2 className={styles.sectionTitle}>Latest closed bucket</h2>
        <div className={styles.group}>
          <label className={styles.label} htmlFor="window">
            Window
          </label>
          <select
            id="window"
            className={styles.select}
            value={windowMs}
            onChange={(e) => setWindowMs(Number(e.target.value))}
          >
            {WINDOWS.map((w) => (
              <option key={w.ms} value={w.ms}>
                {w.label}
              </option>
            ))}
          </select>
          <span className={styles.label}>
            {start !== undefined ? `from ${time.format(start)}` : 'waiting…'}
          </span>
        </div>
      </div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Metric</th>
            <th scope="col">Count</th>
            <th scope="col">Avg</th>
            <th scope="col">Min</th>
            <th scope="col">Max</th>
            <th scope="col">P95</th>
            <th scope="col">P99</th>
          </tr>
        </thead>
        <tbody>
          {METRICS.map((m) => (
            <tr key={m}>
              <th scope="row">
                {m} {UNIT[m] && <span className={styles.unit}>{UNIT[m]}</span>}
              </th>
              {cells(m, buckets[m]).map((v, i) => (
                <td key={i}>{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
