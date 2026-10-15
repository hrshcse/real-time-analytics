import { useEffect, useLayoutEffect, useRef } from 'react';
import {
  Chart,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  type ChartConfiguration,
} from 'chart.js';
import type { MetricType } from '@rta/shared';
import type { ChartSeries } from '../workers/chart';
import styles from './chart.module.css';
import { SERIES_COLORS } from './units';

// Tree-shaken registration: only what a line chart on a linear axis needs.
Chart.register(LineController, LineElement, PointElement, LinearScale, Tooltip);

const GRID = 'rgba(139, 147, 167, 0.15)';
const TICK = '#8b93a7';

const clock = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

interface Props {
  metric: MetricType;
  unit: string;
  series: ChartSeries | undefined;
  paused: boolean;
  /** Points before this time are hidden (Clear). */
  clearedAt: number;
  /** x-axis span, so a chart with 8 s of data still shows the full selected range. */
  xMin: number;
  xMax: number;
  /** p95 is meaningless for 0/1 data (errors) and absent in raw mode. */
  showP95: boolean;
  format: (v: number) => string;
  onRender?: (ms: number) => void;
}

type Point = { x: number; y: number };

/**
 * One metric, one chart (small multiples: each metric keeps its own y-scale; never a dual axis).
 * The Chart.js instance is created once and updated in place — no React re-render of the canvas.
 */
export function MetricChart({
  metric,
  unit,
  series,
  paused,
  clearedAt,
  xMin,
  xMax,
  showP95,
  format,
  onRender,
}: Props) {
  // Latest-ref pattern: the tooltip callback (created once) always reads the current formatter.
  // Written in a layout effect, never during render.
  const formatRef = useRef(format);
  useLayoutEffect(() => {
    formatRef.current = format;
  }, [format]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart<'line', Point[]> | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const config: ChartConfiguration<'line', Point[]> = {
      type: 'line',
      data: {
        datasets: [
          { label: 'avg', data: [], borderColor: SERIES_COLORS.avg, borderWidth: 2 },
          {
            label: 'p95',
            data: [],
            borderColor: SERIES_COLORS.p95,
            borderWidth: 1.5,
            borderDash: [4, 3],
          },
        ],
      },
      options: {
        animation: false, // live data: animating every update costs frames
        parsing: false, // data is already {x, y}; skip Chart.js's per-point parse
        normalized: true, // x is sorted ascending
        responsive: true,
        maintainAspectRatio: false,
        elements: { point: { radius: 0, hitRadius: 6 }, line: { tension: 0 } },
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            type: 'linear',
            grid: { color: GRID },
            ticks: { color: TICK, maxTicksLimit: 4, callback: (v) => clock.format(Number(v)) },
          },
          y: { grid: { color: GRID }, ticks: { color: TICK, maxTicksLimit: 4 } },
        },
        plugins: {
          tooltip: {
            callbacks: {
              title: (items) => (items[0] ? clock.format(items[0].parsed.x ?? 0) : ''),
              label: (item) => `${item.dataset.label}: ${formatRef.current(item.parsed.y ?? 0)}`,
            },
          },
        },
      },
    };
    chartRef.current = new Chart(canvas, config);
    return () => {
      // Destroy on unmount: Chart.js holds the canvas, listeners and a resize observer (WBS 16).
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [unit]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || paused || !series) return; // paused: the stream continues, the chart doesn't
    const avg: Point[] = [];
    const p95: Point[] = [];
    for (let i = 0; i < series.t.length; i++) {
      const x = series.t[i]!;
      if (x < clearedAt) continue;
      avg.push({ x, y: series.y[i]! });
      if (showP95 && series.p95.length) p95.push({ x, y: series.p95[i]! });
    }
    chart.data.datasets[0]!.data = avg;
    chart.data.datasets[1]!.data = p95;
    chart.options.scales!.x!.min = Math.max(xMin, clearedAt);
    chart.options.scales!.x!.max = xMax;
    const t0 = performance.now();
    chart.update('none');
    onRender?.(performance.now() - t0);
  }, [series, paused, clearedAt, xMin, xMax, showP95, onRender]);

  const lastY = series?.y.at(-1);
  const lastText = lastY === undefined ? '—' : format(lastY);
  return (
    <figure className={styles.chartCard}>
      <figcaption className={styles.chartTitle}>
        <span>
          {metric} <span className={styles.unit}>{unit}</span>
        </span>
        <span className={styles.last}>{lastText}</span>
      </figcaption>
      <div className={styles.canvasBox}>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`${metric} over time${lastY === undefined ? '' : `, latest ${lastText}`}`}
        />
      </div>
    </figure>
  );
}
