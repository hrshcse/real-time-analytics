import { useEffect, useRef, useState } from 'react';
import type { ReadableStore } from '../ws/store';
import { leakedNodes } from './leakRegistry';

/**
 * Deliberate memory leaks for the Leak Lab (WBS 16.1), each with its fix side by side.
 * DEV ONLY: never rendered in production builds.
 *
 *  ┌ detached-dom ─ a module-level array keeps every unmounted subtree alive
 *  ├ subscription ─ subscribe in an effect, forget to unsubscribe → listener Set grows
 *  └ closure ───── window listener captures a big buffer, never removed
 *
 * Each leaky component pins ~1 MB per mount so the effect is obvious in a heap snapshot.
 */

export type LeakKind = 'detached-dom' | 'subscription' | 'closure';
const BIG = 1 << 17; // 131,072 doubles ≈ 1 MB

// ── 1. Detached DOM retention ───────────────────────────────────────────────
// Leaky: a "cache" of nodes that is never cleared (leakRegistry.ts). After unmount React removes
// the subtree from the document, but that array still references it → "Detached HTMLDivElement"
// in a heap snapshot, retained by `leakedNodes`.

function DetachedDom({ leaky }: { leaky: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    // Payload so each retained subtree is heavy enough to see.
    (node as HTMLDivElement & { payload?: Float64Array }).payload = new Float64Array(BIG);
    if (leaky) leakedNodes.push(node);
    // Fixed: nothing global holds the node, so unmount frees it.
  }, [leaky]);
  return (
    <div ref={ref} hidden>
      {Array.from({ length: 200 }, (_, i) => (
        <div key={i}>row {i}</div>
      ))}
    </div>
  );
}

// ── 2. Subscription leak ────────────────────────────────────────────────────
function Subscription({ leaky, store }: { leaky: boolean; store: ReadableStore<unknown> }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const buffer = new Float64Array(BIG); // captured by the listener below
    const unsubscribe = store.subscribe(() => setTick(buffer.length));
    if (leaky) return; // BUG: no cleanup → listener (and buffer) live as long as the store
    return unsubscribe; // FIX
  }, [leaky, store]);
  return null;
}

// ── 3. Closure retaining large data ─────────────────────────────────────────
function Closure({ leaky }: { leaky: boolean }) {
  useEffect(() => {
    const big = new Float64Array(BIG);
    const onResize = () => big.fill(window.innerWidth); // the closure keeps `big` alive
    window.addEventListener('resize', onResize);
    if (leaky) return; // BUG: the window holds onResize → onResize holds `big`
    return () => window.removeEventListener('resize', onResize); // FIX
  }, [leaky]);
  return null;
}

export function LeakSubject({
  kind,
  leaky,
  store,
}: {
  kind: LeakKind;
  leaky: boolean;
  store: ReadableStore<unknown>;
}) {
  if (kind === 'detached-dom') return <DetachedDom leaky={leaky} />;
  if (kind === 'subscription') return <Subscription leaky={leaky} store={store} />;
  return <Closure leaky={leaky} />;
}
