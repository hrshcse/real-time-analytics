import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadChartView, saveChartView } from './prefs';
import { DEFAULT_VIEW } from './workers/chart';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('chart view prefs', () => {
  it('round-trips a saved view', () => {
    const v = {
      ...DEFAULT_VIEW,
      rangeMs: 300_000,
      metrics: ['latency' as const],
      algorithm: 'nth' as const,
    };
    saveChartView(v);
    expect(loadChartView()).toEqual(v);
  });

  it('falls back to defaults for garbage or unknown values', () => {
    localStorage.setItem('rta.chartView.v1', '{not json');
    expect(loadChartView()).toEqual(DEFAULT_VIEW);
    localStorage.setItem(
      'rta.chartView.v1',
      JSON.stringify({ rangeMs: 7, metrics: ['disk', 'cpu'], maxPoints: 5 }),
    );
    expect(loadChartView()).toMatchObject({ rangeMs: 60_000, metrics: ['cpu'], maxPoints: 300 });
  });

  it('survives blocked storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(loadChartView()).toEqual(DEFAULT_VIEW);
    expect(() => saveChartView(DEFAULT_VIEW)).not.toThrow();
  });
});
