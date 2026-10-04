/**
 * Impure hash-routing hook — the bridge between the pure route registry
 * (`../routing/routes`) and the browser `window.location.hash` / `hashchange` event.
 *
 * This is deliberately IMPURE (it reads `window.location`, subscribes to `hashchange`, and
 * mutates `window.location.hash`) so it lives under `components/`, never `pure/`. The pure
 * URL↔tab mapping it delegates to is the property-tested part; this hook only wires that
 * mapping to React state and the live history (Req 1.6, 16.1).
 */

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_TAB, hashForTab, tabFromHash, type TabId } from "../routing/routes";

/** Read the current `location.hash`, tolerating non-browser (test/SSR) contexts. */
function currentHash(): string {
  if (typeof window === "undefined" || !window.location) {
    return "";
  }
  return window.location.hash;
}

/**
 * Subscribe to the URL hash and expose the resolved active {@link TabId} plus a setter.
 *
 * - Initial value resolves from the loaded URL so a cold deep-load (`/#/gate`) opens the
 *   right tab after the catch-all SPA fallback serves `index.html` (Req 1.6).
 * - `setTab` writes the canonical `#/<id>` hash; because navigation is hash-only it never
 *   triggers a document request, and the resulting `hashchange` flows back through the
 *   same subscription so the active tab stays the single source of truth.
 * - An unknown/empty hash resolves to {@link DEFAULT_TAB} rather than a blank view.
 */
export function useRoute(): { tab: TabId; setTab: (tab: TabId) => void } {
  const [tab, setTabState] = useState<TabId>(() => tabFromHash(currentHash()));

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const onHashChange = (): void => {
      setTabState(tabFromHash(currentHash()));
    };
    window.addEventListener("hashchange", onHashChange);
    // Reconcile once on mount in case the hash changed between render and effect.
    onHashChange();
    return () => {
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  const setTab = useCallback((next: TabId) => {
    if (typeof window !== "undefined" && window.location) {
      // Writing the hash fires `hashchange`, which updates the state above.
      window.location.hash = hashForTab(next);
    } else {
      setTabState(next);
    }
  }, []);

  // Ensure the URL carries a canonical hash on first mount so refresh/share links are
  // stable (an empty hash becomes `#/setups`). This is a no-op once a valid hash exists.
  useEffect(() => {
    if (typeof window === "undefined" || !window.location) {
      return;
    }
    if (tabFromHash(window.location.hash) === DEFAULT_TAB && window.location.hash === "") {
      window.location.hash = hashForTab(DEFAULT_TAB);
    }
  }, []);

  return { tab, setTab };
}
