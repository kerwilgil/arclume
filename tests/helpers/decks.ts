/**
 * Hand-built `ArclumeDeck` fixtures for the HTML renderer tests.
 *
 * `richDeck()` exercises every one of the 16 block types, all 6 layouts and the
 * five native diagram kinds. `sparseDeck()` is the smallest sensible deck
 * (cover + one content slide + closing). Both validate clean, context-free.
 */

import type { Block } from "../../src/types/blocks.js";
import type { ArclumeDeck, DiagramIR, Slide } from "../../src/types/deck.js";

const NATIVE = "arclume.native.v1";

/** Throwing accessors so tests stay free of non-null assertions. */
export function slideAt(deck: ArclumeDeck, index: number): Slide {
  const s = deck.slides[index];
  if (!s) throw new Error(`no slide at index ${index}`);
  return s;
}
export function diagramOf(deck: ArclumeDeck, id: string): DiagramIR {
  const d = deck.diagrams.find((x) => x.id === id);
  if (!d) throw new Error(`no diagram "${id}"`);
  return d;
}
export function first<T>(arr: readonly T[]): T {
  const v = arr[0];
  if (v === undefined) throw new Error("first() on an empty array");
  return v;
}

function slide(partial: Partial<Slide> & Pick<Slide, "id" | "index" | "kind" | "title">): Slide {
  return {
    keyMessage: "One clear idea.",
    narrativePurpose: "context",
    layout: "single",
    blocks: [],
    checks: {},
    ...partial,
  };
}

export function richDeck(overrides: Partial<ArclumeDeck> = {}): ArclumeDeck {
  const diagrams: DiagramIR[] = [
    {
      id: "dgm-arch",
      engine: "native",
      diagramType: "architecture",
      title: "System shape",
      spec: {
        format: NATIVE,
        kind: "architecture",
        condensed: false,
        nodes: [
          { id: "n-ui", label: "Web UI", entityId: "cmp-ui", group: "components" },
          { id: "n-api", label: "API service", entityId: "cmp-api", group: "components" },
          { id: "n-erp", label: "ERP", entityId: "dep-erp", group: "dependencies" },
        ],
        edges: [
          {
            id: "e-1",
            from: "n-ui",
            to: "n-api",
            label: "DEPENDS_ON",
            relationId: "rel-ui-api",
            relationType: "DEPENDS_ON",
          },
          {
            id: "e-2",
            from: "n-api",
            to: "n-erp",
            label: "CONSUMES",
            relationId: "rel-api-erp",
            relationType: "CONSUMES",
          },
        ],
      },
    },
    {
      id: "dgm-flow",
      engine: "native",
      diagramType: "workflow",
      title: "Approval flow",
      spec: {
        format: NATIVE,
        kind: "process",
        condensed: false,
        steps: [
          { id: "s-a", label: "Ingest PO", ref: "proc-approve", index: 0 },
          { id: "s-b", label: "Evaluate rules", ref: "proc-approve", index: 1 },
          { id: "s-c", label: "Record decision", ref: "proc-approve", index: 2 },
        ],
        edges: [
          { id: "f-1", from: "s-a", to: "s-b", relationId: "rel-a-b" },
          { id: "f-2", from: "s-b", to: "s-c", relationId: "rel-b-c" },
        ],
      },
    },
    {
      id: "dgm-seq",
      engine: "native",
      diagramType: "sequence",
      title: "Message sequence",
      spec: {
        format: NATIVE,
        kind: "sequence",
        condensed: false,
        steps: [
          { id: "q-1", label: "Client sends request", ref: "cmp-ui", index: 0 },
          { id: "q-2", label: "API validates and routes", ref: "cmp-api", index: 1 },
          { id: "q-3", label: "ERP acknowledges", ref: "dep-erp", index: 2 },
        ],
        edges: [{ id: "sq-1", from: "q-1", to: "q-2", relationId: "rel-q1-q2" }],
      },
    },
    {
      id: "dgm-tl",
      engine: "native",
      diagramType: "timeline",
      title: "Delivery timeline",
      spec: {
        format: NATIVE,
        kind: "timeline",
        condensed: false,
        items: [
          { id: "t-1", label: "Kickoff", ref: "ms-kickoff", date: "2026-01", state: "done" },
          { id: "t-2", label: "Pilot", ref: "ms-pilot", date: "2026-04", state: "active" },
          { id: "t-3", label: "GA", ref: "ms-ga", date: "2026-09", state: "planned" },
        ],
      },
    },
    {
      id: "dgm-rm",
      engine: "native",
      diagramType: "roadmap",
      title: "Roadmap",
      spec: {
        format: NATIVE,
        kind: "roadmap",
        condensed: false,
        items: [
          { id: "r-1", label: "SSO", ref: "ph-sso", status: "active", date: "2026-Q2" },
          { id: "r-2", label: "Third pilot", ref: "ph-pilot", status: "planned" },
        ],
      },
    },
  ];

  const blocksText: Block[] = [
    { id: "b-text", type: "text", text: "A short editorial paragraph.\nWith a second line." },
    {
      id: "b-text-md",
      type: "text",
      text: "*Not* parsed as markdown in Phase 5 — shown as text.",
      format: "markdown",
    },
  ];
  const blocksMetric: Block[] = [
    {
      id: "b-metric",
      type: "metric",
      label: "Cycle time",
      value: "1.2",
      unit: "days",
      delta: "-2.8",
      direction: "down-good",
      metricId: "mtr-cycle",
    },
    {
      id: "b-metric-grid",
      type: "metric-grid",
      metrics: [
        { label: "Approvals", value: "312", metricId: "mtr-appr" },
        { label: "SLA", value: "99.2", unit: "%", direction: "up-good", delta: "+0.4" },
        { label: "Rework", value: "3", unit: "%" },
      ],
    },
  ];
  const blocksCompare: Block[] = [
    {
      id: "b-compare",
      type: "comparison",
      left: { title: "Before", note: "email" },
      right: { title: "After", note: "system" },
      rows: [
        { label: "State", left: "Threads", right: "Shared record" },
        { label: "Audit", left: "None", right: "Per action" },
      ],
    },
  ];
  const blocksTemporal: Block[] = [
    {
      id: "b-timeline",
      type: "timeline",
      items: [
        { id: "ti-1", label: "Ingest", date: "T0", state: "done", detail: "webhook in" },
        { id: "ti-2", label: "Decide", state: "active" },
      ],
    },
    {
      id: "b-roadmap",
      type: "roadmap",
      phases: [
        { id: "rp-1", name: "SSO", status: "active", start: "Q2", items: ["SAML", "OIDC"] },
        { id: "rp-2", name: "GA", status: "planned" },
      ],
    },
  ];
  const blocksRisk: Block[] = [
    {
      id: "b-risk",
      type: "risk",
      statement: "The ERP webhook may be rate-limited under load.",
      likelihood: "medium",
      impact: "high",
      mitigation: "Fall back to batch polling on 429.",
      factType: "INFERENCE",
      riskId: "rsk-erp",
      sourceRefs: [{ sourceId: "brief" }],
    },
    {
      id: "b-status",
      type: "status",
      state: "unknown",
      label: "Integration",
      detail: "not started",
    },
    { id: "b-callout", type: "callout", tone: "warning", text: "No vendor SLA covers throughput." },
    {
      id: "b-quote",
      type: "quote",
      text: "We need the decision recorded, not emailed.",
      attribution: "Head of Ops",
    },
  ];
  const blocksData: Block[] = [
    {
      id: "b-table",
      type: "table",
      columns: ["Metric", "Before", "After"],
      rows: [
        ["Cycle time", "4d", "1.2d"],
        ["Audit", "no", "yes"],
      ],
    },
    { id: "b-code", type: "code", language: "ts", code: "const x: number = 1;\nconsole.log(x);" },
    {
      id: "b-image",
      type: "image",
      src: "https://example.com/not-embedded.png",
      alt: "An external screenshot that will not be fetched",
    },
  ];

  const slides: Slide[] = [
    slide({
      id: "sld-cover",
      index: 0,
      kind: "cover",
      title: "OrderFlow review",
      subtitle: "2026-09",
      keyMessage: "A deterministic approval pipeline with a full audit trail.",
      layout: "centered",
      sectionId: "sec-intro",
    }),
    slide({
      id: "sld-text",
      index: 1,
      kind: "content",
      title: "Context",
      narrativePurpose: "context",
      layout: "single",
      sectionId: "sec-intro",
      blocks: blocksText,
    }),
    slide({
      id: "sld-metrics",
      index: 2,
      kind: "metrics",
      title: "Where we are",
      narrativePurpose: "evidence",
      layout: "grid",
      sectionId: "sec-body",
      blocks: blocksMetric,
    }),
    slide({
      id: "sld-compare",
      index: 3,
      kind: "comparison",
      title: "Before and after",
      narrativePurpose: "impact",
      layout: "split-2",
      sectionId: "sec-body",
      blocks: blocksCompare,
    }),
    slide({
      id: "sld-arch",
      index: 4,
      kind: "diagram",
      title: "System shape",
      narrativePurpose: "architecture",
      layout: "full-bleed-visual",
      sectionId: "sec-body",
      diagramRef: "dgm-arch",
      blocks: [{ id: "b-arch", type: "architecture", diagramRef: "dgm-arch" }],
      visual: { chosenForm: "architecture-diagram", rejected: ["bullets"] },
    }),
    slide({
      id: "sld-flow",
      index: 5,
      kind: "diagram",
      title: "Approval flow",
      narrativePurpose: "process",
      layout: "single",
      sectionId: "sec-body",
      diagramRef: "dgm-flow",
      blocks: [
        { id: "b-flow", type: "workflow", diagramRef: "dgm-flow" },
        { id: "b-seq", type: "diagram", diagramRef: "dgm-seq" },
      ],
    }),
    slide({
      id: "sld-time",
      index: 6,
      kind: "timeline",
      title: "Timeline and roadmap",
      narrativePurpose: "roadmap",
      layout: "single",
      sectionId: "sec-body",
      blocks: [
        { id: "b-tl-diagram", type: "diagram", diagramRef: "dgm-tl" },
        { id: "b-rm-diagram", type: "diagram", diagramRef: "dgm-rm" },
        ...blocksTemporal,
      ],
    }),
    slide({
      id: "sld-risk",
      index: 7,
      kind: "content",
      title: "Risks and status",
      narrativePurpose: "risk",
      layout: "single",
      sectionId: "sec-body",
      blocks: blocksRisk,
      evidence: [{ sourceRefs: [{ sourceId: "brief" }], factType: "INFERENCE" }],
    }),
    slide({
      id: "sld-data",
      index: 8,
      kind: "content",
      title: "Detail",
      narrativePurpose: "evidence",
      layout: "single",
      sectionId: "sec-body",
      blocks: blocksData,
    }),
    slide({
      id: "sld-quote",
      index: 9,
      kind: "quote",
      title: "In their words",
      narrativePurpose: "impact",
      layout: "quote",
      sectionId: "sec-body",
      blocks: [
        {
          id: "b-quote-2",
          type: "quote",
          text: "This is the decision system we asked for.",
          attribution: "Sponsor",
        },
      ],
    }),
    slide({
      id: "sld-close",
      index: 10,
      kind: "closing",
      title: "Questions",
      keyMessage:
        "Where should the rollout be more conservative, and which risks deserve a spike before the GA decision is taken by the steering group?",
      narrativePurpose: "call-to-action",
      layout: "centered",
    }),
  ];

  return {
    irVersion: "0.2.0",
    meta: { title: "OrderFlow — review", subtitle: "Rendered by Arclume", locale: "en" },
    project: { name: "OrderFlow", oneLiner: "Purchase-order approvals without the email threads." },
    audience: { preset: "technical", priorKnowledge: "high", formality: "neutral" },
    narrative: {
      preset: "technical",
      arcTitle: "From webhook to audited approval",
      throughline:
        "Every approval is a deterministic pass through the rules engine, and every step is recorded.",
      sections: [
        { id: "sec-intro", title: "Intro", purpose: "Set the scene." },
        { id: "sec-body", title: "Body", purpose: "Walk the system." },
      ],
    },
    theme: {
      name: "minimal",
      aspectRatio: "16:9",
      mode: "light",
      tokensRef: "tokens:minimal:test",
    },
    provenance: {
      sources: [
        { id: "repo", kind: "repo", title: "orderflow monorepo" },
        { id: "brief", kind: "pdf", title: "product brief" },
      ],
    },
    slides,
    diagrams,
    ...overrides,
  };
}

export function sparseDeck(overrides: Partial<ArclumeDeck> = {}): ArclumeDeck {
  return {
    irVersion: "0.2.0",
    meta: { title: "Tiny deck" },
    project: { name: "Tiny" },
    audience: { preset: "general" },
    narrative: {
      preset: "general",
      throughline: "One small idea, told plainly.",
      sections: [{ id: "sec-only", title: "Only", purpose: "Everything." }],
    },
    theme: {
      name: "executive",
      aspectRatio: "16:9",
      mode: "auto",
      tokensRef: "tokens:executive:test",
    },
    provenance: { sources: [{ id: "note", kind: "text", title: "a note" }] },
    slides: [
      {
        id: "s-cover",
        index: 0,
        kind: "cover",
        title: "Tiny deck",
        keyMessage: "One small idea.",
        narrativePurpose: "context",
        layout: "centered",
        blocks: [],
        checks: {},
      },
      {
        id: "s-body",
        index: 1,
        sectionId: "sec-only",
        kind: "content",
        title: "The idea",
        keyMessage: "Say the one thing, then stop.",
        narrativePurpose: "summary",
        layout: "single",
        blocks: [{ id: "s-body-text", type: "text", text: "That is the whole deck." }],
        checks: {},
      },
      {
        id: "s-close",
        index: 2,
        kind: "closing",
        title: "Thanks",
        keyMessage: "Questions?",
        narrativePurpose: "call-to-action",
        layout: "centered",
        blocks: [],
        checks: {},
      },
    ],
    diagrams: [],
    ...overrides,
  };
}
