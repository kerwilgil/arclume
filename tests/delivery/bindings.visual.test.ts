/**
 * Delivery binding with resolved diagram artifacts (Block 7G).
 *
 * Every tampering is fatal BEFORE staging — nothing below touches the
 * filesystem.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  VISUAL_ENGINE_COMMIT,
  VISUAL_ENGINE_VENDORED,
  applyDiagramEnginePreference,
  buildVisualQaReceipt,
  contentHash,
  renderCanonicalDeckHtml,
  resolveDiagramEngines,
  validateDeliveryBindings,
  visualEngineIdentity,
} from "../../src/index.js";
import type {
  DeliveryArtifactInput,
  ResolvedDiagramArtifact,
  ScreenshotDescriptor,
  VisualQaReceipt,
  VisualQaResult,
} from "../../src/index.js";
import { richDeck } from "../helpers/decks.js";

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==",
  "base64",
);
const sha256Utf8 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

function shot(name: string, index: number) {
  const sha256 = createHash("sha256").update(PNG_1x1).digest("hex");
  const descriptor: ScreenshotDescriptor = {
    viewport: "desktop-1440x900",
    slideId: name,
    index,
    kind: "slide",
    width: 1,
    height: 1,
    bytes: PNG_1x1.length,
    sha256,
    path: `screenshots/${name}.png`,
  };
  return { ...descriptor, buffer: PNG_1x1 };
}

function fakeResult(htmlSha256: string): VisualQaResult {
  return {
    version: "0.1.0",
    valid: true,
    browser: { name: "chromium", version: "151.0.0.0", platform: "linux", deviceScaleFactor: 1 },
    input: { htmlSha256 },
    viewports: [
      {
        viewport: "desktop-1440x900",
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        slideCount: 2,
        findings: 0,
        errors: 0,
        warnings: 0,
        info: 0,
      },
    ],
    findings: [],
    screenshots: [shot("slide-001-a", 1), shot("slide-002-b", 2)],
    summary: { errors: 0, warnings: 0, info: 0 },
  };
}

async function coherent(): Promise<
  DeliveryArtifactInput & Required<Pick<DeliveryArtifactInput, "diagramArtifacts">>
> {
  const deck = applyDiagramEnginePreference(richDeck(), { preference: "auto" });
  const { diagramArtifacts } = await resolveDiagramEngines(deck);
  const { html } = renderCanonicalDeckHtml({ deck, diagramArtifacts });
  const result = fakeResult(sha256Utf8(html));
  const receipt = buildVisualQaReceipt({
    result,
    html,
    deckIrVersion: deck.irVersion,
    deckContentHash: contentHash(deck).slice("sha256:".length),
    configHash: "0".repeat(64),
    engines: { visual: { version: "2.16.0", commit: "c826e6c3a7abad19c0f3cd1ca57207d54b1ad8de" } },
  });
  return {
    deck,
    html,
    visualQa: result,
    receipt,
    screenshots: [shot("slide-001-a", 1), shot("slide-002-b", 2)],
    diagramArtifacts,
  };
}

const code = async (fn: () => unknown): Promise<string> => {
  try {
    await fn();
  } catch (err) {
    return (err as { code?: string }).code ?? "thrown-without-code";
  }
  return "did-not-throw";
};

describe("delivery bindings with diagram artifacts", () => {
  it("a coherent artifact-bound delivery passes the preflight", async () => {
    const input = await coherent();
    expect(() => validateDeliveryBindings(input)).not.toThrow();
  });

  it("dropping the artifact map fails before staging (diagram-artifact-missing)", async () => {
    const input = await coherent();
    // also drop the engine claim (the engine binding runs first and would be
    // the honest failure otherwise)
    const receipt = { ...input.receipt };
    delete (receipt as { engines?: unknown }).engines;
    const broken: DeliveryArtifactInput = { ...input, receipt, diagramArtifacts: undefined };
    expect(await code(async () => validateDeliveryBindings(broken))).toBe(
      "delivery/diagram-artifact-missing",
    );
  });

  it("wrong engine identity → delivery/diagram-artifact-mismatch", async () => {
    const input = await coherent();
    const tampered = new Map(input.diagramArtifacts);
    const a = tampered.get("dgm-arch");
    if (a?.kind !== "svg") throw new Error("expected svg artifact");
    tampered.set("dgm-arch", { ...a, engineCommit: "1".repeat(40) });
    expect(
      await code(async () => validateDeliveryBindings({ ...input, diagramArtifacts: tampered })),
    ).toBe("delivery/diagram-artifact-mismatch");
  });

  it("tampered SVG bytes → delivery/diagram-artifact-mismatch", async () => {
    const input = await coherent();
    const tampered = new Map(input.diagramArtifacts);
    const a = tampered.get("dgm-flow");
    if (a?.kind !== "svg") throw new Error("expected svg artifact");
    tampered.set("dgm-flow", { ...a, svg: a.svg.replace("data-step-id", "data-x") });
    expect(
      await code(async () => validateDeliveryBindings({ ...input, diagramArtifacts: tampered })),
    ).toBe("delivery/diagram-artifact-mismatch");
  });

  it("receipt engines.visual is bound to actual final usage (P1-3)", async () => {
    const input = await coherent();
    // sanity: dgm-arch IS produced by the visual engine; receipt must carry it
    const claim = input.receipt.engines?.visual;
    expect(claim?.version).toBe(VISUAL_ENGINE_VENDORED);
    expect(claim?.commit).toBe(VISUAL_ENGINE_COMMIT);
    expect(() => validateDeliveryBindings(input)).not.toThrow();
  });

  it("missing engines.visual on a visual-engine-produced deck is fatal", async () => {
    const input = await coherent();
    const receipt = { ...input.receipt } as VisualQaReceipt;
    delete receipt.engines;
    expect(await code(async () => validateDeliveryBindings({ ...input, receipt }))).toBe(
      "delivery/engine-receipt-mismatch",
    );
  });

  it("wrong engine version or commit in the receipt is fatal", async () => {
    const input = await coherent();
    const wrongVersion: VisualQaReceipt = {
      ...input.receipt,
      engines: { visual: { version: "0.0.0", commit: VISUAL_ENGINE_COMMIT } },
    };
    expect(
      await code(async () => validateDeliveryBindings({ ...input, receipt: wrongVersion })),
    ).toBe("delivery/engine-receipt-mismatch");

    const wrongCommit: VisualQaReceipt = {
      ...input.receipt,
      engines: { visual: { version: VISUAL_ENGINE_VENDORED, commit: "0".repeat(40) } },
    };
    expect(
      await code(async () => validateDeliveryBindings({ ...input, receipt: wrongCommit })),
    ).toBe("delivery/engine-receipt-mismatch");
  });

  it("a native-only deck cannot claim the visual engine in the receipt", async () => {
    const deck = richDeck(); // everything native
    const html = renderCanonicalDeckHtml({ deck }).html;
    const result = fakeResult(sha256Utf8(html));
    const receipt = buildVisualQaReceipt({
      result,
      html,
      deckIrVersion: deck.irVersion,
      deckContentHash: contentHash(deck).slice("sha256:".length),
      configHash: "0".repeat(64),
      engines: { visual: { version: VISUAL_ENGINE_VENDORED, commit: VISUAL_ENGINE_COMMIT } },
    });
    const input: DeliveryArtifactInput = {
      deck,
      html,
      visualQa: result,
      receipt,
      screenshots: [shot("slide-001-a", 1), shot("slide-002-b", 2)],
    };
    expect(await code(async () => validateDeliveryBindings(input))).toBe(
      "delivery/engine-receipt-mismatch",
    );
  });

  it("all-fallback deck cannot claim the visual engine in the receipt", async () => {
    const deck = richDeck();
    const flow = deck.diagrams.find((d) => d.id === "dgm-flow");
    if (flow === undefined) throw new Error("missing diagram");
    const steps = Array.from({ length: 7 }, (_, i) => ({
      id: `s-${i}`,
      label: `S${i}`,
      index: i,
      ref: `proc-${i}`,
    }));
    flow.spec = { format: "arclume.native.v1", kind: "process", steps, edges: [] };
    // force architecture to stay native so NO diagram ends up produced by the visual engine
    const arch = deck.diagrams.find((d) => d.id === "dgm-arch");
    if (arch !== undefined) arch.engine = "native";

    const requested = applyDiagramEnginePreference(deck, { preference: "auto" });
    const archReq = requested.diagrams.find((d) => d.id === "dgm-arch");
    if (archReq !== undefined) archReq.engine = "native";
    const { diagramArtifacts } = await resolveDiagramEngines(requested);
    expect(diagramArtifacts.get("dgm-flow")).toMatchObject({
      kind: "native-fallback",
      engineUsed: "native",
    });
    expect(visualEngineIdentity(diagramArtifacts)).toBeUndefined();

    const { html } = renderCanonicalDeckHtml({ deck: requested, diagramArtifacts });
    const result = fakeResult(sha256Utf8(html));
    const receipt = buildVisualQaReceipt({
      result,
      html,
      deckIrVersion: requested.irVersion,
      deckContentHash: contentHash(requested).slice("sha256:".length),
      configHash: "0".repeat(64),
      engines: { visual: { version: VISUAL_ENGINE_VENDORED, commit: VISUAL_ENGINE_COMMIT } },
    });
    const input: DeliveryArtifactInput = {
      deck: requested,
      html,
      visualQa: result,
      receipt,
      screenshots: [shot("slide-001-a", 1), shot("slide-002-b", 2)],
      diagramArtifacts,
    };
    expect(await code(async () => validateDeliveryBindings(input))).toBe(
      "delivery/engine-receipt-mismatch",
    );
  });

  it("a native-fallback artifact claiming an integrity code is fatal", async () => {
    const input = await coherent();
    const artifactsNullable = input.diagramArtifacts;
    if (artifactsNullable === undefined) throw new Error("expected artifacts");
    const artifacts: ReadonlyMap<string, ResolvedDiagramArtifact> = artifactsNullable;
    const real = artifacts.get("dgm-flow");
    if (real === undefined || real.kind !== "svg") throw new Error("expected svg artifact");
    const forged: ResolvedDiagramArtifact = {
      kind: "native-fallback",
      diagramId: "dgm-flow",
      engineRequested: "visual",
      engineUsed: "native",
      specHash: real.specHash,
      diagramRenderInputHash: real.diagramRenderInputHash,
      code: "visual-engine/unsafe-output",
      message: "pretend the engine was unsafe",
      warnings: [
        {
          code: "visual-engine/fallback-native",
          message: "forged",
          diagramId: "dgm-flow",
        },
      ],
    };
    const map = new Map(input.diagramArtifacts);
    map.set("dgm-flow", forged);
    expect(
      await code(async () => validateDeliveryBindings({ ...input, diagramArtifacts: map })),
    ).toMatch(/^delivery\/diagram-artifact-/);
  });

  it("a valid fallback with a fatal code hidden inside warnings is rejected", async () => {
    // real capacity failure → valid fallback artifact…
    const deck = richDeck();
    const flow = deck.diagrams.find((d) => d.id === "dgm-flow");
    if (flow === undefined) throw new Error("missing diagram");
    const steps = Array.from({ length: 7 }, (_, i) => ({
      id: `s-${i}`,
      label: `S${i}`,
      index: i,
      ref: `proc-${i}`,
    }));
    flow.spec = { format: "arclume.native.v1", kind: "process", steps, edges: [] };
    const arch = deck.diagrams.find((d) => d.id === "dgm-arch");
    if (arch !== undefined) arch.engine = "native";
    const requested = applyDiagramEnginePreference(deck, { preference: "auto" });
    const archReq = requested.diagrams.find((d) => d.id === "dgm-arch");
    if (archReq !== undefined) archReq.engine = "native";
    const { diagramArtifacts } = await resolveDiagramEngines(requested);
    const fallback = diagramArtifacts.get("dgm-flow");
    if (fallback === undefined || fallback.kind !== "native-fallback") {
      throw new Error("expected native-fallback artifact");
    }
    // …then an attacker hides an integrity failure inside warnings:
    const poisoned: ResolvedDiagramArtifact = {
      ...fallback,
      warnings: [
        ...fallback.warnings,
        { code: "visual-engine/unsafe-output", message: "x", diagramId: "dgm-flow" },
      ],
    };
    const map = new Map(diagramArtifacts);
    map.set("dgm-flow", poisoned);
    const { renderCanonicalDeckHtml } = await import("../../src/index.js");
    expect(() => renderCanonicalDeckHtml({ deck: requested, diagramArtifacts: map })).toThrow(
      expect.objectContaining({ code: "delivery/diagram-artifact-mismatch" }),
    );
  });

  it("a native-fallback artifact claiming a fatal code without the warning is fatal", async () => {
    // Even a *fallbackable* code must carry its loud fallback warning.
    const input = await coherent();
    const artifactsNullable = input.diagramArtifacts;
    if (artifactsNullable === undefined) throw new Error("expected artifacts");
    const artifacts: ReadonlyMap<string, ResolvedDiagramArtifact> = artifactsNullable;
    const real = artifacts.get("dgm-flow");
    if (real === undefined || real.kind !== "svg") throw new Error("expected svg artifact");
    const forged: ResolvedDiagramArtifact = {
      kind: "native-fallback",
      diagramId: "dgm-flow",
      engineRequested: "visual",
      engineUsed: "native",
      specHash: real.specHash,
      diagramRenderInputHash: real.diagramRenderInputHash,
      code: "visual-engine/layout-capacity",
      message: "forged capacity claim",
      warnings: [],
    };
    const map = new Map(input.diagramArtifacts);
    map.set("dgm-flow", forged);
    expect(
      await code(async () => validateDeliveryBindings({ ...input, diagramArtifacts: map })),
    ).toMatch(/^delivery\/diagram-artifact-/);
  });

  it("fallback artifact is coherent (only-flow deck: no visual engine produced output)", async () => {
    const deck = richDeck();
    // keep ONLY the workflow requesting the visual engine (so every other diagram is native)
    const arch = deck.diagrams.find((d) => d.id === "dgm-arch");
    if (arch !== undefined) arch.engine = "native";
    const flow = deck.diagrams.find((d) => d.id === "dgm-flow");
    if (flow === undefined) throw new Error("missing diagram");
    if (flow === undefined) throw new Error("missing diagram");
    const steps = Array.from({ length: 7 }, (_, i) => ({
      id: `s-${i}`,
      label: `S${i}`,
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
    // after the preference pass, hand the architecture diagram back to native
    const archReq = requested.diagrams.find((d) => d.id === "dgm-arch");
    if (archReq !== undefined) archReq.engine = "native";
    const { diagramArtifacts } = await resolveDiagramEngines(requested);
    const fallback: ResolvedDiagramArtifact | undefined = diagramArtifacts.get("dgm-flow");
    expect(fallback?.kind).toBe("native-fallback");
    const { html } = renderCanonicalDeckHtml({ deck: requested, diagramArtifacts });
    expect(html).toContain('data-diagram-id="dgm-flow" data-diagram-engine="native"');

    const result = fakeResult(sha256Utf8(html));
    const receipt = buildVisualQaReceipt({
      result,
      html,
      deckIrVersion: requested.irVersion,
      deckContentHash: contentHash(requested).slice("sha256:".length),
      configHash: "0".repeat(64),
    });
    // No visual engine claim in the receipt: nothing was produced by the visual engine…
    // (other diagrams may have been, so the caller decides; here the receipt
    //  simply has no engines field when none is passed)
    expect(receipt.engines).toBeUndefined();
    const input: DeliveryArtifactInput = {
      deck: requested,
      html,
      visualQa: result,
      receipt,
      screenshots: [shot("slide-001-a", 1), shot("slide-002-b", 2)],
      diagramArtifacts,
    };
    expect(() => validateDeliveryBindings(input)).not.toThrow();
  });
});
