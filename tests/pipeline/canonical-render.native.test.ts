/**
 * Canonical render — native byte compatibility (Block 7G).
 *
 * The single non-negotiable regression: for a native-only deck and no (or an
 * empty) artifact map, `renderCanonicalDeckHtml` must produce exactly the
 * Phase 6 output, byte for byte.
 */

import { describe, expect, it } from "vitest";
import {
  applyDiagramEnginePreference,
  renderCanonicalDeckHtml,
  renderDeckHtml,
} from "../../src/index.js";
import { richDeck, sparseDeck } from "../helpers/decks.js";

describe("renderCanonicalDeckHtml — native byte compatibility", () => {
  it("undefined artifacts: byte-identical to renderDeckHtml (rich deck)", () => {
    const deck = richDeck();
    const canonical = renderCanonicalDeckHtml({ deck }).html;
    const legacy = renderDeckHtml(deck).html;
    expect(canonical).toBe(legacy);
  });

  it("undefined artifacts: byte-identical to renderDeckHtml (sparse deck)", () => {
    const deck = sparseDeck();
    expect(renderCanonicalDeckHtml({ deck }).html).toBe(renderDeckHtml(deck).html);
  });

  it("an empty map is byte-identical too", () => {
    const deck = richDeck();
    expect(renderCanonicalDeckHtml({ deck, diagramArtifacts: new Map() }).html).toBe(
      renderDeckHtml(deck).html,
    );
  });

  it("a native-preferred deck renders identically through both surfaces", () => {
    const requested = applyDiagramEnginePreference(richDeck(), { preference: "native" });
    expect(renderCanonicalDeckHtml({ deck: requested }).html).toBe(renderDeckHtml(requested).html);
  });

  it("a visual-engine-requested diagram without an artifact is fatal (no placeholder in canonical surfaces)", () => {
    const requested = applyDiagramEnginePreference(richDeck(), { preference: "visual" });
    expect(() => renderCanonicalDeckHtml({ deck: requested })).toThrow();
  });

  it("a stale artifact (spec edited after resolution) is fatal", async () => {
    const { resolveDiagramEngines } = await import("../../src/index.js");
    const requested = applyDiagramEnginePreference(richDeck(), { preference: "visual" });
    const { diagramArtifacts } = await resolveDiagramEngines(requested);
    const tampered = applyDiagramEnginePreference(requested, { preference: "visual" });
    const arch = tampered.diagrams.find((d) => d.id === "dgm-arch");
    if (arch === undefined) throw new Error("missing diagram");
    const nodes = (arch.spec as { nodes: Array<{ label: string }> }).nodes;
    const first = nodes[0];
    if (first === undefined) throw new Error("missing node");
    first.label = "Something else";
    expect(() => renderCanonicalDeckHtml({ deck: tampered, diagramArtifacts })).toThrow(
      expect.objectContaining({ code: "delivery/diagram-artifact-stale" }),
    );
  });

  it("an extra artifact (unknown diagram id) is fatal", async () => {
    const { resolveDiagramEngines } = await import("../../src/index.js");
    const requested = applyDiagramEnginePreference(richDeck(), { preference: "visual" });
    const { diagramArtifacts } = await resolveDiagramEngines(requested);
    const extra = new Map(diagramArtifacts);
    const first = diagramArtifacts.get("dgm-arch");
    if (first === undefined) throw new Error("missing artifact");
    extra.set("dgm-ghost", { ...first, diagramId: "dgm-ghost" });
    expect(() => renderCanonicalDeckHtml({ deck: requested, diagramArtifacts: extra })).toThrow(
      expect.objectContaining({ code: "delivery/diagram-artifact-extra" }),
    );
  });

  it("a tampered artifact map (key ≠ diagramId) is fatal", async () => {
    const { resolveDiagramEngines } = await import("../../src/index.js");
    const requested = applyDiagramEnginePreference(richDeck(), { preference: "visual" });
    const { diagramArtifacts } = await resolveDiagramEngines(requested);
    const broken = new Map(diagramArtifacts);
    const a = broken.get("dgm-arch");
    if (a === undefined) throw new Error("missing artifact");
    broken.set("dgm-arch", { ...a, diagramId: "dgm-other" });
    expect(() => renderCanonicalDeckHtml({ deck: requested, diagramArtifacts: broken })).toThrow(
      expect.objectContaining({ code: "delivery/diagram-artifact-mismatch" }),
    );
  });

  it("an artifact whose bytes no longer hash is fatal", async () => {
    const { resolveDiagramEngines } = await import("../../src/index.js");
    const requested = applyDiagramEnginePreference(richDeck(), { preference: "visual" });
    const { diagramArtifacts } = await resolveDiagramEngines(requested);
    const broken = new Map(diagramArtifacts);
    const a = broken.get("dgm-arch");
    if (a === undefined || a.kind !== "svg") throw new Error("expected svg artifact");
    broken.set("dgm-arch", { ...a, svg: `${a.svg}<!-- tampered -->` });
    expect(() => renderCanonicalDeckHtml({ deck: requested, diagramArtifacts: broken })).toThrow(
      expect.objectContaining({ code: "delivery/diagram-artifact-mismatch" }),
    );
  });

  it("an artifact claiming a different engine identity is fatal", async () => {
    const { resolveDiagramEngines } = await import("../../src/index.js");
    const requested = applyDiagramEnginePreference(richDeck(), { preference: "visual" });
    const { diagramArtifacts } = await resolveDiagramEngines(requested);
    const broken = new Map(diagramArtifacts);
    const a = broken.get("dgm-arch");
    if (a === undefined || a.kind !== "svg") throw new Error("expected svg artifact");
    broken.set("dgm-arch", { ...a, engineCommit: "0".repeat(40) });
    expect(() => renderCanonicalDeckHtml({ deck: requested, diagramArtifacts: broken })).toThrow(
      expect.objectContaining({ code: "delivery/diagram-artifact-mismatch" }),
    );
  });

  it("a title-only change makes the artifact stale (diagramRenderInputHash, not just specHash)", async () => {
    const { resolveDiagramEngines } = await import("../../src/index.js");
    const requested = applyDiagramEnginePreference(richDeck(), { preference: "visual" });
    const { diagramArtifacts } = await resolveDiagramEngines(requested);
    const renamed = applyDiagramEnginePreference(requested, { preference: "visual" });
    const arch = renamed.diagrams.find((d) => d.id === "dgm-arch");
    if (arch === undefined) throw new Error("missing diagram");
    arch.title = "A different title (same spec)";
    expect(() => renderCanonicalDeckHtml({ deck: renamed, diagramArtifacts })).toThrow(
      expect.objectContaining({ code: "delivery/diagram-artifact-stale" }),
    );
  });

  it("a caller-supplied SVG artifact is revalidated from bytes (fake entity id is fatal)", async () => {
    const { resolveDiagramEngines } = await import("../../src/index.js");
    const { sha256Hex } = await import("../../src/determinism/hash.js");
    const requested = applyDiagramEnginePreference(richDeck(), { preference: "visual" });
    const { diagramArtifacts } = await resolveDiagramEngines(requested);
    const forged = new Map(diagramArtifacts);
    const a = forged.get("dgm-arch");
    if (a === undefined || a.kind !== "svg") throw new Error("expected svg artifact");
    const svg = a.svg.replace('data-entity-id="cmp-api"', 'data-entity-id="cmp-adversary"');
    forged.set("dgm-arch", { ...a, svg, svgSha256: sha256Hex(svg) });
    expect(() => renderCanonicalDeckHtml({ deck: requested, diagramArtifacts: forged })).toThrow(
      expect.objectContaining({ code: "delivery/diagram-artifact-mismatch" }),
    );
  });

  it("an svg artifact attached to a non-visual-engine diagram is fatal", async () => {
    const { resolveDiagramEngines } = await import("../../src/index.js");
    const requested = applyDiagramEnginePreference(richDeck(), { preference: "visual" });
    const { diagramArtifacts } = await resolveDiagramEngines(requested);
    // now flip the diagram back to native but keep the artifact
    const nativeDeck = applyDiagramEnginePreference(requested, { preference: "native" });
    expect(() => renderCanonicalDeckHtml({ deck: nativeDeck, diagramArtifacts })).toThrow(
      expect.objectContaining({ code: "delivery/diagram-artifact-mismatch" }),
    );
  });
});
