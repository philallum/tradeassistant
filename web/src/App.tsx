/**
 * Application root.
 *
 * Wraps the app shell in the single {@link SelectionProvider} so the Pair_Selector and
 * Decision_Date selections are the single cross-tab source of truth, initialized from (and
 * mirrored to) the URL query for deep-linking (Req 1.6, 8.6, 16.4). The shell itself —
 * header selectors, bottom tab bar, refresh + last-updated, and client-side routing — is
 * assembled in {@link AppShell} (task 9.1); the per-tab content lands in tasks 9.2–9.6.
 */

import { AppShell } from "./components/AppShell";
import { SelectionProvider } from "./state/selection";

export function App(): JSX.Element {
  return (
    <SelectionProvider>
      <AppShell />
    </SelectionProvider>
  );
}
