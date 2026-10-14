import type { ServerMessage } from '@rta/shared';

/**
 * Safe parse of one WebSocket frame. Never throws; returns null for anything that isn't a
 * well-formed ServerMessage. DOM-free, so it runs on the main thread or in the worker.
 *
 * Checks only the fields consumers read. Events inside a batch are NOT validated here; that's
 * validateEvents' job (per event, with reasons).
 */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  if (typeof raw !== 'string') return null;
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof msg !== 'object' || msg === null) return null;
  const m = msg as Record<string, unknown>;

  switch (m.type) {
    case 'batch':
      return typeof m.seq === 'number' && Array.isArray(m.events)
        ? (m as unknown as ServerMessage)
        : null;
    case 'hello':
      return typeof m.rate === 'number' &&
        typeof m.tickMs === 'number' &&
        typeof m.running === 'boolean'
        ? (m as unknown as ServerMessage)
        : null;
    case 'status':
      return typeof m.rate === 'number' &&
        typeof m.baseRate === 'number' &&
        typeof m.running === 'boolean'
        ? (m as unknown as ServerMessage)
        : null;
    case 'heartbeat':
    case 'error':
      return m as unknown as ServerMessage;
    default:
      return null;
  }
}
