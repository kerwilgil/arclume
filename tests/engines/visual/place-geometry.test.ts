/**
 * Deterministic geometry planners for Visual Engine dataflow & lifecycle
 * (Visual Intelligence, Slice 2a).
 *
 * Two levels of coverage:
 *  - pure planner: placement is deterministic and unplaceable graphs are
 *    reported explicitly (never silently mis-placed);
 *  - real vendored render: an adapter built from a geometry-free spec renders
 *    through the actual `render-dataflow.mjs` / `render-lifecycle.mjs`
 *    validators for every target shape.
 */

import { describe, expect, it } from "vitest";
import { adaptDiagramToVisualEngine } from "../../../src/engines/visual/index.js";
import { placeDataflow } from "../../../src/engines/visual/place-dataflow.js";
import { placeLifecycle } from "../../../src/engines/visual/place-lifecycle.js";
import type { DiagramIR } from "../../../src/types/deck.js";
import {
  dataflowDiagram,
  dataflowFanOutDiagram,
  lifecycleDiagram,
  lifecycleRetryDiagram,
  renderFixtureFor,
} from "./helpers.js";

/* ================================================================= */
/* placeDataflow — pure                                               */
/* ================================================================= */

describe("placeDataflow", () => {
  const linear = {
    stageCount: 3,
    nodes: [
      { id: "a", stage: 0 },
      { id: "b", stage: 1 },
      { id: "c", stage: 2 },
    ],
    flows: [
      { id: "f1", from: "a", to: "b" },
      { id: "f2", from: "b", to: "c" },
    ],
  };

  it("linear pipeline: every node on row 0, adjacent flows straight", () => {
    const r = placeDataflow(linear);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([...r.placement.rows.values()]).toEqual([0, 0, 0]);
    expect([...r.placement.routes.values()]).toEqual(["straight", "straight"]);
    expect(r.placement.viewBox[0]).toBeGreaterThanOrEqual(940);
  });

  it("fan-out: a single source, N targets spread across rows 0..N-1", () => {
    const r = placeDataflow({
      stageCount: 3,
      nodes: [
        { id: "s", stage: 0 },
        { id: "w1", stage: 1 },
        { id: "w2", stage: 1 },
        { id: "w3", stage: 1 },
        { id: "k", stage: 2 },
      ],
      flows: [
        { id: "a", from: "s", to: "w1" },
        { id: "b", from: "s", to: "w2" },
        { id: "c", from: "s", to: "w3" },
        { id: "d", from: "w1", to: "k" },
        { id: "e", from: "w2", to: "k" },
        { id: "g", from: "w3", to: "k" },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(
      [r.placement.rows.get("w1"), r.placement.rows.get("w2"), r.placement.rows.get("w3")].sort(),
    ).toEqual([0, 1, 2]);
  });

  it("fan-in: N sources on rows 0..N-1, merge inherits the first predecessor's row", () => {
    const r = placeDataflow({
      stageCount: 3,
      nodes: [
        { id: "a", stage: 0 },
        { id: "b", stage: 0 },
        { id: "c", stage: 0 },
        { id: "m", stage: 1 },
        { id: "db", stage: 2 },
      ],
      flows: [
        { id: "f1", from: "a", to: "m" },
        { id: "f2", from: "b", to: "m" },
        { id: "f3", from: "c", to: "m" },
        { id: "f4", from: "m", to: "db" },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([
      r.placement.rows.get("a"),
      r.placement.rows.get("b"),
      r.placement.rows.get("c"),
    ]).toEqual([0, 1, 2]);
    expect(r.placement.rows.get("m")).toBe(0); // first predecessor by id ("a")
  });

  it("same-stage flow → vertical channel; a stage skip → bottom channel", () => {
    const r = placeDataflow({
      stageCount: 3,
      nodes: [
        { id: "a", stage: 0 },
        { id: "b", stage: 1 },
        { id: "c", stage: 1 },
        { id: "d", stage: 2 },
      ],
      flows: [
        { id: "f1", from: "a", to: "b" },
        { id: "f2", from: "b", to: "c" }, // same stage
        { id: "f3", from: "a", to: "d" }, // skip stage 1
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.placement.routes.get("f2")).toBe("vertical-channel");
    expect(r.placement.routes.get("f3")).toBe("bottom-channel");
  });

  it("determinism: identical input → identical placement (independent of array order)", () => {
    const a = placeDataflow(linear);
    const shuffled = {
      ...linear,
      nodes: [...linear.nodes].reverse(),
      flows: [...linear.flows].reverse(),
    };
    const b = placeDataflow(shuffled);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect([...a.placement.rows.entries()].sort()).toEqual([...b.placement.rows.entries()].sort());
    expect([...a.placement.routes.entries()].sort()).toEqual(
      [...b.placement.routes.entries()].sort(),
    );
  });

  it("unplaceable: an overfull stage is an explicit reason, not invalid geometry", () => {
    const r = placeDataflow({
      stageCount: 2,
      nodes: Array.from({ length: 6 }, (_, i) => ({ id: `n${i}`, stage: 1 })).concat({
        id: "s",
        stage: 0,
      }),
      flows: [{ id: "f", from: "s", to: "n0" }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("at most 5 rows");
  });

  it("unplaceable: a backward flow is reported, never placed", () => {
    const r = placeDataflow({
      stageCount: 2,
      nodes: [
        { id: "x", stage: 0 },
        { id: "y", stage: 1 },
      ],
      flows: [
        { id: "f1", from: "x", to: "y" },
        { id: "f2", from: "y", to: "x" },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("backwards");
  });
});

/* ================================================================= */
/* placeLifecycle — pure                                             */
/* ================================================================= */

describe("placeLifecycle", () => {
  it("linear rail: main-lane states get ascending columns, straight transitions", () => {
    const r = placeLifecycle({
      laneIds: ["main"],
      states: [
        { id: "s0", lane: "main" },
        { id: "s1", lane: "main" },
        { id: "s2", lane: "main" },
      ],
      transitions: [
        { id: "t0", from: "s0", to: "s1" },
        { id: "t1", from: "s1", to: "s2" },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([
      r.placement.cols.get("s0"),
      r.placement.cols.get("s1"),
      r.placement.cols.get("s2"),
    ]).toEqual([0, 1, 2]);
    expect([...r.placement.routes.values()]).toEqual(["straight", "straight"]);
  });

  it("branch to terminal outcomes → bottom-channel drops off the rail", () => {
    const r = placeLifecycle({
      laneIds: ["main", "terminal"],
      states: [
        { id: "s0", lane: "main" },
        { id: "s1", lane: "main" },
        { id: "ok", lane: "terminal" },
        { id: "ko", lane: "terminal" },
      ],
      transitions: [
        { id: "t0", from: "s0", to: "s1" },
        { id: "t1", from: "s1", to: "ok" },
        { id: "t2", from: "s1", to: "ko" },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.placement.routes.get("t1")).toBe("bottom-channel");
    expect(r.placement.routes.get("t2")).toBe("bottom-channel");
  });

  it("retry: recovery-lane state, back-edge to main uses top-channel, retry→failed bottom-channel", () => {
    const r = placeLifecycle({
      laneIds: ["main", "recover", "terminal"],
      states: [
        { id: "q", lane: "main" },
        { id: "run", lane: "main" },
        { id: "retry", lane: "recover" },
        { id: "done", lane: "terminal" },
        { id: "fail", lane: "terminal" },
      ],
      transitions: [
        { id: "a", from: "q", to: "run" },
        { id: "b", from: "run", to: "done" },
        { id: "c", from: "run", to: "retry" },
        { id: "d", from: "retry", to: "run" }, // recovery
        { id: "e", from: "retry", to: "fail" },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.placement.routes.get("c")).toBe("bottom-channel"); // main → event
    expect(r.placement.routes.get("d")).toBe("top-channel"); // event → main (recovery)
    expect(r.placement.routes.get("e")).toBe("bottom-channel"); // event → terminal
  });

  it("determinism: identical input → identical placement regardless of order", () => {
    const input = {
      laneIds: ["main", "terminal"],
      states: [
        { id: "s0", lane: "main" },
        { id: "s1", lane: "main" },
        { id: "ok", lane: "terminal" },
      ],
      transitions: [
        { id: "t0", from: "s0", to: "s1" },
        { id: "t1", from: "s1", to: "ok" },
      ],
    };
    const a = placeLifecycle(input);
    const b = placeLifecycle({
      ...input,
      states: [...input.states].reverse(),
      transitions: [...input.transitions].reverse(),
    });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect([...a.placement.cols.entries()].sort()).toEqual([...b.placement.cols.entries()].sort());
  });

  it("unplaceable: no `main` lane, or an overfull band, is explicit", () => {
    const noMain = placeLifecycle({
      laneIds: ["side"],
      states: [
        { id: "a", lane: "side" },
        { id: "b", lane: "side" },
      ],
      transitions: [{ id: "t", from: "a", to: "b" }],
    });
    expect(noMain.ok).toBe(false);
    if (!noMain.ok) expect(noMain.reason).toContain("main");

    const overfull = placeLifecycle({
      laneIds: ["main"],
      states: Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, lane: "main" })),
      transitions: [],
    });
    expect(overfull.ok).toBe(false);
    if (!overfull.ok) expect(overfull.reason).toContain("at most 5 columns");
  });
});

/* ================================================================= */
/* real vendored render — geometry-free fixtures                     */
/* ================================================================= */

describe("planner output renders through the real vendored engine", () => {
  const svgOk = async (d: DiagramIR): Promise<string> => {
    const html = await renderFixtureFor(d);
    expect(html).toContain("<svg");
    return html;
  };

  it("dataflow: linear pipeline (no explicit row/route)", async () => {
    const html = await svgOk(dataflowDiagram());
    for (const id of ["df-client", "df-api", "df-db"]) {
      expect(html).toContain(`data-node-id="${id}"`);
    }
  });

  it("dataflow: single-source fan-out with a shared sink", async () => {
    const html = await svgOk(dataflowFanOutDiagram());
    for (const id of ["fo-src", "fo-w1", "fo-w2", "fo-w3", "fo-db"]) {
      expect(html).toContain(`data-node-id="${id}"`);
    }
  });

  it("lifecycle: linear + branch to terminal outcomes (no explicit col/route)", async () => {
    const html = await svgOk(lifecycleDiagram());
    for (const id of ["lc-created", "lc-proc", "lc-done", "lc-failed"]) {
      expect(html).toContain(`data-node-id="${id}"`);
    }
  });

  it("lifecycle: recovery lane with a retry back-edge and a terminal failure", async () => {
    const html = await svgOk(lifecycleRetryDiagram());
    for (const id of ["r-queued", "r-running", "r-retry", "r-done", "r-failed"]) {
      expect(html).toContain(`data-node-id="${id}"`);
    }
  });

  it("the adapter reports an unplaceable dataflow as adapter-invalid-input (not render-failed)", () => {
    const overfull = dataflowFanOutDiagram({
      spec: {
        format: "arclume.native.v1",
        kind: "dataflow",
        stages: [{ label: "A" }, { label: "B" }],
        nodes: [
          { id: "s", type: "frontend", label: "S", stage: 0 },
          ...Array.from({ length: 6 }, (_, i) => ({
            id: `n${i}`,
            type: "backend" as const,
            label: `N${i}`,
            stage: 1,
          })),
        ],
        flows: [{ id: "f", from: "s", to: "n0", label: "x" }],
      },
    });
    const r = adaptDiagramToVisualEngine(overfull);
    expect(r).toMatchObject({ kind: "error", code: "visual-engine/adapter-invalid-input" });
    if (r.kind === "error") expect(r.message).toContain("geometry could not be planned");
  });
});
