import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fakeConnection } from '../test/fakeConnection';
import { DEFAULT_VIEW, type ChartView } from '../workers/chart';
import { ChartPanel } from './ChartPanel';

function setup(view: ChartView = DEFAULT_VIEW) {
  const { connection } = fakeConnection();
  const changes: ChartView[] = [];
  render(<ChartPanel connection={connection} view={view} onViewChange={(v) => changes.push(v)} />);
  return { connection, changes };
}

describe('ChartPanel (WBS 7, 18.2)', () => {
  it('tells the worker which view to build, and stops on unmount', () => {
    const { connection } = fakeConnection();
    const { unmount } = render(
      <ChartPanel connection={connection} view={DEFAULT_VIEW} onViewChange={() => {}} />,
    );
    expect(connection.setView).toHaveBeenCalledWith(DEFAULT_VIEW);
    unmount();
    expect(connection.setView).toHaveBeenLastCalledWith(null);
  });

  it('pause / resume toggles the button state and the paused notice', () => {
    setup();
    const pause = screen.getByRole('button', { name: 'Pause chart' });
    fireEvent.click(pause);
    expect(screen.getByRole('button', { name: 'Resume chart' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText(/Paused — stream continues/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resume chart' }));
    expect(screen.queryByText(/Paused — stream continues/)).toBeNull();
  });

  it('metric toggles change the view (keeping metric order)', () => {
    const { changes } = setup({ ...DEFAULT_VIEW, metrics: ['cpu', 'latency'] });
    fireEvent.click(screen.getByLabelText('memory'));
    expect(changes.at(-1)?.metrics).toEqual(['cpu', 'memory', 'latency']);
    fireEvent.click(screen.getByLabelText('cpu'));
    expect(changes.at(-1)?.metrics).toEqual(['latency']);
  });

  it('time range, resolution and downsampling controls update the view', () => {
    const { changes } = setup();
    fireEvent.click(screen.getByRole('radio', { name: '15m' }));
    expect(changes.at(-1)?.rangeMs).toBe(900_000);
    fireEvent.change(screen.getByLabelText('Downsampling'), { target: { value: 'nth' } });
    expect(changes.at(-1)?.algorithm).toBe('nth');
    fireEvent.change(screen.getByLabelText('Resolution'), { target: { value: 'raw' } });
    expect(changes.at(-1)?.resolution).toBe('raw');
  });

  it('shows one chart per selected metric, or a hint when none', () => {
    const { connection } = fakeConnection();
    const { rerender } = render(
      <ChartPanel
        connection={connection}
        view={{ ...DEFAULT_VIEW, metrics: ['cpu', 'errors'] }}
        onViewChange={() => {}}
      />,
    );
    expect(screen.getAllByRole('img')).toHaveLength(2);
    rerender(
      <ChartPanel
        connection={connection}
        view={{ ...DEFAULT_VIEW, metrics: [] }}
        onViewChange={() => {}}
      />,
    );
    expect(screen.getByText('Select at least one metric.')).toBeInTheDocument();
  });
});
