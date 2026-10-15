/**
 * The "cache" the detached-DOM leak writes into. Module-level on purpose: it outlives every
 * component, which is exactly what makes it a leak. Separate file so leaks.tsx exports only
 * components (React Fast Refresh).
 */
export const leakedNodes: HTMLElement[] = [];

/** Release everything the leaky variant pinned (the lab's "Reset" — not a fix). */
export function releaseLeaks() {
  leakedNodes.length = 0;
}

export function leakedNodeCount() {
  return leakedNodes.length;
}
