import type { ConnectionSnapshot } from '../ws';
import styles from './dashboard.module.css';

const fmt = new Intl.NumberFormat();
const one = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const pct = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 2 });
const time = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Headline numbers (WBS 8). Details live in the Pipeline section. */
export function KpiCards({ snapshot }: { snapshot: ConnectionSnapshot }) {
  const { stats, latest, status, connectedAt } = snapshot;
  const last = latest[1000] ?? {};
  const latency = last.latency;
  const errors = last.errors;
  const droppedEvents = stats.invalidEvents + stats.lateEvents;
  const droppedFrames = stats.missedFrames + stats.serverDropped + stats.droppedOnDisconnect;

  const cards = [
    { label: 'Events / sec', value: fmt.format(stats.eventsPerSec), hint: 'valid events' },
    {
      label: 'Avg latency',
      value: latency ? `${one.format(latency.avg)} ms` : '—',
      hint: latency ? `p95 ${one.format(latency.p95)} ms · last 1 s` : 'waiting for a full second',
    },
    {
      label: 'Error rate',
      value: errors ? pct.format(errors.avg) : '—',
      hint: 'last 1 s',
      warn: (errors?.avg ?? 0) > 0.05,
    },
    {
      label: 'Dropped events',
      value: fmt.format(droppedEvents),
      hint: `${fmt.format(droppedFrames)} frames lost`,
      warn: droppedEvents + droppedFrames > 0,
    },
    {
      label: 'Connection',
      value: status === 'connected' ? 'Live' : status === 'disconnected' ? 'Offline' : 'Connecting',
      hint: connectedAt
        ? `since ${time.format(connectedAt)}`
        : snapshot.lastClose
          ? `last close ${snapshot.lastClose.code}`
          : '—',
      warn: status !== 'connected',
    },
    {
      label: 'Memory',
      value: stats.heapMB === null ? 'n/a' : `${fmt.format(stats.heapMB)} MB`,
      hint: stats.heapMB === null ? 'needs Chrome' : 'main-thread JS heap',
    },
  ];

  return (
    <section aria-label="Key metrics">
      <dl className={styles.kpis}>
        {cards.map((c) => (
          <div key={c.label} className={styles.card} data-tone={c.warn ? 'warn' : undefined}>
            <dt>{c.label}</dt>
            <dd>{c.value}</dd>
            <p className={styles.hint}>{c.hint}</p>
          </div>
        ))}
      </dl>
    </section>
  );
}
