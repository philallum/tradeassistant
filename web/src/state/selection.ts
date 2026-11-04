/**
 * Selection store — the single source of truth for the two cross-view selections.
 *
 * The dashboard has exactly two selections: the active {@link Pair} (one of the five
 * supported pairs, default EURUSD) and the Historical_Browse Decision_Date. Both live in ONE
 * plain React context and are mirrored into the URL query string so a direct load of a deep
 * link restores the same view (Req 1.6).
 *
 * There is no cross-pair "All pairs" selection: the single-window view always shows exactly
 * one pair, and the All_Pairs_Strip is the only pair navigator. A legacy `?pair=ALL` (or any
 * unsupported value) in an old bookmark simply parses to the default pair.
 *
 * It is deliberately NOT a pure module (it reads `window.location`, pushes history, and
 * owns React state), so it lives under `src/state/` rather than `src/pure/`. It imports
 * only the wire-format pair constants from `../api/types` and nothing from the core
 * `src/` tree (Req 20.2).
 *
 * URL contract (query string, both keys optional on read):
 *   ?pair=EURUSD|GBPUSD|USDJPY|USDCHF|USDCAD   a specific pair; absent/invalid => EURUSD
 *   ?date=YYYY-MM-DD                           the browsed Decision_Date; absent => latest (null)
 *
 * On write the pair is always included (a concrete pair is always selected); a `null` date
 * is omitted, which keeps deep links clean.
 */

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { PropsWithChildren } from "react";
import { isPair, type Pair } from "../api/types";
import { DEFAULT_WINDOW_PAIR } from "../pure/resolveWindowSelection";

/** The pair shown when none (or an unsupported one) is selected. */
export const DEFAULT_PAIR: Pair = DEFAULT_WINDOW_PAIR;

/** A Decision_Date selection, or `null` meaning "no explicit choice — use the latest". */
export type DateSelection = string | null;

/** The immutable snapshot of both selections carried on the context. */
export interface SelectionState {
  /** The active pair; defaults to {@link DEFAULT_PAIR}. */
  readonly pair: Pair;
  /**
   * The browsed Decision_Date (`YYYY-MM-DD`), or `null` when no explicit date is chosen.
   * `null` is the signal for consumers to fall back to the Latest_Decision_Date.
   */
  readonly date: DateSelection;
}

/** The full context value: the current selection plus the two update functions. */
export interface SelectionContextValue extends SelectionState {
  /** Set the active pair. */
  readonly setPair: (pair: Pair) => void;
  /** Set the browsed Decision_Date, or `null` to fall back to the latest. */
  readonly setDate: (date: DateSelection) => void;
}

/** URL query key for the pair selection. */
const PAIR_PARAM = "pair";
/** URL query key for the Decision_Date selection. */
const DATE_PARAM = "date";

/** ISO `YYYY-MM-DD` shape used to validate a `date` query param before accepting it. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a selection out of a raw query string (the leading `?` is optional). Invalid or
 * absent values fall back to the defaults: an unknown/missing pair becomes the default pair and
 * a missing/malformed date becomes `null`. Pure and side-effect free so it is unit-testable
 * without a DOM.
 */
export function parseSelectionFromSearch(search: string): SelectionState {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );

  const rawPair = params.get(PAIR_PARAM);
  const pair: Pair = rawPair !== null && isPair(rawPair) ? rawPair : DEFAULT_PAIR;

  const rawDate = params.get(DATE_PARAM);
  const date: DateSelection =
    rawDate !== null && ISO_DATE.test(rawDate) ? rawDate : null;

  return { pair, date };
}

/**
 * Serialize a selection into a query string (no leading `?`). The pair is always written; a
 * `null` date writes no `date` key so the URL stays clean. Pure and side-effect free.
 */
export function selectionToSearch(state: SelectionState): string {
  const params = new URLSearchParams();
  params.set(PAIR_PARAM, state.pair);
  if (state.date !== null) {
    params.set(DATE_PARAM, state.date);
  }
  return params.toString();
}

const SelectionContext = createContext<SelectionContextValue | null>(null);

/** Read the current location's query string, tolerating non-browser (SSR/test) contexts. */
function currentSearch(): string {
  if (typeof window === "undefined" || !window.location) {
    return "";
  }
  return window.location.search;
}

/**
 * Replace the current URL's query string with `search` WITHOUT adding a history entry, so
 * selection changes do not pollute the back button. Path and hash are preserved. A no-op
 * outside the browser.
 */
function writeSearch(search: string): void {
  if (typeof window === "undefined" || !window.history || !window.location) {
    return;
  }
  const { pathname, hash } = window.location;
  const nextUrl = `${pathname}${search ? `?${search}` : ""}${hash}`;
  window.history.replaceState(window.history.state, "", nextUrl);
}

/**
 * Provider for the selection store. Initializes from the current URL (deep-link restore,
 * Req 1.6), keeps both selections in a single piece of React state so they survive tab
 * switches (Req 8.6, 16.4), and mirrors every change back into the URL query (Req 1.6).
 *
 * `initialState` is an optional override intended for tests; in the app the provider reads
 * the live URL.
 */
export function SelectionProvider({
  children,
  initialState,
}: PropsWithChildren<{ initialState?: SelectionState }>): JSX.Element {
  const [state, setState] = useState<SelectionState>(
    () => initialState ?? parseSelectionFromSearch(currentSearch()),
  );

  // Mirror the selection into the URL query on every change (deep-linking, Req 1.6).
  useEffect(() => {
    writeSearch(selectionToSearch(state));
  }, [state]);

  const setPair = useCallback((pair: Pair) => {
    setState((prev) => (prev.pair === pair ? prev : { ...prev, pair }));
  }, []);

  const setDate = useCallback((date: DateSelection) => {
    setState((prev) => (prev.date === date ? prev : { ...prev, date }));
  }, []);

  const value = useMemo<SelectionContextValue>(
    () => ({ pair: state.pair, date: state.date, setPair, setDate }),
    [state.pair, state.date, setPair, setDate],
  );

  return createElement(SelectionContext.Provider, { value }, children);
}

/**
 * Read and update the shared selection. Must be called inside a {@link SelectionProvider};
 * throws otherwise so a missing provider surfaces loudly in development rather than
 * silently handing back defaults.
 */
export function useSelection(): SelectionContextValue {
  const value = useContext(SelectionContext);
  if (value === null) {
    throw new Error("useSelection must be used within a <SelectionProvider>");
  }
  return value;
}
