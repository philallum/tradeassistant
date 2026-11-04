// @vitest-environment jsdom
//
// Single-window dashboard — Accordion / ContextDrawers DOM tests (task 2.3).
//
// Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.7, 7.8, 7.9, 12.4, 12.5

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { DailyNoteViewModel } from "../pure/shapeDailyNote";
import type { EvidenceVM } from "../pure/shapeEvidence";
import { Accordion } from "./Accordion";
import { ContextDrawers } from "./ContextDrawers";

afterEach(() => {
  cleanup();
});

const GENERATED: DailyNoteViewModel = {
  status: "generated",
  text: "Quiet session; EURUSD leads.",
  decisionDate: "2026-09-16",
};
const ABSENT: DailyNoteViewModel = { status: "absent", text: null, decisionDate: null };

const EVIDENCE: EvidenceVM = {
  pair: "EURUSD",
  horizon: 1,
  sampleCount: 12,
  upShare: 0.5,
  downShare: 0.4167,
};

function header(name: RegExp): HTMLElement {
  return screen.getByRole("button", { name });
}

describe("Accordion", () => {
  it("is collapsed by default and mounts no children (Req 7.2)", () => {
    render(
      <Accordion title="Drawer">
        <p>inner body</p>
      </Accordion>,
    );
    expect(header(/Drawer/).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("inner body")).toBeNull();
  });

  it("opens on defaultOpen", () => {
    render(
      <Accordion title="Drawer" defaultOpen>
        <p>inner body</p>
      </Accordion>,
    );
    expect(header(/Drawer/).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("inner body")).toBeTruthy();
  });

  it("links the header to its panel via aria-controls / aria-labelledby (Req 12.4)", () => {
    render(
      <Accordion title="Drawer">
        <p>inner body</p>
      </Accordion>,
    );
    const button = header(/Drawer/);
    const panel = document.getElementById(button.getAttribute("aria-controls") ?? "");
    expect(panel).not.toBeNull();
    expect(panel!.getAttribute("aria-labelledby")).toBe(button.id);
  });

  it("is a native button so Enter/Space activate it; toggles open and closed (Req 7.3, 12.5)", () => {
    render(
      <Accordion title="Drawer">
        <p>inner body</p>
      </Accordion>,
    );
    const button = header(/Drawer/);
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");

    // jsdom does not synthesise click from Enter/Space; model the browser's native
    // activation as a click after the key event (same convention as ConfluencePanel tests).
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("inner body")).toBeTruthy();

    fireEvent.keyDown(button, { key: " " });
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("inner body")).toBeNull();
  });
});

describe("ContextDrawers", () => {
  it("renders exactly two drawers, both collapsed by default (Req 7.1, 7.2)", () => {
    render(<ContextDrawers note={GENERATED} evidence={EVIDENCE} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(header(/Daily AI note/).getAttribute("aria-expanded")).toBe("false");
    expect(header(/Historical evidence/).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(/Quiet session/)).toBeNull();
    expect(screen.queryByTestId("evidence-body")).toBeNull();
  });

  it("toggles each drawer independently (Req 7.3, 12.4)", () => {
    render(<ContextDrawers note={GENERATED} evidence={EVIDENCE} />);
    const note = header(/Daily AI note/);
    const evidence = header(/Historical evidence/);

    fireEvent.click(note);
    expect(note.getAttribute("aria-expanded")).toBe("true");
    expect(evidence.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("Quiet session; EURUSD leads.")).toBeTruthy();
    expect(screen.queryByTestId("evidence-body")).toBeNull();

    fireEvent.click(evidence);
    expect(note.getAttribute("aria-expanded")).toBe("true");
    expect(evidence.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("evidence-body")).toBeTruthy();

    fireEvent.click(note);
    expect(note.getAttribute("aria-expanded")).toBe("false");
    expect(evidence.getAttribute("aria-expanded")).toBe("true");
  });

  it("toggles via keyboard activation (Req 7.4, 12.5)", () => {
    render(<ContextDrawers note={GENERATED} evidence={EVIDENCE} />);
    const note = header(/Daily AI note/);
    fireEvent.keyDown(note, { key: "Enter" });
    fireEvent.click(note);
    expect(note.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(note, { key: " " });
    fireEvent.click(note);
    expect(note.getAttribute("aria-expanded")).toBe("false");
  });

  it("leads with the selected pair's own note and labels the whole-day overview separately", () => {
    const pairNote: DailyNoteViewModel = {
      status: "generated",
      text: "USDCAD follows the uptrend.",
      decisionDate: "2026-09-16",
    };
    render(<ContextDrawers note={GENERATED} pairNote={pairNote} pair="USDCAD" evidence={EVIDENCE} />);
    fireEvent.click(header(/Daily AI note/));
    expect(screen.getByTestId("pair-note-label").textContent).toBe("USDCAD");
    expect(screen.getByTestId("pair-note").textContent).toBe("USDCAD follows the uptrend.");
    expect(screen.getByTestId("overview-note-label").textContent).toMatch(/All pairs/);
    // The overview text is still present, but after the pair's own note.
    expect(screen.getByText("Quiet session; EURUSD leads.")).toBeTruthy();
  });

  it("says so when the selected pair has no note of its own, and still shows the overview", () => {
    render(<ContextDrawers note={GENERATED} pairNote={ABSENT} pair="GBPUSD" evidence={EVIDENCE} />);
    fireEvent.click(header(/Daily AI note/));
    expect(screen.getByTestId("pair-note").textContent).toMatch(/No AI note for GBPUSD/);
    expect(screen.getByText("Quiet session; EURUSD leads.")).toBeTruthy();
  });

  it("labels the note advisory and non-scoring when expanded (Req 7.7)", () => {
    render(<ContextDrawers note={GENERATED} evidence={EVIDENCE} />);
    fireEvent.click(header(/Daily AI note/));
    expect(screen.getByRole("note").textContent).toMatch(/advisory and non-scoring/);
  });

  it("shows a placeholder when the note is unavailable or absent (Req 7.8)", () => {
    const unavailable: DailyNoteViewModel = {
      status: "unavailable",
      text: null,
      decisionDate: "2026-09-16",
    };
    for (const note of [unavailable, ABSENT]) {
      const { unmount } = render(<ContextDrawers note={note} evidence={EVIDENCE} />);
      fireEvent.click(header(/Daily AI note/));
      expect(screen.getByText("AI commentary is unavailable for this run.")).toBeTruthy();
      unmount();
    }
  });

  it("shows a placeholder when there is no evidence, header still activatable (Req 7.9)", () => {
    render(<ContextDrawers note={GENERATED} evidence={null} />);
    const evidence = header(/Historical evidence/);
    fireEvent.click(evidence);
    expect(evidence.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("No historical evidence is available for this pair.")).toBeTruthy();
  });

  it("renders the evidence base rate only inside the expanded drawer", () => {
    render(<ContextDrawers note={GENERATED} evidence={EVIDENCE} />);
    expect(screen.queryByText(/matured/)).toBeNull();
    fireEvent.click(header(/Historical evidence/));
    const body = screen.getByTestId("evidence-body");
    expect(body.textContent).toMatch(/12 matured 1-day outcomes: 50% went up, 42% went down/);
  });

  it("shows no stop-loss, take-profit, expectancy or simulated-trade wording", () => {
    render(<ContextDrawers note={GENERATED} evidence={EVIDENCE} />);
    fireEvent.click(header(/Historical evidence/));
    const text = screen.getByTestId("evidence-body").textContent ?? "";
    expect(text).not.toMatch(/stop|target|take.?profit|expectancy|simulated|win rate/i);
  });

  it("treats evidence with no matured outcomes as no evidence (never a made-up 0%)", () => {
    const empty: EvidenceVM = { pair: "EURUSD", horizon: 1, sampleCount: 0, upShare: null, downShare: null };
    render(<ContextDrawers note={GENERATED} evidence={empty} />);
    fireEvent.click(header(/Historical evidence/));
    expect(screen.getByText("No historical evidence is available for this pair.")).toBeTruthy();
  });
});
