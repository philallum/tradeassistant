/**
 * Impure media-query hook — reports whether a CSS media query currently matches.
 *
 * Used by the shell to decide the responsive form of the Pair_Selector (segmented control
 * on wide viewports, dropdown on narrow ones — Req 1.3, design "Selectors and
 * persistence"). It is IMPURE (reads `window.matchMedia` and subscribes to its change
 * event), so it lives under `components/`, not `pure/`. Outside the browser it falls back
 * to `false` so render still succeeds in test/SSR contexts.
 */

import { useEffect, useState } from "react";

/** Read the current match state for `query`, tolerating non-browser contexts. */
function matches(query: string): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(query).matches;
}

/**
 * Subscribe to a media query and return its current match state, re-rendering when it
 * changes. `query` is expected to be stable across renders (a module-level constant).
 */
export function useMediaQuery(query: string): boolean {
  const [isMatch, setIsMatch] = useState<boolean>(() => matches(query));

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mql = window.matchMedia(query);
    const onChange = (): void => setIsMatch(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => {
      mql.removeEventListener("change", onChange);
    };
  }, [query]);

  return isMatch;
}

/** Viewport width at/above which the Pair_Selector shows the segmented control. */
export const WIDE_VIEWPORT_QUERY = "(min-width: 640px)";
