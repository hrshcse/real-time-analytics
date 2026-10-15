import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore } from '../ws/store';
import { leakedNodeCount, releaseLeaks } from './leakRegistry';
import { LeakSubject } from './leaks';

afterEach(() => {
  releaseLeaks();
  vi.restoreAllMocks();
});

function cycle(times: number, el: () => React.ReactElement) {
  for (let i = 0; i < times; i++) {
    const { unmount } = render(el());
    act(() => unmount());
  }
}

describe('leak lab subjects', () => {
  it('subscription: leaky leaves one listener per mount; fixed leaves none', () => {
    const store = createStore<unknown>(null);
    cycle(10, () => <LeakSubject kind="subscription" leaky store={store} />);
    expect(store.listenerCount).toBe(10);
    const clean = createStore<unknown>(null);
    cycle(10, () => <LeakSubject kind="subscription" leaky={false} store={clean} />);
    expect(clean.listenerCount).toBe(0);
  });

  it('detached DOM: leaky pins every unmounted subtree; fixed pins none', () => {
    const store = createStore<unknown>(null);
    cycle(5, () => <LeakSubject kind="detached-dom" leaky store={store} />);
    expect(leakedNodeCount()).toBe(5);
    releaseLeaks();
    cycle(5, () => <LeakSubject kind="detached-dom" leaky={false} store={store} />);
    expect(leakedNodeCount()).toBe(0);
  });

  it('closure: leaky never removes its window listener; fixed does', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const store = createStore<unknown>(null);
    cycle(4, () => <LeakSubject kind="closure" leaky store={store} />);
    expect(add.mock.calls.filter((c) => c[0] === 'resize')).toHaveLength(4);
    expect(remove.mock.calls.filter((c) => c[0] === 'resize')).toHaveLength(0);
    add.mockClear();
    cycle(4, () => <LeakSubject kind="closure" leaky={false} store={store} />);
    expect(remove.mock.calls.filter((c) => c[0] === 'resize')).toHaveLength(4);
  });
});
