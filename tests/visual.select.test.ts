/**
 * Automatic visual intent selection + ambiguity policy + determinism
 * (Visual Intelligence, Slice 2B §2 / §5 / §6).
 *
 * `selectDiagramKind` names the diagram the *structured* knowledge supports;
 * `selectVisualIntent` reconciles it with the planner's `visualIntent`. Every
 * decision is deterministic and carries `consideredRefs` / `evidenceRefs`.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_VISUAL_LIMITS,
  type ProjectKnowledge,
  buildKnowledgeView,
  selectDiagramKind,
  selectVisualIntent,
} from "../src/index.js";

const L = DEFAULT_VISUAL_LIMITS;
const sr = [{ sourceId: "brief" }];

const EMPTY = {
  capabilities: [],
  components: [],
  actors: [],
  dependencies: [],
  processes: [],
  phases: [],
  milestones: [],
  metrics: [],
  risks: [],
  decisions: [],
  requirements: [],
  technologies: [],
  results: [],
  constraints: [],
  relations: [],
  claims: [],
  gaps: [],
};

function knowledge(over: Partial<ProjectKnowledge>): ProjectKnowledge {
  return {
    knowledgeVersion: "0.1.0",
    project: { id: "proj", name: "Demo", sourceRefs: [] },
    sources: [{ id: "brief", kind: "pdf", title: "The brief" }],
    ...EMPTY,
    ...over,
  } as ProjectKnowledge;
}

function allIds(k: ProjectKnowledge): string[] {
  const out: string[] = [];
  for (const key of Object.keys(EMPTY) as (keyof typeof EMPTY)[]) {
    for (const e of (k[key] ?? []) as Array<{ id: string }>) out.push(e.id);
  }
  return out;
}

function auto(k: ProjectKnowledge) {
  return selectDiagramKind(buildKnowledgeView(k), allIds(k), L);
}

function plannedSlide(over: Record<string, unknown>) {
  return {
    id: "slide-x",
    index: 1,
    sectionId: "sec-x",
    kind: "content",
    title: "X",
    keyMessage: "a message",
    narrativePurpose: "evidence",
    knowledgeRefs: [],
    claimRefs: [],
    sourceRefs: [],
    contentIntent: "content",
    visualIntent: "summary",
    density: "high",
    priority: 5,
    ...over,
  } as Parameters<typeof selectVisualIntent>[0];
}

/* ------------------------------------------------------------------ */
/* the seven diagram kinds — chosen from structure, not keywords       */
/* ------------------------------------------------------------------ */

const architectureK = () =>
  knowledge({
    components: [
      { id: "cmp-a", name: "API", kind: "service", sourceRefs: sr },
      { id: "cmp-b", name: "DB", kind: "store", sourceRefs: sr },
    ],
    relations: [{ id: "rel-1", from: "cmp-a", to: "cmp-b", type: "DEPENDS_ON", sourceRefs: sr }],
  });

const workflowK = () =>
  knowledge({
    processes: [
      {
        id: "prc-1",
        name: "Onboarding",
        steps: [{ label: "Invite" }, { label: "Verify" }, { label: "Activate" }],
        sourceRefs: sr,
      },
    ],
  });

const sequenceK = () =>
  knowledge({
    components: [
      { id: "cmp-web", name: "Web", kind: "ui", sourceRefs: sr },
      { id: "cmp-api", name: "API", kind: "service", sourceRefs: sr },
    ],
    relations: [
      {
        id: "rel-s",
        from: "cmp-web",
        to: "cmp-api",
        type: "PRECEDES",
        label: "submit",
        sourceRefs: sr,
      },
    ],
  });

const dataflowK = () =>
  knowledge({
    components: [
      { id: "cmp-i", name: "Importer", kind: "service", sourceRefs: sr },
      { id: "cmp-s", name: "Store", kind: "store", sourceRefs: sr },
      { id: "cmp-d", name: "Dash", kind: "ui", sourceRefs: sr },
    ],
    relations: [
      { id: "rel-p", from: "cmp-i", to: "cmp-s", type: "PRODUCES", sourceRefs: sr },
      { id: "rel-c", from: "cmp-d", to: "cmp-s", type: "CONSUMES", sourceRefs: sr },
    ],
  });

const lifecycleK = () =>
  knowledge({
    phases: [
      { id: "ph-1", name: "Build", status: "done", sourceRefs: sr },
      { id: "ph-2", name: "Pilot", status: "active", sourceRefs: sr },
      { id: "ph-3", name: "GA", status: "planned", sourceRefs: sr },
    ],
    relations: [
      { id: "rel-a", from: "ph-1", to: "ph-2", type: "PRECEDES", sourceRefs: sr },
      { id: "rel-b", from: "ph-2", to: "ph-3", type: "PRECEDES", sourceRefs: sr },
    ],
  });

const timelineK = () =>
  knowledge({
    milestones: [
      { id: "ms-1", name: "Kickoff", date: "2025-01-10", achieved: true, sourceRefs: sr },
      { id: "ms-2", name: "Beta", date: "2025-06-01", achieved: true, sourceRefs: sr },
    ],
  });

const roadmapK = () =>
  knowledge({
    phases: [
      { id: "ph-1", name: "Now", status: "active", sourceRefs: sr },
      { id: "ph-2", name: "Next", status: "planned", sourceRefs: sr },
      { id: "ph-3", name: "Later", status: "planned", sourceRefs: sr },
    ],
  });

describe("selectDiagramKind — the seven kinds from structural signals", () => {
  it.each<[string, () => ProjectKnowledge, string[]]>([
    ["architecture", architectureK, ["auto-architecture"]],
    ["workflow", workflowK, ["auto-workflow"]],
    ["dataflow", dataflowK, ["auto-dataflow"]],
    ["lifecycle", lifecycleK, ["lifecycle-structure-sufficient"]],
    ["timeline", timelineK, ["auto-timeline", "ambiguity-timeline-vs-roadmap"]],
    ["roadmap", roadmapK, ["auto-roadmap"]],
  ])("%s → kind + reasonCode", (kind, make, reasonCodes) => {
    const a = auto(make());
    expect(a?.kind).toBe(kind === "workflow" ? "process" : kind);
    expect(reasonCodes).toContain(a?.reasonCode);
  });

  it("sequence: PRECEDES between two distinct components", () => {
    const a = auto(sequenceK());
    expect(a?.kind).toBe("sequence");
    expect(a?.reasonCode).toBe("auto-sequence");
  });

  it("returns null when no structural signal is present", () => {
    const k = knowledge({
      capabilities: [{ id: "cap-1", name: "Reporting", sourceRefs: sr }],
    });
    expect(auto(k)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* ambiguity policy — the structural signal wins, deterministically    */
/* ------------------------------------------------------------------ */

describe("ambiguity policy", () => {
  it("workflow vs dataflow: more PRECEDES steps than data relations → workflow", () => {
    const k = knowledge({
      capabilities: [
        { id: "c1", name: "A", sourceRefs: sr },
        { id: "c2", name: "B", sourceRefs: sr },
        { id: "c3", name: "C", sourceRefs: sr },
      ],
      components: [
        { id: "cmp-i", name: "Importer", kind: "service", sourceRefs: sr },
        { id: "cmp-s", name: "Store", kind: "store", sourceRefs: sr },
      ],
      relations: [
        { id: "r-s1", from: "c1", to: "c2", type: "PRECEDES", sourceRefs: sr },
        { id: "r-s2", from: "c2", to: "c3", type: "PRECEDES", sourceRefs: sr },
        { id: "r-d1", from: "cmp-i", to: "cmp-s", type: "PRODUCES", sourceRefs: sr },
      ],
    });
    const a = auto(k);
    expect(a?.kind).toBe("process");
    expect(a?.reasonCode).toBe("ambiguity-workflow-vs-dataflow");
  });

  it("dataflow vs workflow: more data relations than PRECEDES → dataflow", () => {
    const k = knowledge({
      capabilities: [
        { id: "c1", name: "A", sourceRefs: sr },
        { id: "c2", name: "B", sourceRefs: sr },
      ],
      components: [
        { id: "cmp-i", name: "Importer", kind: "service", sourceRefs: sr },
        { id: "cmp-s", name: "Store", kind: "store", sourceRefs: sr },
        { id: "cmp-d", name: "Dash", kind: "ui", sourceRefs: sr },
      ],
      relations: [
        { id: "r-s1", from: "c1", to: "c2", type: "PRECEDES", sourceRefs: sr },
        { id: "r-d1", from: "cmp-i", to: "cmp-s", type: "PRODUCES", sourceRefs: sr },
        { id: "r-d2", from: "cmp-d", to: "cmp-s", type: "CONSUMES", sourceRefs: sr },
      ],
    });
    const a = auto(k);
    expect(a?.kind).toBe("dataflow");
    expect(a?.reasonCode).toBe("ambiguity-workflow-vs-dataflow");
  });

  it("workflow vs lifecycle: a process with steps outweighs a phase-state chain", () => {
    const k = knowledge({
      processes: [
        {
          id: "prc-1",
          name: "Deploy",
          steps: [{ label: "Build" }, { label: "Test" }, { label: "Ship" }],
          sourceRefs: sr,
        },
      ],
      phases: [
        { id: "ph-1", name: "Alpha", status: "done", sourceRefs: sr },
        { id: "ph-2", name: "Beta", status: "active", sourceRefs: sr },
      ],
      relations: [{ id: "rel-a", from: "ph-1", to: "ph-2", type: "PRECEDES", sourceRefs: sr }],
    });
    const a = auto(k);
    // process-with-steps (3) outweighs phase transitions (1)
    expect(a?.kind).toBe("process");
    expect(a?.reasonCode).toBe("ambiguity-workflow-vs-lifecycle");
  });

  it("architecture vs dataflow: more structural relations than data relations → architecture", () => {
    const k = knowledge({
      components: [
        { id: "cmp-a", name: "A", kind: "service", sourceRefs: sr },
        { id: "cmp-b", name: "B", kind: "store", sourceRefs: sr },
        { id: "cmp-c", name: "C", kind: "service", sourceRefs: sr },
      ],
      relations: [
        { id: "r-1", from: "cmp-a", to: "cmp-b", type: "DEPENDS_ON", sourceRefs: sr },
        { id: "r-2", from: "cmp-c", to: "cmp-b", type: "DEPENDS_ON", sourceRefs: sr },
        { id: "r-3", from: "cmp-a", to: "cmp-b", type: "PRODUCES", sourceRefs: sr },
      ],
    });
    const a = auto(k);
    expect(a?.kind).toBe("architecture");
    expect(a?.reasonCode).toBe("ambiguity-architecture-vs-dataflow");
  });

  it("sequence vs workflow: PRECEDES between distinct components + a process → sequence", () => {
    const k = knowledge({
      components: [
        { id: "cmp-web", name: "Web", kind: "ui", sourceRefs: sr },
        { id: "cmp-api", name: "API", kind: "service", sourceRefs: sr },
      ],
      processes: [
        {
          id: "prc-1",
          name: "Job",
          steps: [{ label: "Enqueue" }, { label: "Run" }],
          sourceRefs: sr,
        },
      ],
      relations: [
        { id: "rel-s", from: "cmp-web", to: "cmp-api", type: "PRECEDES", sourceRefs: sr },
      ],
    });
    const a = auto(k);
    expect(a?.kind).toBe("sequence");
    expect(a?.reasonCode).toBe("ambiguity-sequence-vs-workflow");
  });

  it("timeline vs roadmap: dated milestones present alongside undated phases → timeline", () => {
    const k = knowledge({
      milestones: [
        { id: "ms-1", name: "Launch", date: "2025-03-01", achieved: true, sourceRefs: sr },
      ],
      phases: [
        { id: "ph-1", name: "Later A", status: "planned", sourceRefs: sr },
        { id: "ph-2", name: "Later B", status: "planned", sourceRefs: sr },
      ],
    });
    const a = auto(k);
    expect(a?.kind).toBe("timeline");
    expect(a?.reasonCode).toBe("ambiguity-timeline-vs-roadmap");
  });

  it("lifecycle admission policy: phases carry status but no PRECEDES → not a lifecycle", () => {
    const k = knowledge({
      phases: [
        { id: "ph-1", name: "A", status: "done", sourceRefs: sr },
        { id: "ph-2", name: "B", status: "active", sourceRefs: sr },
      ],
      relations: [{ id: "rel-x", from: "ph-1", to: "ph-2", type: "DEPENDS_ON", sourceRefs: sr }],
    });
    const a = auto(k);
    expect(a?.kind).not.toBe("lifecycle");
  });
});

/* ------------------------------------------------------------------ */
/* determinism                                                          */
/* ------------------------------------------------------------------ */

describe("determinism", () => {
  it.each<[string, () => ProjectKnowledge]>([
    ["architecture", architectureK],
    ["dataflow", dataflowK],
    ["lifecycle", lifecycleK],
    ["timeline", timelineK],
  ])("%s: same knowledge + refs → identical AutoVisual, twice", (_name, make) => {
    const k = make();
    expect(JSON.stringify(auto(k))).toBe(JSON.stringify(auto(k)));
  });

  it("is independent of relation / entity input order", () => {
    const forward = dataflowK();
    const reversed = knowledge({
      components: [...dataflowK().components].reverse(),
      relations: [...dataflowK().relations].reverse(),
    });
    expect(JSON.stringify(auto(forward))).toBe(JSON.stringify(auto(reversed)));
  });
});

/* ------------------------------------------------------------------ */
/* selectVisualIntent — reconciliation with the planner                 */
/* ------------------------------------------------------------------ */

describe("selectVisualIntent — planner reconciliation", () => {
  it("carries consideredRefs and evidenceRefs ⊆ consideredRefs", () => {
    const k = dataflowK();
    const ids = allIds(k);
    const slide = plannedSlide({ visualIntent: "summary", knowledgeRefs: ids });
    const r = selectVisualIntent(slide, buildKnowledgeView(k), L);
    expect(new Set(r.consideredRefs)).toEqual(new Set(ids));
    for (const id of r.evidenceRefs) expect(r.consideredRefs).toContain(id);
  });

  it("overrides a `process` intent when data movement predominates", () => {
    const k = dataflowK();
    const slide = plannedSlide({ visualIntent: "process", knowledgeRefs: allIds(k) });
    const r = selectVisualIntent(slide, buildKnowledgeView(k), L);
    expect(r.visualKind).toBe("dataflow");
    expect(r.outcome).toBe("refined");
    expect(r.fallbackKind).toBeDefined();
  });

  it("keeps a supported `architecture` intent (no needless override)", () => {
    const k = architectureK();
    const slide = plannedSlide({ visualIntent: "architecture", knowledgeRefs: allIds(k) });
    const r = selectVisualIntent(slide, buildKnowledgeView(k), L);
    expect(r.visualKind).toBe("architecture");
    expect(r.outcome).toBe("accepted");
  });

  it("upgrades a generic `summary` intent to the structural pick", () => {
    const k = lifecycleK();
    const slide = plannedSlide({ visualIntent: "summary", knowledgeRefs: allIds(k) });
    const r = selectVisualIntent(slide, buildKnowledgeView(k), L);
    expect(r.visualKind).toBe("lifecycle");
    expect(r.reasonCode).toBe("lifecycle-structure-sufficient");
  });

  it("is deterministic for the same slide + knowledge", () => {
    const k = dataflowK();
    const slide = plannedSlide({ visualIntent: "summary", knowledgeRefs: allIds(k) });
    const view = buildKnowledgeView(k);
    expect(JSON.stringify(selectVisualIntent(slide, view, L))).toBe(
      JSON.stringify(selectVisualIntent(slide, view, L)),
    );
  });
});
