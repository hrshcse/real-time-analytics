import type { AnalyticsEvent } from './events';

/**
 * Wire protocol over the WebSocket. Every frame is one JSON object with a `type`.
 * See docs/PROTOCOL.md for the full description.
 */

// ---------- server -> client ----------

export interface HelloMessage {
  type: 'hello';
  serverTime: number;
  rate: number;
  tickMs: number;
  running: boolean;
}

export interface BatchMessage {
  type: 'batch';
  /** Increments by 1 per batch, per connection. A gap means frames were dropped. */
  seq: number;
  /** Server clock (ms since epoch) when the frame was sent. */
  sentAt: number;
  /** Total frames the server dropped for this connection because the client fell behind. */
  serverDropped: number;
  events: AnalyticsEvent[];
}

export interface StatusMessage {
  type: 'status';
  running: boolean;
  /** Current effective rate (events/sec), including an active burst. */
  rate: number;
  /** Base rate to return to after a burst. */
  baseRate: number;
  /** Set while a burst is active. */
  burstEndsAt: number | null;
}

export interface HeartbeatMessage {
  type: 'heartbeat';
  serverTime: number;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export type ServerMessage =
  HelloMessage | BatchMessage | StatusMessage | HeartbeatMessage | ErrorMessage;

// ---------- client -> server ----------

export type ClientMessage =
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'setRate'; rate: number }
  | { type: 'burst'; rate: number; durationMs: number };
