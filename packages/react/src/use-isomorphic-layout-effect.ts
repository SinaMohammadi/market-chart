import { useEffect, useLayoutEffect } from 'react';
import type { DependencyList, EffectCallback } from 'react';

/**
 * `useLayoutEffect` on the client, `useEffect` on the server (avoids the SSR warning). The environment is
 * checked when the hook runs, not when the module is imported, so importing touches no browser global.
 */
export function useIsomorphicLayoutEffect(effect: EffectCallback, deps?: DependencyList): void {
  // The branch is fixed for a given environment, so the hook order never changes between renders.
  (typeof document !== 'undefined' ? useLayoutEffect : useEffect)(effect, deps);
}
