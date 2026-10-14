import { useEffect, useSyncExternalStore } from 'react';
import type { Connection, ConnectionSnapshot } from './connection';

/**
 * Connects on mount, disconnects on unmount, and re-renders only when the connection
 * publishes a new snapshot (status change, or at most every publishIntervalMs).
 *
 * In dev, StrictMode runs effect → cleanup → effect, so the server sees one short-lived
 * connection followed by the real one. That's expected; connection.ts ignores the first
 * socket's late events.
 */
export function useConnection(connection: Connection): ConnectionSnapshot {
  useEffect(() => {
    connection.connect();
    return () => connection.disconnect();
  }, [connection]);

  return useSyncExternalStore(connection.subscribe, connection.getSnapshot);
}
