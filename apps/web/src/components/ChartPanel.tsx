import { useCallback, useEffect, useRef, useState } from 'react';
import { METRICS, type MetricType } from '@rta/shared';
import { useStore } from '../hooks/useStore';
import type { DownsampleAlgorithm } from '../processing';
import type { ChartView } from '../workers/chart';
import type { Connection } from '../ws';
import { MetricChart } from './MetricChart';
import { SERIES_COLORS, UNIT } from './units';
import styles from './chart.module.css';
import dash from './dashboard.module.css';

const RANGES = [
  { ms: 60_000, label: '1m' },
  { ms: 300_000, label: '5m' },
  { ms: 900_000, label: '15m' },
  { ms: 3_600_000, label: '1h' },
];
const ALGORITHMS: Array<{ id: DownsampleAlgorithm; label: string }> = [
  { id: 'lttb', label: 'LTTB' },
  { id: 'nth', label: 'Every Nth' },
  { id: 'none', label: 'None' },
];
const MAX_POINTS = [100, 300, 1000];
const ms = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const one = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const pct = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 2 });

function formatter(metric: MetricType, resolution: ChartView['resolution']) {
  // Bucket avg of 0/1 error flags IS the error rate; a raw error event is just 0 or 1.
  if (metric === 'errors')
    return resolution === 'bucket' ? (v: number) => pct.format(v) : (v: number) => String(v);
  return (v: number) => `${one.format(v)} ${UNIT[metric]}`;
}
const fmt = new Intl.NumberFormat();

interface Props {
  connection: Connection;
  view: ChartView;
  onViewChange: (view: ChartView) => void;
}

/** Live charts (WBS 7) with time range, resolution, downsampling and pause/clear controls. */
export function ChartPanel({ connection, view, onViewChange }: Props) {
  const chart = useStore(connection.chart);
  const [paused, setPaused] = useState(false);
  const [clearedAt, setClearedAt] = useState(0);
  const [renderMs, setRenderMs] = useState<number | null>(null);
  const renderTotal = useRef(0);

  // Tell the worker what to build; stop building when the panel unmounts.
  useEffect(() => {
    connection.setView(view);
  }, [connection, view]);
  useEffect(() => () => connection.setView(null), [connection]);

  // Sum render time across the small multiples of one update, published once per frame.
  const onRender = useCallback((t: number) => {
    renderTotal.current += t;
    requestAnimationFrame(() => {
      if (renderTotal.current === 0) return;
      setRenderMs(renderTotal.current);
      renderTotal.current = 0;
    });
  }, []);

  const update = (patch: Partial<ChartView>) => onViewChange({ ...view, ...patch });
  const toggleMetric = (m: MetricType) =>
    update({
      metrics: view.metrics.includes(m)
        ? view.metrics.filter((x) => x !== m)
        : METRICS.filter((x) => x === m || view.metrics.includes(x)),
    });

  return (
    <section aria-label="Charts" className={styles.panel}>
      <div className={styles.toolbar}>
        <h2 className={dash.sectionTitle}>Charts</h2>
        <div className={styles.controls}>
          <div role="radiogroup" aria-label="Time range" className={styles.segmented}>
            {RANGES.map((r) => (
              <button
                key={r.ms}
                type="button"
                role="radio"
                aria-checked={view.rangeMs === r.ms}
                className={styles.segment}
                onClick={() => update({ rangeMs: r.ms })}
              >
                {r.label}
              </button>
            ))}
          </div>
          <label className={dash.label} htmlFor="chart-resolution">
            Resolution
          </label>
          <select
            id="chart-resolution"
            className={dash.select}
            value={view.resolution}
            onChange={(e) => update({ resolution: e.target.value as ChartView['resolution'] })}
          >
            <option value="bucket">1 s buckets</option>
            <option value="raw">Raw events</option>
          </select>
          <label className={dash.label} htmlFor="chart-downsampling">
            Downsampling
          </label>
          <select
            id="chart-downsampling"
            className={dash.select}
            value={view.algorithm}
            onChange={(e) => update({ algorithm: e.target.value as DownsampleAlgorithm })}
          >
            {ALGORITHMS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
          <label className={dash.label} htmlFor="chart-max-points">
            Max points
          </label>
          <select
            id="chart-max-points"
            className={dash.select}
            value={view.maxPoints}
            onChange={(e) => update({ maxPoints: Number(e.target.value) })}
          >
            {MAX_POINTS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={dash.button}
            aria-pressed={paused}
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? 'Resume chart' : 'Pause chart'}
          </button>
          <button type="button" className={dash.button} onClick={() => setClearedAt(Date.now())}>
            Clear
          </button>
        </div>
      </div>

      <fieldset className={styles.metricToggles}>
        <legend className={dash.label}>Metrics</legend>
        {METRICS.map((m) => (
          <label key={m} className={styles.toggle}>
            <input
              type="checkbox"
              checked={view.metrics.includes(m)}
              onChange={() => toggleMetric(m)}
            />{' '}
            {m}
          </label>
        ))}
        <span className={styles.legend} aria-hidden="true">
          <span className={styles.swatch} style={{ background: SERIES_COLORS.avg }} /> avg
          <span className={styles.swatchDashed} style={{ borderColor: SERIES_COLORS.p95 }} /> p95
        </span>
      </fieldset>

      <p className={styles.meta} aria-live="off">
        {paused && <strong className={styles.pausedTag}>Paused — stream continues </strong>}
        {chart
          ? `${fmt.format(chart.inputPoints)} → ${fmt.format(chart.outputPoints)} points per metric · ` +
            `downsample ${ms.format(chart.downsampleMs)} ms (worker)` +
            (renderMs === null ? '' : ` · render ${ms.format(renderMs)} ms (main)`)
          : 'Waiting for data…'}
      </p>

      {view.metrics.length === 0 ? (
        <p className={dash.reasons}>Select at least one metric.</p>
      ) : (
        <div className={styles.multiples}>
          {view.metrics.map((m) => (
            <MetricChart
              key={m}
              metric={m}
              unit={UNIT[m]}
              series={chart?.series[m]}
              paused={paused}
              clearedAt={clearedAt}
              xMin={(chart?.builtAt ?? 0) - view.rangeMs}
              xMax={chart?.builtAt ?? 0 /* no chart → no series → no update */}
              showP95={view.resolution === 'bucket' && m !== 'errors'}
              format={formatter(m, view.resolution)}
              onRender={onRender}
            />
          ))}
        </div>
      )}
    </section>
  );
}
