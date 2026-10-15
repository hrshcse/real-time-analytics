import { useState } from 'react';
import { usePerfMeters } from '../perf/usePerfMeters';
import type { Connection, ConnectionStats, PublishMode } from '../ws';
import styles from './dashboard.module.css';

const fmt = new Intl.NumberFormat();
const ms1 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

interface Props {
  connection: Connection;
  stats: ConnectionStats;
}

/** Performance instrumentation (WBS 14) and experiment switches (WBS 10, 15.4). */
export function PerfPanel({ connection, stats }: Props) {
  const [open, setOpen] = useState(false);
  const meters = usePerfMeters(open);
  const [mode, setMode] = useState<PublishMode>(connection.experiments.publishMode);
  const [backpressure, setBackpressure] = useState(connection.experiments.backpressure);
  const [slowMs, setSlowMs] = useState(connection.experiments.simulatedWorkMs);

  const renders = Object.values(meters.renders);
  const commits = renders.reduce((s, r) => s + r.commits, 0);
  const renderMs = renders.reduce((s, r) => s + r.totalMs, 0);
  const renderMax = renders.reduce((m, r) => Math.max(m, r.maxMs), 0);
  const p = stats.processing;

  const cards = [
    {
      label: 'FPS',
      value: meters.fps === null ? '—' : String(meters.fps),
      warn: meters.fps !== null && meters.fps < 50,
    },
    {
      label: 'Long tasks (10 s)',
      value: meters.longTasks ? fmt.format(meters.longTasks.count) : 'n/a',
      hint: meters.longTasks
        ? `${fmt.format(Math.round(meters.longTasks.totalMs))} ms total`
        : 'needs Chrome',
      warn: (meters.longTasks?.count ?? 0) > 0,
    },
    {
      label: 'React commits / s',
      value: open ? fmt.format(commits) : '—',
      hint: open
        ? commits === 0 && import.meta.env.PROD
          ? 'Profiler is off in production builds'
          : `${ms1.format(renderMs)} ms total · max ${ms1.format(renderMax)} ms`
        : undefined,
    },
    { label: 'Publishes / s', value: fmt.format(stats.publishesPerSec), hint: 'snapshot → React' },
    {
      label: 'Main thread ms / s',
      value: ms1.format(stats.mainMsPerSec),
      hint: 'socket + worker handlers',
    },
    {
      label: 'Worker ms / batch',
      value: p ? ms1.format(p.avgMs) : '—',
      hint: p ? `max ${ms1.format(p.maxMs)} ms` : undefined,
    },
    {
      label: 'In-flight frames',
      value: fmt.format(stats.inFlightFrames),
      warn: stats.inFlightFrames > 32,
    },
    {
      label: 'Backpressure drops',
      value: fmt.format(stats.backpressureDropped),
      hint: 'oldest frames, main thread',
      warn: stats.backpressureDropped > 0,
    },
    {
      label: 'Data lag',
      value: stats.dataLagMs === null ? '—' : `${fmt.format(Math.round(stats.dataLagMs))} ms`,
      hint: 'age of newest processed event',
      warn: (stats.dataLagMs ?? 0) > 1000,
    },
  ];

  return (
    <details className={styles.pipeline} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Performance</summary>
      <dl className={styles.grid}>
        {cards.map((c) => (
          <div key={c.label} className={styles.card} data-tone={c.warn ? 'warn' : undefined}>
            <dt>{c.label}</dt>
            <dd>{c.value}</dd>
            {c.hint && <p className={styles.hint}>{c.hint}</p>}
          </div>
        ))}
      </dl>

      <fieldset className={styles.lab}>
        <legend className={styles.sectionTitle}>Experiments</legend>
        <label className={styles.label} htmlFor="exp-render">
          Render updates
        </label>
        <select
          id="exp-render"
          className={styles.select}
          value={mode}
          onChange={(e) => {
            const m = e.target.value as PublishMode;
            setMode(m);
            connection.setPublishMode(m);
          }}
        >
          <option value="raf">Batched (250 ms + rAF)</option>
          <option value="immediate">Every message (naive)</option>
        </select>
        <label className={styles.label} htmlFor="exp-bp">
          Backpressure
        </label>
        <select
          id="exp-bp"
          className={styles.select}
          value={backpressure ? 'on' : 'off'}
          onChange={(e) => {
            const on = e.target.value === 'on';
            setBackpressure(on);
            connection.setBackpressure(on);
          }}
        >
          <option value="on">On (drop oldest)</option>
          <option value="off">Off (unbounded)</option>
        </select>
        <label className={styles.label} htmlFor="exp-slow">
          Slow worker
        </label>
        <select
          id="exp-slow"
          className={styles.select}
          value={slowMs}
          onChange={(e) => {
            const v = Number(e.target.value);
            setSlowMs(v);
            connection.setSimulatedWorkMs(v);
          }}
        >
          {[0, 5, 10, 20, 50].map((v) => (
            <option key={v} value={v}>
              {v === 0 ? 'Off' : `+${v} ms per frame`}
            </option>
          ))}
        </select>
      </fieldset>
    </details>
  );
}
