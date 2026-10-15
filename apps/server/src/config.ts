import 'dotenv/config';

function num(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Invalid ${name}="${raw}" (expected a number between ${min} and ${max})`);
  }
  return value;
}

export const config = {
  port: num('PORT', 8080, 1, 65535),
  defaultRate: num('DEFAULT_RATE', 1000, 0, 1_000_000),
  maxRate: num('MAX_RATE', 100_000, 1, 1_000_000),
  tickMs: num('TICK_MS', 50, 5, 1000),
  heartbeatMs: num('HEARTBEAT_MS', 5000, 500, 60_000),
  maxBufferedBytes: num('MAX_BUFFERED_BYTES', 8 * 1024 * 1024, 1024, 1024 * 1024 * 1024),
  badEventPct: num('BAD_EVENT_PCT', 0, 0, 100),
  badFramePct: num('BAD_FRAME_PCT', 0, 0, 100),
  /**
   * Auth PLACEHOLDER (WBS 20): if set, clients must offer the WebSocket subprotocol
   * `token.<AUTH_TOKEN>`; otherwise they're closed with 4401. Not production auth (see SECURITY.md).
   */
  authToken: process.env.AUTH_TOKEN || null,
  /** Control messages allowed per connection per second (token bucket). */
  controlRatePerSec: num('CONTROL_RATE_PER_SEC', 10, 1, 1000),
  /** Simultaneous connections allowed from one IP address. */
  maxConnectionsPerIp: num('MAX_CONNECTIONS_PER_IP', 20, 1, 10_000),
  /** Browser origins allowed to connect. "*" allows any origin (dev only). */
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
} as const;

export type Config = typeof config;
