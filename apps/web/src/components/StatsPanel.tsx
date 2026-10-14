import type { ConnectionStats, ServerState } from '../ws';
import styles from './dashboard.module.css';

interface Props {
  stats: ConnectionStats;
  server: ServerState | null;
}

const fmt = new Intl.NumberFormat();
const time = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export function StatsPanel({ stats, server }: Props) {
  const reasons = Object.entries(stats.invalidByReason).filter(([, n]) => n > 0);

  const cards: Array<{ label: string; value: string; warn?: boolean }> = [
    { label: 'Events / sec', value: fmt.format(stats.eventsPerSec) },
    { label: 'Server rate', value: server ? fmt.format(server.rate) : '—' },
    { label: 'Total events', value: fmt.format(stats.totalEvents) },
    {
      label: 'Invalid events',
      value: fmt.format(stats.invalidEvents),
      warn: stats.invalidEvents > 0,
    },
    {
      label: 'Malformed frames',
      value: fmt.format(stats.malformedFrames),
      warn: stats.malformedFrames > 0,
    },
    { label: 'Missed frames', value: fmt.format(stats.missedFrames), warn: stats.missedFrames > 0 },
    {
      label: 'Server dropped',
      value: fmt.format(stats.serverDropped),
      warn: stats.serverDropped > 0,
    },
    {
      label: 'Last message',
      value: stats.lastMessageAt ? time.format(stats.lastMessageAt) : '—',
    },
  ];

  return (
    <section aria-label="Stream statistics">
      <dl className={styles.grid}>
        {cards.map((c) => (
          <div key={c.label} className={styles.card} data-tone={c.warn ? 'warn' : undefined}>
            <dt>{c.label}</dt>
            <dd>{c.value}</dd>
          </div>
        ))}
      </dl>
      {reasons.length > 0 && (
        <p className={styles.reasons}>
          Invalid by reason:{' '}
          {reasons.map(([reason, n], i) => (
            <span key={reason}>
              {i > 0 && ' · '}
              <code>{reason}</code> {fmt.format(n)}
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
