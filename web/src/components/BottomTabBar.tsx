/**
 * Mobile-native bottom tab bar for the five Category_Tabs (Req 16.1, 16.2).
 *
 * Renders the fixed {@link TABS} registry as a fixed-to-bottom bar — the mobile-native
 * navigation pattern the design and Req 16.1 call out. Each tab is a `tab`-role button in a
 * `tablist`, so the bar is operable by keyboard and assistive technology with correct roles
 * and labels (Req 16.5); the full keyboard-interaction and a11y assertions land in task
 * 9.8. The active tab reflects the current route; activating a tab calls `onSelect`, which
 * the shell wires to the hash router.
 *
 * The bar holds no routing state itself — `active` and `onSelect` come from the shell's
 * {@link useRoute} hook, keeping the active tab a single source of truth.
 */

import { TABS, type TabId } from "../routing/routes";
import { theme } from "../theme/darkTheme";

export interface BottomTabBarProps {
  /** The currently active Category_Tab. */
  readonly active: TabId;
  /** Invoked with the chosen tab id when the viewer activates a tab. */
  readonly onSelect: (tab: TabId) => void;
}

export function BottomTabBar({ active, onSelect }: BottomTabBarProps): JSX.Element {
  return (
    <nav
      aria-label="Dashboard categories"
      style={{
        position: "sticky",
        bottom: 0,
        left: 0,
        right: 0,
        background: theme.colors.surface,
        borderTop: `1px solid ${theme.colors.border}`,
      }}
    >
      <div
        role="tablist"
        aria-label="Dashboard categories"
        aria-orientation="horizontal"
        style={{
          display: "flex",
          // Equal-width tabs that never force a horizontal scroll of primary content
          // (Req 1.3): the five tabs share the viewport width.
          justifyContent: "space-between",
        }}
      >
        {TABS.map((tab) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`tabpanel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(tab.id)}
              style={{
                flex: "1 1 0",
                minWidth: 0,
                appearance: "none",
                border: "none",
                cursor: "pointer",
                background: "transparent",
                color: selected ? theme.colors.accent : theme.colors.textSecondary,
                borderTop: `2px solid ${selected ? theme.colors.accent : "transparent"}`,
                padding: `${theme.spacing.sm}px ${theme.spacing.xs}px`,
                minHeight: 56, // comfortable mobile tap target (Req 18.5)
                fontSize: 11,
                fontWeight: selected ? 600 : 500,
                lineHeight: 1.2,
                textAlign: "center",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
