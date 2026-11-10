// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { shapeEventFlag } from "../pure/shapeEventFlag";
import { EventFlagBanner } from "./EventFlagBanner";

afterEach(cleanup);

describe("EventFlagBanner", () => {
  it("shows the event and the caution wording", () => {
    const vm = shapeEventFlag(
      { decisionDate: "2026-12-09", calendarCovers: true, events: [{ kind: "FOMC", label: "US Federal Reserve rate decision", basis: "official" }] },
      "2026-12-09",
      true,
    );
    render(<EventFlagBanner vm={vm} />);
    const banner = screen.getByTestId("event-flag-banner");
    expect(banner.textContent).toContain("High-impact event today: US Federal Reserve rate decision");
    expect(banner.textContent).toMatch(/not a signal/i);
  });

  it("renders nothing without a view model", () => {
    render(<EventFlagBanner vm={null} />);
    expect(screen.queryByTestId("event-flag-banner")).toBeNull();
  });
});
