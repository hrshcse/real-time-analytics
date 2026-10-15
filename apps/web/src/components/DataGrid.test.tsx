import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AnalyticsEvent } from '@rta/shared';
import type { GridPage } from '../processing';
import type { Connection } from '../ws';
import { createStore } from '../ws/store';
import { DataGrid } from './DataGrid';

const row = (i: number): AnalyticsEvent => ({
  id: `e${i}`,
  timestamp: 1_700_000_000_000 + i,
  metric: 'cpu',
  value: i,
  category: 'system',
  source: 'api-01',
});

function setup(total = 100_000) {
  const grid = createStore<GridPage | null>(null);
  const queryGrid = vi.fn();
  const connection = { grid, queryGrid } as unknown as Connection;
  render(<DataGrid connection={connection} />);
  act(() =>
    grid.set({
      total,
      offset: 0,
      rows: Array.from({ length: 70 }, (_, i) => row(i)),
      queryMs: 3,
      stored: total,
    }),
  );
  return { grid, queryGrid };
}

describe('DataGrid', () => {
  it('renders a constant number of DOM rows for 100K results (virtualized)', () => {
    setup(100_000);
    const grid = screen.getByRole('grid');
    expect(grid).toHaveAttribute('aria-rowcount', '100001');
    // header + viewport rows + overscan, never 100K
    expect(screen.getAllByRole('row').length).toBeLessThan(30);
  });

  it('asks the worker for a page and re-queries with a new sort on header click', () => {
    const { queryGrid } = setup();
    expect(queryGrid).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: { key: 'timestamp', dir: 'desc' }, offset: 0 }),
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: /Value/ }));
    expect(queryGrid).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: { key: 'value', dir: 'asc' } }),
      true,
    );
    expect(screen.getByRole('columnheader', { name: /Value/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  });

  it('keyboard: ArrowDown moves focus, Space selects', () => {
    setup();
    const grid = screen.getByRole('grid');
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: ' ' });
    expect(grid).toHaveAttribute('aria-activedescendant', 'row-1');
    expect(document.getElementById('row-1')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/1 selected/)).toBeInTheDocument();
  });

  it('Freeze sends live = false', () => {
    const { queryGrid } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Freeze' }));
    expect(queryGrid).toHaveBeenLastCalledWith(expect.anything(), false);
  });

  it('hides a column from the Columns menu', () => {
    setup();
    expect(screen.getByRole('columnheader', { name: /Source/ })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Source'));
    expect(screen.queryByRole('columnheader', { name: /Source/ })).toBeNull();
  });
});
