import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { METRICS, type AnalyticsEvent, type MetricType } from '@rta/shared';
import { useStore } from '../hooks/useStore';
import type { GridQuery, GridSortKey } from '../processing';
import type { Connection } from '../ws';
import styles from './grid.module.css';
import dash from './dashboard.module.css';

/**
 * Virtualized grid over the worker's last 100K events (WBS 9).
 *
 *   100,000 rows (worker)  ──query(offset, limit)──▶  page of ~70 rows  ──▶  ~20 DOM rows
 *   ┌──────────── scroll container (fixed height) ────────────┐
 *   │ spacer: height = total × ROW_HEIGHT  (gives the scrollbar)│
 *   │   rows absolutely positioned at index × ROW_HEIGHT        │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Sorting, filtering and search run in the worker; the main thread renders only what's visible,
 * so the DOM node count stays constant whatever the row count.
 */

export const ROW_HEIGHT = 28;
const VIEWPORT_ROWS = 15;
const OVERSCAN = 5; // rendered beyond the viewport, each side
const FETCH_MARGIN = 25; // rows fetched beyond the viewport, each side

interface Column {
  key: GridSortKey;
  label: string;
  width: number;
  align?: 'right';
  format: (e: AnalyticsEvent) => string;
}

const time = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
  hour12: false,
});
const num = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmt = new Intl.NumberFormat();
const ms = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

const COLUMNS: Column[] = [
  { key: 'timestamp', label: 'Time', width: 130, format: (e) => time.format(e.timestamp) },
  { key: 'metric', label: 'Metric', width: 110, format: (e) => e.metric },
  { key: 'value', label: 'Value', width: 110, align: 'right', format: (e) => num.format(e.value) },
  { key: 'category', label: 'Category', width: 120, format: (e) => e.category },
  { key: 'source', label: 'Source', width: 120, format: (e) => e.source },
  { key: 'id', label: 'ID', width: 140, format: (e) => e.id },
];

interface Props {
  connection: Connection;
}

export function DataGrid({ connection }: Props) {
  const page = useStore(connection.grid);
  const [sort, setSort] = useState<GridQuery['sort']>({ key: 'timestamp', dir: 'desc' });
  const [metric, setMetric] = useState<MetricType | 'all'>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [live, setLive] = useState(true);
  const [scrollTop, setScrollTop] = useState(0);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [focused, setFocused] = useState(0);
  const [widths, setWidths] = useState(() =>
    Object.fromEntries(COLUMNS.map((c) => [c.key, c.width])),
  );
  const [hidden, setHidden] = useState<ReadonlySet<GridSortKey>>(new Set(['category']));
  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);

  // A new filter/sort starts at the top. Called from the handlers that change them.
  const resetPosition = useCallback(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setScrollTop(0);
    setFocused(0);
  }, []);

  // Debounce search: one worker query per pause in typing, not per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      resetPosition();
    }, 200);
    return () => clearTimeout(t);
  }, [searchInput, resetPosition]);

  const total = page?.total ?? 0;
  const first = Math.floor(scrollTop / ROW_HEIGHT);
  const fetchOffset = Math.max(0, first - FETCH_MARGIN);
  // Snap the requested window so small scrolls don't send a query each pixel.
  const offset = Math.floor(fetchOffset / 10) * 10;
  const limit = VIEWPORT_ROWS + 2 * FETCH_MARGIN + 10;

  useEffect(() => {
    connection.queryGrid(
      { sort, metrics: metric === 'all' ? null : [metric], search, offset, limit },
      live,
    );
  }, [connection, sort, metric, search, offset, limit, live]);
  useEffect(() => () => connection.queryGrid(null, false), [connection]);

  const onScroll = () => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => setScrollTop(scrollRef.current?.scrollTop ?? 0));
  };
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const columns = useMemo(() => COLUMNS.filter((c) => !hidden.has(c.key)), [hidden]);
  const template = columns.map((c) => `${widths[c.key]}px`).join(' ');
  const rowAt = (i: number) =>
    page && i >= page.offset && i < page.offset + page.rows.length
      ? page.rows[i - page.offset]
      : undefined;

  const start = Math.max(0, first - OVERSCAN);
  const end = Math.min(total, first + VIEWPORT_ROWS + OVERSCAN);
  const visible: number[] = [];
  for (let i = start; i < end; i++) visible.push(i);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const sortBy = (key: GridSortKey) => {
    resetPosition();
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'timestamp' ? 'desc' : 'asc' },
    );
  };

  // Keyboard: arrows / Page / Home / End move focus; Space toggles selection (WBS 19).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = {
      ArrowDown: 1,
      ArrowUp: -1,
      PageDown: VIEWPORT_ROWS,
      PageUp: -VIEWPORT_ROWS,
      Home: -Infinity,
      End: Infinity,
    };
    if (e.key === ' ') {
      const row = rowAt(focused);
      if (row) toggleSelect(row.id);
      e.preventDefault();
      return;
    }
    const delta = moves[e.key];
    if (delta === undefined || total === 0) return;
    e.preventDefault();
    const next = Math.max(0, Math.min(total - 1, focused + delta));
    setFocused(next);
    const el = scrollRef.current;
    if (!el) return;
    const top = next * ROW_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_HEIGHT > el.scrollTop + VIEWPORT_ROWS * ROW_HEIGHT)
      el.scrollTop = top - (VIEWPORT_ROWS - 1) * ROW_HEIGHT;
  };

  // Column resize via pointer capture on the header handle.
  const startResize = (key: GridSortKey) => (e: PointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widths[key]!;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const move = (ev: globalThis.PointerEvent) =>
      setWidths((w) => ({ ...w, [key]: Math.max(60, startW + ev.clientX - startX) }));
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  return (
    <section aria-label="Events" className={styles.section}>
      <div className={styles.toolbar}>
        <h2 className={dash.sectionTitle}>Events</h2>
        <div className={styles.controls}>
          <label className={dash.label} htmlFor="grid-metric">
            Metric
          </label>
          <select
            id="grid-metric"
            className={dash.select}
            value={metric}
            onChange={(e) => {
              resetPosition();
              setMetric(e.target.value as MetricType | 'all');
            }}
          >
            <option value="all">All</option>
            {METRICS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <input
            type="search"
            className={dash.select}
            placeholder="Search id, source…"
            aria-label="Search events"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <button
            type="button"
            className={dash.button}
            aria-pressed={!live}
            onClick={() => setLive((l) => !l)}
          >
            {live ? 'Freeze' : 'Go live'}
          </button>
          <details className={styles.columnsMenu}>
            <summary className={dash.button}>Columns</summary>
            <div className={styles.columnsList}>
              {COLUMNS.map((c) => (
                <label key={c.key} className={styles.columnOption}>
                  <input
                    type="checkbox"
                    checked={!hidden.has(c.key)}
                    disabled={!hidden.has(c.key) && columns.length === 1}
                    onChange={() =>
                      setHidden((h) => {
                        const next = new Set(h);
                        if (next.has(c.key)) next.delete(c.key);
                        else next.add(c.key);
                        return next;
                      })
                    }
                  />{' '}
                  {c.label}
                </label>
              ))}
            </div>
          </details>
        </div>
      </div>

      <p className={styles.meta}>
        {fmt.format(total)} rows
        {page && total !== page.stored ? ` of ${fmt.format(page.stored)}` : ''} · query{' '}
        {ms.format(page?.queryMs ?? 0)} ms (worker)
        {selected.size > 0 && (
          <>
            {' '}
            · {fmt.format(selected.size)} selected{' '}
            <button type="button" className={styles.linkish} onClick={() => setSelected(new Set())}>
              clear
            </button>
          </>
        )}
        {!live && <strong className={styles.frozen}> · frozen</strong>}
      </p>

      <div
        ref={scrollRef}
        className={styles.viewport}
        style={{ height: (VIEWPORT_ROWS + 1) * ROW_HEIGHT }}
        role="grid"
        aria-label="Events"
        aria-rowcount={total + 1}
        aria-colcount={columns.length}
        aria-multiselectable="true"
        tabIndex={0}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        aria-activedescendant={total > 0 ? `row-${focused}` : undefined}
      >
        <div
          className={styles.header}
          role="row"
          aria-rowindex={1}
          style={{ gridTemplateColumns: template }}
        >
          {columns.map((c) => (
            <div
              key={c.key}
              role="columnheader"
              aria-sort={
                sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
              }
              className={styles.headerCell}
              data-align={c.align}
            >
              <button type="button" className={styles.sortButton} onClick={() => sortBy(c.key)}>
                {c.label}
                <span aria-hidden="true" className={styles.sortIcon}>
                  {sort.key === c.key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                </span>
              </button>
              <span
                className={styles.resizer}
                role="separator"
                aria-orientation="vertical"
                aria-label={`Resize ${c.label} column`}
                onPointerDown={startResize(c.key)}
              />
            </div>
          ))}
        </div>

        <div className={styles.spacer} style={{ height: total * ROW_HEIGHT }}>
          {visible.map((i) => {
            const row = rowAt(i);
            const isSelected = row ? selected.has(row.id) : false;
            return (
              <div
                key={i}
                id={`row-${i}`}
                role="row"
                aria-rowindex={i + 2}
                aria-selected={isSelected}
                className={styles.row}
                data-focused={i === focused || undefined}
                style={{ top: i * ROW_HEIGHT, gridTemplateColumns: template }}
                onClick={() => {
                  setFocused(i);
                  if (row) toggleSelect(row.id);
                }}
              >
                {columns.map((c) => (
                  <div key={c.key} role="gridcell" className={styles.cell} data-align={c.align}>
                    {row ? c.format(row) : <span className={styles.placeholder}>…</span>}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        {total === 0 && (
          <p className={styles.empty}>{page ? 'No events match.' : 'Waiting for events…'}</p>
        )}
      </div>
    </section>
  );
}
