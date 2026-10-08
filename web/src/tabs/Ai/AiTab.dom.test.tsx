// @vitest-environment jsdom
//
// dashboard-ui `web/` — AI tab render example/unit tests (task 9.7).
//
// These are EXAMPLE/UNIT (not property) tests. They render the AI tab with an injected
// rationale loader — no real network — wrapped in a `SelectionProvider` set to a concrete
// pair (the AI tab is per-pair, Req 8.2), and assert:
//
//   - When the loader returns rows that produce present content, the rationale, pattern
//     labels, and research proposals render, AND the AI section carries the
//     AI-generated / advisory / non-scoring label (Req 11.1, 11.2, 11.3).
//   - When the loader returns empty rows, the AI section is OMITTED — no rationale /
//     labels / proposals and no fabricated advisory text (Req 11.4).
//   - While the rationale fetch is in-flight (a pending loader promise), a loading state is
//     shown rather than a blank screen (Req 2.3, 14.3).
//
// Validates: Requirements 11.1, 11.2, 11.3, 11.4, 2.3, 14.3

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { ApiResult } from "../../api/snapshot";
import type { SignalProposal, SignalRationaleRow } from "../../api/types";
import { ALL_PAIRS, SelectionProvider, type PairSelection } from "../../state/selection";
import { AiTab, type AiRationaleLoader } from "./AiTab";

afterEach(() => {
  cleanup();
});

/** Render the AI tab inside a SelectionProvider fixed to `pair` (per-pair scope, Req 8.2). */
function renderAi(
  pair: PairSelection,
  element: ReactElement,
): ReturnType<typeof render> {
  return render(
    <SelectionProvider initialState={{ pair, date: "2026-09-16" }}>
      {element}
    </SelectionProvider>,
  );
}

/** Wrap rows as a resolved ApiResult envelope. */
function result(rows: readonly SignalRationaleRow[]): ApiResult<SignalRationaleRow> {
  return { rows, lastUpdated: null };
}

const proposal: SignalProposal = {
  proposalId: "prop-1",
  kind: "threshold",
  proposalText: "Consider widening the confidence floor for choppy regimes.",
};

/** A persisted rationale row carrying present content (verbatim, nothing synthesized). */
function presentRow(overrides: Partial<SignalRationaleRow> = {}): SignalRationaleRow {
  return {
    decision_date: "2026-09-16",
    pair: "EURUSD",
    rationale_text: "The setup echoes a prior momentum continuation analogue.",
    analogue_labels: ["momentum-continuation", "low-volatility"],
    proposals: [proposal],
    ...overrides,
  };
}

describe("AiTab — present content renders with advisory/non-scoring label (Req 11.1–11.3)", () => {
  it("renders rationale, labels, and proposals when content is present", async () => {
    renderAi(
      "EURUSD",
      <AiTab
        decisionDate="2026-09-16"
        loadAiRationale={() => Promise.resolve(result([presentRow()]))}
      />,
    );

    // Rationale narrative (verbatim).
    expect(
      await screen.findByText(/prior momentum continuation analogue/i),
    ).toBeTruthy();

    // Pattern-description labels (verbatim).
    expect(screen.getByText("momentum-continuation")).toBeTruthy();
    expect(screen.getByText("low-volatility")).toBeTruthy();

    // Research proposal text (verbatim).
    expect(
      screen.getByText(/widening the confidence floor for choppy regimes/i),
    ).toBeTruthy();
  });

  it("shows the AI-generated / advisory / non-scoring banner over present content", async () => {
    renderAi(
      "EURUSD",
      <AiTab
        decisionDate="2026-09-16"
        loadAiRationale={() => Promise.resolve(result([presentRow()]))}
      />,
    );

    // The fixed advisory banner (Req 11.2) is unmissable: AI-generated + advisory +
    // non-scoring.
    const banner = await screen.findByRole("note");
    const bannerText = banner.textContent ?? "";
    expect(bannerText).toMatch(/AI-generated/i);
    expect(bannerText).toMatch(/advisory/i);
    expect(bannerText).toMatch(/non-scoring/i);
  });

  it("labels each proposal as an advisory, AI-generated proposal (Req 11.3)", async () => {
    renderAi(
      "EURUSD",
      <AiTab
        decisionDate="2026-09-16"
        loadAiRationale={() => Promise.resolve(result([presentRow()]))}
      />,
    );

    await screen.findByText(/widening the confidence floor/i);
    // Per-proposal advisory label.
    expect(
      screen.getByText(/Advisory · AI-generated proposal · threshold/i),
    ).toBeTruthy();
  });
});

describe("AiTab — section omitted when content is absent (Req 11.4)", () => {
  it("omits the AI section with no fabricated text when the loader returns empty rows", async () => {
    renderAi(
      "EURUSD",
      <AiTab
        decisionDate="2026-09-16"
        loadAiRationale={() => Promise.resolve(result([]))}
      />,
    );

    // Once loading settles, the omit-when-absent message is shown...
    expect(
      await screen.findByText(/No AI rationale was persisted for EURUSD on this date/i),
    ).toBeTruthy();

    // ...and none of the present-content scaffolding is rendered: no advisory banner,
    // no rationale/labels/proposals headings, no fabricated advisory text.
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.queryByRole("heading", { name: /Rationale/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: /Pattern description/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: /Research proposals/i })).toBeNull();
  });

  it("omits the section when the only row carries no rationale, labels, or proposals", async () => {
    const emptyContentRow = presentRow({
      rationale_text: "",
      analogue_labels: [],
      proposals: [],
    });
    renderAi(
      "EURUSD",
      <AiTab
        decisionDate="2026-09-16"
        loadAiRationale={() => Promise.resolve(result([emptyContentRow]))}
      />,
    );

    expect(
      await screen.findByText(/No AI rationale was persisted for EURUSD on this date/i),
    ).toBeTruthy();
    expect(screen.queryByRole("note")).toBeNull();
  });
});

describe("AiTab — loading state during an in-flight fetch (Req 2.3, 14.3)", () => {
  it("shows a loading state rather than a blank screen while the fetch is pending", () => {
    // A loader that never resolves keeps the tab in its loading state.
    const pending: AiRationaleLoader = () => new Promise(() => {});
    renderAi(
      "EURUSD",
      <AiTab decisionDate="2026-09-16" loadAiRationale={pending} />,
    );

    const loading = screen.getByText(/Loading AI rationale/i);
    expect(loading).toBeTruthy();
    expect(loading.getAttribute("aria-busy")).toBe("true");
  });

  it("replaces the loading state with content once the fetch resolves", async () => {
    renderAi(
      "EURUSD",
      <AiTab
        decisionDate="2026-09-16"
        loadAiRationale={() => Promise.resolve(result([presentRow()]))}
      />,
    );

    await screen.findByText(/prior momentum continuation analogue/i);
    await waitFor(() => {
      expect(screen.queryByText(/Loading AI rationale/i)).toBeNull();
    });
  });

  it("prompts for a specific pair when the Pair_Selector is on All pairs (Req 8.2)", () => {
    // Guard: with "All pairs" selected the per-pair tab does not fetch or fabricate; it
    // asks the viewer to pick a pair. No loading state is shown in this case.
    renderAi(
      ALL_PAIRS,
      <AiTab
        decisionDate="2026-09-16"
        loadAiRationale={() => Promise.resolve(result([presentRow()]))}
      />,
    );

    expect(
      screen.getByText(/Select a specific currency pair to view its AI-generated rationale/i),
    ).toBeTruthy();
    expect(screen.queryByText(/Loading AI rationale/i)).toBeNull();
  });
});
