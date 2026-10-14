import { METRICS, type AnalyticsEvent, type CategoryType, type MetricType } from '@rta/shared';

/** Value range and step size for a bounded random walk per metric. */
const PROFILE: Record<MetricType, { min: number; max: number; step: number; start: number }> = {
  cpu: { min: 0, max: 100, step: 3, start: 35 }, // %
  memory: { min: 0, max: 100, step: 0.5, start: 55 }, // %
  network: { min: 0, max: 10_000, step: 250, start: 2_000 }, // KB/s
  requests: { min: 0, max: 5_000, step: 80, start: 800 }, // req/s
  latency: { min: 1, max: 2_000, step: 15, start: 40 }, // ms
  errors: { min: 0, max: 1, step: 1, start: 0 }, // 0 = ok, 1 = error
};

const CATEGORY: Record<MetricType, CategoryType> = {
  cpu: 'system',
  memory: 'system',
  network: 'system',
  requests: 'application',
  latency: 'application',
  errors: 'application',
};

const SOURCES = ['api-01', 'api-02', 'api-03', 'worker-01', 'worker-02'] as const;

export interface GeneratorOptions {
  /** 0–100: percentage of events deliberately made invalid (for testing validation). */
  badEventPct?: number;
  /** Injectable RNG so tests are deterministic. */
  random?: () => number;
}

/**
 * Creates a stateful event factory. Each metric+source pair keeps its own random walk
 * so charts look like real signals rather than noise.
 */
export function createGenerator(options: GeneratorOptions = {}) {
  const random = options.random ?? Math.random;
  const badEventPct = options.badEventPct ?? 0;
  const walk = new Map<string, number>();
  let counter = 0;

  function nextValue(metric: MetricType, source: string): number {
    const p = PROFILE[metric];
    if (metric === 'errors') return random() < 0.02 ? 1 : 0; // ~2% error rate
    const key = `${metric}:${source}`;
    const prev = walk.get(key) ?? p.start;
    const next = Math.min(p.max, Math.max(p.min, prev + (random() * 2 - 1) * p.step));
    walk.set(key, next);
    return Math.round(next * 100) / 100;
  }

  function makeBad(event: AnalyticsEvent): unknown {
    const broken: Record<string, unknown> = { ...event };
    switch (Math.floor(random() * 4)) {
      case 0:
        delete broken.timestamp;
        break;
      case 1:
        broken.value = 'NaN';
        break;
      case 2:
        broken.metric = 'unknown-metric';
        break;
      default:
        broken.id = null;
    }
    return broken;
  }

  /**
   * Produce `count` events spread evenly across [startTs, startTs + spanMs).
   * Returned as `unknown[]` because bad events (if enabled) are not valid AnalyticsEvents.
   */
  function generate(count: number, startTs: number, spanMs: number): unknown[] {
    const out: unknown[] = new Array(count);
    const stepMs = count > 0 ? spanMs / count : 0;
    for (let i = 0; i < count; i++) {
      const metric = METRICS[Math.floor(random() * METRICS.length)] as MetricType;
      const source = SOURCES[Math.floor(random() * SOURCES.length)] as string;
      const event: AnalyticsEvent = {
        id: `e${(counter++).toString(36)}`,
        timestamp: Math.floor(startTs + i * stepMs),
        metric,
        value: nextValue(metric, source),
        category: CATEGORY[metric],
        source,
      };
      out[i] = badEventPct > 0 && random() * 100 < badEventPct ? makeBad(event) : event;
    }
    return out;
  }

  return { generate };
}

/**
 * Converts elapsed time into a whole number of events while carrying the fractional
 * remainder, so 1,000/sec at a 50 ms tick yields exactly 50 per tick on average and
 * low rates (e.g. 3/sec) still emit correctly over time.
 */
export function createRateAccumulator() {
  let carry = 0;
  return {
    take(rate: number, elapsedMs: number): number {
      const owed = carry + (rate * elapsedMs) / 1000;
      const count = Math.floor(owed);
      carry = owed - count;
      return count;
    },
    reset() {
      carry = 0;
    },
  };
}
