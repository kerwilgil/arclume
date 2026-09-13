/**
 * Deck fixtures for the Chromium Visual QA suite. Re-exports the Phase 5
 * hand-built decks and adds the Phase 6 regression fixtures (cycle graph,
 * long key message, table / code stress, steps-only process, XSS).
 */

import { runHtml } from "../../../src/index.js";
import type { ArclumeDeck, DiagramIR } from "../../../src/types/deck.js";
import type { ProjectKnowledge } from "../../../src/types/knowledge.js";
import { clone, loadFixture } from "../../helpers/fixtures.js";

export { richDeck, sparseDeck, slideAt, diagramOf, first } from "../../helpers/decks.js";
import { richDeck, slideAt, sparseDeck } from "../../helpers/decks.js";

const NATIVE = "arclume.native.v1";

/**
 * A genuine end-to-end deck straight from the pipeline (knowledge → narrative →
 * slides → deck → HTML). This is the honest "rich"/"sparse" case — properly
 * budgeted slides, real provenance, every visual family the knowledge supports.
 */
export function pipelineDeck(
  fixture: "planning/wide-knowledge.json" | "planning/sparse-knowledge.json",
  audience: "executive" | "technical" | "general",
  theme: "minimal" | "executive",
): { deck: ArclumeDeck; html: string } {
  const knowledge = loadFixture<ProjectKnowledge>(fixture);
  const out = runHtml(knowledge, { audience, theme });
  return { deck: out.deck, html: out.html };
}

/** A deck whose architecture diagram is a genuine 3-node cycle A→B→C→A. */
export function cycleArchitectureDeck(): ArclumeDeck {
  const deck = clone(sparseDeck());
  const diagram: DiagramIR = {
    id: "dgm-cycle",
    engine: "native",
    diagramType: "architecture",
    title: "Cyclic system",
    spec: {
      format: NATIVE,
      kind: "architecture",
      condensed: false,
      nodes: [
        { id: "n-a", label: "Ingest", entityId: "ent-a", group: "components" },
        { id: "n-b", label: "Rules engine", entityId: "ent-b", group: "components" },
        { id: "n-c", label: "Recorder", entityId: "ent-c", group: "components" },
      ],
      edges: [
        {
          id: "e-ab",
          from: "n-a",
          to: "n-b",
          label: "FEEDS",
          relationId: "rel-ab",
          relationType: "DEPENDS_ON",
        },
        {
          id: "e-bc",
          from: "n-b",
          to: "n-c",
          label: "WRITES",
          relationId: "rel-bc",
          relationType: "DEPENDS_ON",
        },
        {
          id: "e-ca",
          from: "n-c",
          to: "n-a",
          label: "REPLAYS",
          relationId: "rel-ca",
          relationType: "DEPENDS_ON",
        },
      ],
    },
  };
  deck.diagrams = [diagram];
  slideAt(deck, 1).diagramRef = "dgm-cycle";
  slideAt(deck, 1).kind = "diagram";
  slideAt(deck, 1).narrativePurpose = "architecture";
  slideAt(deck, 1).layout = "full-bleed-visual";
  slideAt(deck, 1).blocks = [{ id: "b-cycle", type: "architecture", diagramRef: "dgm-cycle" }];
  return deck;
}

/** A deck with a ~230-char key message that must render verbatim, unclipped. */
export const LONG_KEY_MESSAGE =
  "The rollout stays deliberately conservative in every regulated market until the audit trail has cleared two full quarterly reviews, and only then does the steering group unlock the automated approval path for the remaining regions.";

export function longKeyMessageDeck(): ArclumeDeck {
  const deck = clone(sparseDeck());
  slideAt(deck, 1).keyMessage = LONG_KEY_MESSAGE;
  slideAt(deck, 1).layout = "centered";
  slideAt(deck, 1).blocks = [];
  return deck;
}

/** A wide table — must scroll locally (horizontal), must not break the slide. */
export function tableStressDeck(): ArclumeDeck {
  const deck = clone(sparseDeck());
  // Underscore tokens have no line-break opportunity, so the table's min-content
  // width genuinely exceeds the slide and `.arclume-table-wrap` must scroll.
  const columns = Array.from({ length: 10 }, (_, i) => `Quarterly_revenue_delta_col_${i + 1}`);
  const rows = Array.from({ length: 4 }, (_, r) =>
    columns.map((_, c) => `row_${r + 1}_column_${c + 1}_measured_value`),
  );
  slideAt(deck, 1).kind = "content";
  slideAt(deck, 1).keyMessage = "Wide table.";
  slideAt(deck, 1).blocks = [{ id: "b-table", type: "table", columns, rows }];
  return deck;
}

/** A code block with a very long line — local horizontal scroll, no slide overflow. */
export function codeStressDeck(): ArclumeDeck {
  const deck = clone(sparseDeck());
  const code =
    "const config = { retries: 5, backoffMs: 250, endpoints: ['ingest', 'rules', 'record', 'notify', 'audit'], flags: { strict: true, dryRun: false, verbose: true }, note: 'a single line that is far wider than any slide can show without scrolling' };";
  slideAt(deck, 1).blocks = [{ id: "b-code", type: "code", language: "js", code }];
  return deck;
}

/** A process diagram with steps only (no edges → no synthetic arrows). */
export function stepsOnlyProcessDeck(): ArclumeDeck {
  const deck = clone(sparseDeck());
  const diagram: DiagramIR = {
    id: "dgm-steps",
    engine: "native",
    diagramType: "workflow",
    title: "Steps only",
    spec: {
      format: NATIVE,
      kind: "process",
      condensed: false,
      steps: [
        { id: "s-1", label: "Receive", ref: "proc-x", index: 0 },
        { id: "s-2", label: "Check", ref: "proc-x", index: 1 },
        { id: "s-3", label: "Decide", ref: "proc-x", index: 2 },
      ],
      edges: [],
    },
  };
  deck.diagrams = [diagram];
  slideAt(deck, 1).kind = "diagram";
  slideAt(deck, 1).narrativePurpose = "process";
  slideAt(deck, 1).blocks = [{ id: "b-steps", type: "workflow", diagramRef: "dgm-steps" }];
  return deck;
}

/** A deck whose visible strings are XSS payloads. Must open inert. */
export function xssDeck(): ArclumeDeck {
  const deck = clone(sparseDeck());
  const payload = "<script>window.__arclume_xss__ = true; alert(1)</script>";
  deck.meta.title = payload;
  slideAt(deck, 1).title = payload;
  slideAt(deck, 1).keyMessage = `key ${payload}`;
  slideAt(deck, 1).blocks = [
    { id: "x-text", type: "text", text: payload },
    { id: "x-quote", type: "quote", text: payload, attribution: payload },
    { id: "x-code", type: "code", code: '"><img src=x onerror="window.__arclume_xss__=true">' },
    {
      id: "x-table",
      type: "table",
      columns: ["a", "b"],
      rows: [[payload, "</td></tr><script>alert(2)</script>"]],
    },
  ];
  return deck;
}

/** A minimal-theme copy of the rich deck (for theme comparison). */
export function richDeckMinimal(): ArclumeDeck {
  return richDeck({
    theme: {
      name: "minimal",
      aspectRatio: "16:9",
      mode: "light",
      tokensRef: "tokens:minimal:test",
    },
  });
}

/** An executive-theme copy of the rich deck. */
export function richDeckExecutive(): ArclumeDeck {
  return richDeck({
    theme: {
      name: "executive",
      aspectRatio: "16:9",
      mode: "auto",
      tokensRef: "tokens:executive:test",
    },
  });
}
