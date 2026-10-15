/**
 * Minimal external store for useSyncExternalStore. Separate stores (stats, chart, grid) mean a
 * chart update re-renders only the chart, not the whole dashboard.
 */
export interface ReadableStore<T> {
  get(): T;
  subscribe(listener: () => void): () => void;
  /** Live subscriptions: a number that only grows across mount/unmount cycles is a leak (WBS 16). */
  readonly listenerCount: number;
}

export function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      if (Object.is(next, value)) return;
      value = next;
      for (const l of listeners) l();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}
