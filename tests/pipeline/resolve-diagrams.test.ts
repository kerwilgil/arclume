/** Diagram engine resolver — observational contract. */

import { describe, expect, it } from "vitest";
import {
  applyDiagramEnginePreference,
  contentHash,
  resolveDiagramEngines,
} from "../../src/index.js";
import { diagramOf, richDeck } from "../helpers/decks.js";

describe("resolveDiagramEngines", () => {
  it("never mutates the deck (contentHash is invariant)", async () => {
    const requested = applyDiagramEnginePreference(richDeck(), { preference: "auto" });
    const before = contentHash(requested);
    const beforeRef = requested.diagrams.map((d) => d.engine).join(",");
    await resolveDiagramEngines(requested);
    expect(contentHash(requested)).toBe(before);
    expect(requested.diagrams.map((d) => d.engine).join(",")).toBe(beforeRef);
  });

  it("resolves architecture and workflow through the visual engine", async () => {
    const requested = applyDiagramEnginePreference(richDeck(), { preference: "auto" });
    const { diagramArtifacts, report } = await resolveDiagramEngines(requested);

    const arch = diagramArtifacts.get("dgm-arch");
    expect(arch?.kind).toBe("svg");
    expect(arch?.engineUsed).toBe("visual");
    const flow = diagramArtifacts.get("dgm-flow");
    expect(flow?.kind).toBe("svg");
    expect(flow?.engineUsed).toBe("visual");
    // native-only diagrams carry no artifact
    expect(diagramArtifacts.has("dgm-seq")).toBe(false);

    const byId = new Map(report.diagrams.map((d) => [d.diagramId, d]));
    expect(byId.get("dgm-arch")?.outcome).toBe("resolved");
    expect(byId.get("dgm-flow")?.outcome).toBe("resolved");
    expect(byId.get("dgm-seq")?.outcome).toBe("native");
    expect(report.engines.visual.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(report.engines.visual.commit).toMatch(/^[0-9a-f]{40}$/);
    // deterministic order
    expect(report.diagrams.map((d) => d.diagramId)).toEqual(
      [...report.diagrams.map((d) => d.diagramId)].sort(),
    );
  });

  it("native preference → a zero-subprocess resolution", async () => {
    const requested = applyDiagramEnginePreference(richDeck(), { preference: "native" });
    const { diagramArtifacts, report } = await resolveDiagramEngines(requested);
    expect(diagramArtifacts.size).toBe(0);
    expect(report.diagrams.every((d) => d.outcome === "native")).toBe(true);
  });

  it("a 7-step workflow falls back to native with a loud report entry", async () => {
    const deck = richDeck();
    const flow = diagramOf(deck, "dgm-flow");
    const steps = Array.from({ length: 7 }, (_, i) => ({
      id: `s-${i}`,
      label: `Step ${i}`,
      index: i,
      ref: `proc-${i}`,
    }));
    flow.spec = {
      format: "arclume.native.v1",
      kind: "process",
      steps,
      edges: steps.slice(0, -1).map((s, i) => ({
        id: `e-${i}`,
        relationId: `rel-${i}`,
        from: s.id,
        to: (steps[i + 1] as { id: string }).id,
      })),
    };
    const requested = applyDiagramEnginePreference(deck, { preference: "auto" });
    const { diagramArtifacts, report } = await resolveDiagramEngines(requested);

    const artifact = diagramArtifacts.get("dgm-flow");
    expect(artifact).toMatchObject({
      kind: "native-fallback",
      engineRequested: "visual",
      engineUsed: "native",
      code: "visual-engine/layout-capacity",
    });
    const entry = report.diagrams.find((d) => d.diagramId === "dgm-flow");
    expect(entry?.outcome).toBe("fallback");
    expect(entry?.code).toBe("visual-engine/layout-capacity");
    expect(artifact?.warnings.some((w) => w.code === "visual-engine/fallback-native")).toBe(true);
  });

  it("fallbackOnError: false turns even capacity failures fatal", async () => {
    const deck = richDeck();
    const flow = diagramOf(deck, "dgm-flow");
    const steps = Array.from({ length: 7 }, (_, i) => ({
      id: `s-${i}`,
      label: `S${i}`,
      index: i,
      ref: `proc-${i}`,
    }));
    flow.spec = { format: "arclume.native.v1", kind: "process", steps, edges: [] };
    const requested = applyDiagramEnginePreference(deck, { preference: "auto" });
    await expect(
      resolveDiagramEngines(requested, { fallbackOnError: false }),
    ).rejects.toMatchObject({ code: "visual-engine/layout-capacity" });
  });

  it("integrity failures NEVER fall back (adapter-invalid-input)", async () => {
    const deck = richDeck();
    const arch = diagramOf(deck, "dgm-arch");
    arch.spec = { format: "arclume.native.v1", kind: "architecture", nodes: [], edges: [] };
    const requested = applyDiagramEnginePreference(deck, { preference: "auto" });
    await expect(resolveDiagramEngines(requested)).rejects.toMatchObject({
      code: "visual-engine/adapter-invalid-input",
    });
    await expect(
      resolveDiagramEngines(requested, { fallbackOnError: false }),
    ).rejects.toMatchObject({ code: "visual-engine/adapter-invalid-input" });
  });

  it("is deterministic across runs", async () => {
    const requested = applyDiagramEnginePreference(richDeck(), { preference: "auto" });
    const a = await resolveDiagramEngines(requested);
    const b = await resolveDiagramEngines(requested);
    for (const [id, artifact] of a.diagramArtifacts) {
      const other = b.diagramArtifacts.get(id);
      expect(other).toBeDefined();
      if (artifact.kind === "svg" && other?.kind === "svg") {
        expect(artifact.svg).toBe(other.svg);
        expect(artifact.svgSha256).toBe(other.svgSha256);
      }
    }
  });
});
