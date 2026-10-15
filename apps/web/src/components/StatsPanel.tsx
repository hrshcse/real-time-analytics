import type { ConnectionStats, ServerState } from '../ws';
import styles from './dashboard.module.css';

interface Props {
  stats: ConnectionStats;
  server: ServerState | null;
}

interface Card {
  label: string;
  value: string;
  hint?: string;
  warn?: boolean;
}

const fmt = new Intl.NumberFormat();
const ms = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const time = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function CardGrid({ title, cards }: { title: string; cards: Card[] }) {
  return (
    <section aria-label={title}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <dl className={styles.grid}>
        {cards.map((c) => (
          <div key={c.label} className={styles.card} data-tone={c.warn ? 'warn' : undefined}>
            <dt>{c.label}</dt>
            <dd>{c.value}</dd>
            {c.hint && <p className={styles.hint}>{c.hint}</p>}
          </div>
        ))}
      </dl>
    </section>
  );
}

export function StatsPanel({ stats, server }: Props) {
  const reasons = Object.entries(stats.invalidByReason).filter(([, n]) => n > 0);
  const p = stats.processing;

  const throughput: Card[] = [
    {
      label: 'Events / sec',
      value: fmt.format(stats.eventsPerSec),
      hint: 'valid, counted in worker',
    },
    { label: 'Server rate', value: server ? fmt.format(server.rate) : '—' },
    { label: 'Frames / sec', value: fmt.format(stats.framesPerSec), hint: 'batch frames on main' },
    {
      label: 'Posts to worker / sec',
      value: fmt.format(stats.postsPerSec),
      hint: 'after buffering',
    },
    {
      label: 'Worker ms / batch',
      value: p ? ms.format(p.avgMs) : '—',
      hint: p ? `max ${ms.format(p.maxMs)} ms · ${fmt.format(p.batches)} batches` : undefined,
    },
  ];

  const quality: Card[] = [
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
    { label: 'Late events', value: fmt.format(stats.lateEvents), warn: stats.lateEvents > 0 },
    {
      label: 'Last message',
      value: stats.lastMessageAt ? time.format(stats.lastMessageAt) : '—',
    },
  ];

  return (
    <>
      <CardGrid title="Throughput" cards={throughput} />
      <CardGrid title="Data quality" cards={quality} />
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
    </>
  );
}
