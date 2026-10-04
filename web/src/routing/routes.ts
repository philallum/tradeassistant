/**
 * Pure client-side routing for the five Category_Tabs (Req 16.1, 16.2).
 *
 * The SPA is a single Firebase-hosted bundle whose catch-all `**` rewrite returns
 * `index.html` for every path (Req 1.6, task 10.1), so client-side routing MUST resolve a
 * route from the loaded URL rather than relying on the hosting layer. This module holds the
 * fixed tab registry and the *pure* URL ↔ tab mapping; the impure history/`window` wiring
 * lives in the component layer (`components/useRoute.ts`).
 *
 * Routing uses the URL **hash** (`#/setups`, `#/pattern-outcomes`, …). The hash is chosen
 * deliberately over the path:
 *   - A hash change never triggers a document request, so there is no dependency on a
 *     perfectly-configured SPA rewrite for in-app navigation — the catch-all `**` →
 *     `index.html` fallback (Req 1.6) still guarantees a deep link like
 *     `/#/gate?pair=EURUSD` resolves to the app on a cold load.
 *   - It composes cleanly with the existing `selection` store, which owns the `?pair`/
 *     `?date` *query* string; the hash carries the tab, the query carries the selections,
 *     and the two never collide.
 *
 * This module is PURE: it performs no `fetch`, touches no DOM, reads no clock, and imports
 * nothing from the deterministic core (`src/`). Every function is a deterministic function
 * of its arguments alone, so the route mapping is exhaustively property-testable in the
 * `web/` vitest + fast-check toolchain (Req 19 purity spirit).
 */

/** The five Category_Tab identifiers, in display order (Req 16.2, design component tree). */
export const TAB_IDS = [
  "setups",
  "pattern-outcomes",
  "gate",
  "ai",
  "third-party",
] as const;

/** One of the five Category_Tab identifiers. */
export type TabId = (typeof TAB_IDS)[number];

/** The default tab shown when the URL carries no (or an unknown) tab hash. */
export const DEFAULT_TAB: TabId = "setups";

/** Static metadata for one Category_Tab: its id and the human label shown in the tab bar. */
export interface TabDef {
  /** Stable route id used in the URL hash and as the React key. */
  readonly id: TabId;
  /** Human-readable label rendered in the bottom tab bar (Req 16.2). */
  readonly label: string;
}

/**
 * The fixed Category_Tab registry (Req 16.2). Labels match the design's component tree:
 * Setups, Pattern & Outcomes, Gate, AI, Third-party. Order is the tab-bar order.
 */
export const TABS: readonly TabDef[] = [
  { id: "setups", label: "Setups" },
  { id: "pattern-outcomes", label: "Pattern & Outcomes" },
  { id: "gate", label: "Gate" },
  { id: "ai", label: "AI" },
  { id: "third-party", label: "Third-party" },
] as const;

/** Narrowing guard: is `value` one of the five known {@link TabId}s? */
export function isTabId(value: string): value is TabId {
  return (TAB_IDS as readonly string[]).includes(value);
}

/**
 * Resolve a {@link TabId} from a raw URL hash (e.g. `"#/gate"`, `"gate"`, `""`, or a bogus
 * value). The leading `#` and `/` are tolerated and any trailing query/garbage after the
 * tab segment is ignored. An absent or unrecognized tab resolves to {@link DEFAULT_TAB}, so
 * a cold deep-load and the catch-all SPA fallback both land on a valid tab rather than a
 * blank view (Req 1.6, 16.1).
 */
export function tabFromHash(hash: string): TabId {
  // Strip a leading '#', then any leading '/'; take the first path-ish segment.
  const withoutHash = hash.startsWith("#") ? hash.slice(1) : hash;
  const withoutSlash = withoutHash.startsWith("/")
    ? withoutHash.slice(1)
    : withoutHash;
  // The tab is the segment up to the next '/', '?', or end — selection lives in the query.
  const segment = withoutSlash.split(/[/?#]/, 1)[0] ?? "";
  return isTabId(segment) ? segment : DEFAULT_TAB;
}

/**
 * Build the canonical URL hash for a tab (always `#/<id>`). This is the inverse of
 * {@link tabFromHash} over the valid tab ids: `tabFromHash(hashForTab(t)) === t` for every
 * {@link TabId} `t`.
 */
export function hashForTab(tab: TabId): string {
  return `#/${tab}`;
}
