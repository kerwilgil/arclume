/**
 * Visual Engine class-map coverage.
 *
 * Every presentation class that the vendored visual engine v2.16.0 renderers can
 * emit for our integration envelope (architecture + workflow, `classic`
 * preset, `animation: none`, hidden legend) must exist in `VISUAL_ENGINE_CLASS_MAP`
 * — the sanitizer is fatal on anything else, so this test is the early,
 * explicit guard against vendor drift.
 */

import { describe, expect, it } from "vitest";
import {
  VISUAL_ENGINE_CLASS_MAP,
  adaptDiagramToVisualEngine,
} from "../../../src/engines/visual/index.js";
import { architectureDiagram, renderFixtureFor, workflowDiagram } from "./helpers.js";

const SIGIL_CLASSES = new Set([
  "semantic-sigil",
  "s-frontend",
  "s-backend",
  "s-database",
  "s-cloud",
  "s-security",
  "s-messagebus",
  "s-external",
]);

function classesIn(html: string): Set<string> {
  const start = html.indexOf("<svg");
  const end = html.indexOf("</svg>", start);
  const region = start >= 0 && end > start ? html.slice(start, end) : "";
  const out = new Set<string>();
  for (const m of region.matchAll(/class="([^"]*)"/g)) {
    for (const cls of (m[1] ?? "").split(/\s+/).filter(Boolean)) out.add(cls);
  }
  return out;
}

const archFixtures = [
  architectureDiagram(),
  // cyclic graph → grid fallback
  architectureDiagram({
    id: "d-cyc",
    spec: {
      format: "arclume.native.v1",
      kind: "architecture",
      nodes: [
        { id: "a", label: "A", entityId: "cmp-a" },
        { id: "b", label: "B", entityId: "cmp-b" },
      ],
      edges: [
        { id: "e1", from: "a", to: "b", relationId: "rel-a-b" },
        { id: "e2", from: "b", to: "a", relationId: "rel-b-a" },
      ],
    },
  }),
  // label-bearing edges exercise the label-mask classes
  architectureDiagram({
    id: "d-labels",
    spec: {
      format: "arclume.native.v1",
      kind: "architecture",
      nodes: [
        { id: "a", label: "Alpha", entityId: "cmp-a" },
        { id: "b", label: "Beta", entityId: "cmp-b" },
      ],
      edges: [{ id: "e1", from: "a", to: "b", label: "calls", relationId: "rel-a-b" }],
    },
  }),
];

const flowFixtures = [workflowDiagram(2), workflowDiagram(6), workflowDiagram(3)];

describe("VISUAL_ENGINE_CLASS_MAP coverage over real engine output", () => {
  it("covers every class emitted by architecture fixtures", async () => {
    for (const fixture of archFixtures) {
      const html = await renderFixtureFor(fixture);
      for (const cls of classesIn(html)) {
        const covered = Object.hasOwn(VISUAL_ENGINE_CLASS_MAP, cls) || SIGIL_CLASSES.has(cls);
        expect(covered, `class "${cls}" (${fixture.id}) is not mapped`).toBe(true);
      }
    }
  });

  it("covers every class emitted by workflow fixtures", async () => {
    for (const fixture of flowFixtures) {
      const html = await renderFixtureFor(fixture);
      for (const cls of classesIn(html)) {
        const covered = Object.hasOwn(VISUAL_ENGINE_CLASS_MAP, cls) || SIGIL_CLASSES.has(cls);
        expect(covered, `class "${cls}" (${fixture.id}) is not mapped`).toBe(true);
      }
    }
  });

  it("the adapter always requests classic + animation none + hidden legend", () => {
    for (const fixture of [...archFixtures, ...flowFixtures]) {
      const adapted = adaptDiagramToVisualEngine(fixture);
      if (adapted.kind !== "ok") throw new Error("fixture must adapt");
      expect(adapted.request.meta.animation).toBe("none");
      expect(adapted.request.meta.visual_preset).toBe("classic");
      expect(adapted.request.meta.legend.mode).toBe("hidden");
    }
  });
});
