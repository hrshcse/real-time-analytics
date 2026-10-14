/**
 * Event contract shared by server and web (WBS 2.1).
 * All fields are required: the server always sends them, and optional fields would force
 * `undefined` checks into every consumer (aggregation, chart, grid).
 */

/** The six metric types from WBS 2.2. */
export const METRICS = ['cpu', 'memory', 'network', 'requests', 'latency', 'errors'] as const;
export type MetricType = (typeof METRICS)[number];

/** Event categories. The generator emits `system` and `application`; `user` is reserved. */
export const Categories = ['user', 'system', 'application'] as const;
export type CategoryType = (typeof Categories)[number];

export interface AnalyticsEvent {
  id: string;
  /** Milliseconds since epoch. */
  timestamp: number;
  metric: MetricType;
  value: number;
  category: CategoryType;
  /** Open set (host names), so left as string. */
  source: string;
}
