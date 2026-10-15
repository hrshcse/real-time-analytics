import type { MetricType } from '@rta/shared';

export const UNIT: Record<MetricType, string> = {
  cpu: '%',
  memory: '%',
  network: 'KB/s',
  requests: 'req/s',
  latency: 'ms',
  errors: 'rate',
};

/** Validated with the dataviz palette checker against the dark surface (all checks pass). */
export const SERIES_COLORS = { avg: '#3987e5', p95: '#d95926' } as const;
