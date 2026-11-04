/**
 * Single source of truth for the generic "no signal / no data" copy used by the
 * single-window dashboard (Req 3.5, 3.6, 4.8, 9.6).
 *
 * OPEN ITEM: the exact wording is to be confirmed by the operator. The strings below are
 * neutral placeholders. Change them HERE ONLY; never hard-code this wording elsewhere.
 *
 * These are deliberately distinct from the `NOT_ACTIONABLE` ("\u2014") marker in
 * `./format` and from the "un-validated" marker, so an unavailable value can never be
 * mistaken for a missing pip boundary or an un-validated number.
 *
 * Pure: constants only. No fetch, DOM, clock, or backend imports.
 */

/** Generic explicit unavailable / no-signal marker text. */
export const NO_SIGNAL_TEXT = "No signal" as const;

/** Short label for the banner when a pair did not fire. */
export const PAIR_DID_NOT_FIRE_LABEL = "No signal \u2013 pair did not fire" as const;
