/**
 * Phase 8 final trust-boundary: export receipt ↔ render input ↔ artifact
 * binding. A receipt with perfectly correct deck hash + artifact bytes but a
 * FAKE `diagramArtifacts` claim must be rejected before any rename — and the
 * destination must never exist.
 */

import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateExportBindings } from "../src/export/bindings.js";
import { buildDeckPptx, publishExportBundle } from "../src/export/index.js";
import { EXPORT_RECEIPT_VERSION } from "../src/export/receipt.js";
import type { ExportReceipt } from "../src/export/types.js";
import { applyDiagramEnginePreference, resolveDiagramEngines } from "../src/index.js";
import { richDeck } from "./helpers/decks.js";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arclume-bindings-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function visualEngineBundle() {
  const deck = applyDiagramEnginePreference(richDeck(), { preference: "auto" });
  const { diagramArtifacts } = await resolveDiagramEngines(deck);
  const renderInput = { deck, diagramArtifacts };
  const { bytes, receipt } = await buildDeckPptx({ deck, diagramArtifacts });
  return { deck, diagramArtifacts, renderInput, bytes, receipt };
}

describe("export receipt diagram provenance binding", () => {
  it("an intact visual engine PPTX receipt passes binding", async () => {
    const { renderInput, bytes, receipt } = await visualEngineBundle();
    expect(receipt.diagramArtifacts.length).toBeGreaterThan(0);
    expect(() =>
      validateExportBindings({ format: "pptx", renderInput, artifact: bytes, receipt }),
    ).not.toThrow();
  });

  const cloneReceipt = (r: ExportReceipt): ExportReceipt =>
    JSON.parse(JSON.stringify(r)) as ExportReceipt;

  const expectedNoMatch = async (mutate: (r: ExportReceipt) => void) => {
    const { renderInput, bytes, receipt } = await visualEngineBundle();
    const forged = cloneReceipt(receipt);
    mutate(forged);
    expect(() =>
      validateExportBindings({ format: "pptx", renderInput, artifact: bytes, receipt: forged }),
    ).toThrow(expect.objectContaining({ code: "delivery/export-binding-mismatch" }));
  };

  it("rejects a receipt with a missing diagram", async () => {
    await expectedNoMatch((r) => {
      r.diagramArtifacts.pop();
    });
  });

  it("rejects a receipt with an extra diagram", async () => {
    await expectedNoMatch((r) => {
      const first = r.diagramArtifacts[0];
      if (first === undefined) throw new Error("no diagram artifacts");
      r.diagramArtifacts.push({ ...first, diagramId: "dgm-not-real" });
    });
  });

  it("rejects a receipt with a wrong specHash", async () => {
    await expectedNoMatch((r) => {
      const first = r.diagramArtifacts[0];
      if (first === undefined) throw new Error("no diagram artifacts");
      first.specHash = `sha256:${"0".repeat(64)}`;
    });
  });

  it("rejects a receipt with a wrong svgSha256", async () => {
    await expectedNoMatch((r) => {
      const svgEntry = r.diagramArtifacts.find((d) => d.svgSha256 !== undefined);
      if (svgEntry === undefined) throw new Error("expected at least one svg artifact");
      svgEntry.svgSha256 = "f".repeat(64);
    });
  });

  it("rejects a receipt with a wrong fallbackCode claim", async () => {
    await expectedNoMatch((r) => {
      const svgEntry = r.diagramArtifacts.find((d) => d.svgSha256 !== undefined);
      if (svgEntry === undefined) throw new Error("expected at least one svg artifact");
      delete svgEntry.svgSha256;
      svgEntry.fallbackCode = "visual-engine/not-fallbackable";
    });
  });

  it("rejects swapped diagram identities", async () => {
    await expectedNoMatch((r) => {
      if (r.diagramArtifacts.length < 2) throw new Error("need ≥2 diagram artifacts");
      const a = r.diagramArtifacts[0];
      const b = r.diagramArtifacts[1];
      if (a === undefined || b === undefined) throw new Error("no diagram artifacts");
      r.diagramArtifacts[0] = b;
      r.diagramArtifacts[1] = a;
    });
  });

  it("rejects a duplicate diagramId", async () => {
    await expectedNoMatch((r) => {
      // keep the same length AND the same set, but one identity duplicated
      // (the last entry's payload replaced by the first's)
      const first = r.diagramArtifacts[0];
      const last = r.diagramArtifacts.length - 1;
      if (first === undefined || last < 1) throw new Error("need ≥2 diagram artifacts");
      r.diagramArtifacts[last] = { ...first };
    });
  });
});

describe("export receipt semantic binding", () => {
  it("rejects a format drift (receipt says pdf, expected pptx)", async () => {
    const { renderInput, bytes, receipt } = await visualEngineBundle();
    const forged: ExportReceipt = JSON.parse(JSON.stringify(receipt));
    forged.format = "pdf";
    expect(() =>
      validateExportBindings({ format: "pptx", renderInput, artifact: bytes, receipt: forged }),
    ).toThrow(expect.objectContaining({ code: "delivery/export-binding-mismatch" }));
  });

  it("rejects a wrong receiptVersion / exporter.name / exporter.version", async () => {
    const { renderInput, bytes, receipt } = await visualEngineBundle();
    for (const patch of [
      { receiptVersion: "9.9.9" },
      { exporter: { name: "not-arclume", version: receipt.exporter.version } },
      { exporter: { name: "arclume-export", version: "9.9.9" } },
      { deck: { ...receipt.deck, irVersion: "9.9.9" } },
      { validation: { ...receipt.validation, valid: false } },
    ] as const) {
      const forged = {
        ...(JSON.parse(JSON.stringify(receipt)) as Record<string, unknown>),
        ...patch,
      } as unknown as ExportReceipt;
      expect(() =>
        validateExportBindings({
          format: "pptx",
          renderInput,
          artifact: bytes,
          receipt: forged,
        }),
      ).toThrow(expect.objectContaining({ code: "delivery/export-binding-mismatch" }));
    }
  });

  it("a pptx receipt carrying pdf-only fields is rejected", async () => {
    const { renderInput, bytes, receipt } = await visualEngineBundle();
    const forged = {
      ...(JSON.parse(JSON.stringify(receipt)) as ExportReceipt),
      canonicalHtmlSha256: "0".repeat(64),
    };
    expect(() =>
      validateExportBindings({ format: "pptx", renderInput, artifact: bytes, receipt: forged }),
    ).toThrow(expect.objectContaining({ code: "delivery/export-binding-mismatch" }));
  });
});

describe("atomic publication with a falsified receipt (the critical case)", () => {
  it("rejects BEFORE rename when only diagramArtifacts[0].specHash is forged; no destination", async () => {
    const { renderInput, bytes, receipt } = await visualEngineBundle();
    // Correct sha/bytes/deck hash — ONLY the diagram provenance claim is fake.
    const forged = JSON.parse(JSON.stringify(receipt)) as ExportReceipt;
    const firstDiagram = forged.diagramArtifacts[0];
    if (firstDiagram === undefined) throw new Error("expected diagram artifacts");
    firstDiagram.specHash = `sha256:${"1".repeat(64)}`;

    const destination = join(dir, "forged-bundle");
    await expect(
      publishExportBundle({
        destination,
        fileName: "deck.pptx",
        artifact: bytes,
        receipt: forged,
        format: "pptx",
        renderInput,
      }),
    ).rejects.toMatchObject({ code: "delivery/export-binding-mismatch" });
    expect(existsSync(destination)).toBe(false);
    // no staging leftover either
    expect(readdirSync(dir).filter((n) => n.includes("staging"))).toEqual([]);
  });

  it("rejects BEFORE rename when only diagramArtifacts[0].svgSha256 is forged", async () => {
    const { renderInput, bytes, receipt } = await visualEngineBundle();
    const forged = JSON.parse(JSON.stringify(receipt)) as ExportReceipt;
    const target = forged.diagramArtifacts.findIndex((d) => d.svgSha256 !== undefined);
    expect(target).toBeGreaterThanOrEqual(0);
    const targetEntry = forged.diagramArtifacts[target];
    if (targetEntry === undefined) throw new Error("missing diagram entry");
    targetEntry.svgSha256 = "a".repeat(64);
    const destination = join(dir, "forged-bundle-svg");
    await expect(
      publishExportBundle({
        destination,
        fileName: "deck.pptx",
        artifact: bytes,
        receipt: forged,
        format: "pptx",
        renderInput,
      }),
    ).rejects.toMatchObject({ code: "delivery/export-binding-mismatch" });
    expect(existsSync(destination)).toBe(false);
  });

  it("a fully honest bundle publishes with exportId (not deliveryId)", async () => {
    const { renderInput, bytes, receipt } = await visualEngineBundle();
    expect(receipt.receiptVersion).toBe(EXPORT_RECEIPT_VERSION);
    const out = await publishExportBundle({
      destination: join(dir, "good-bundle"),
      fileName: "deck.pptx",
      artifact: bytes,
      receipt,
      format: "pptx",
      renderInput,
    });
    expect(out.exportId).toMatch(/^[0-9a-f]{32,64}$/);
    expect("deliveryId" in out).toBe(false);
  });
});

describe("exportId vocabulary", () => {
  it("export bundles use exportId (Phase 6 deliveryId does not leak into Phase 8)", async () => {
    const { renderInput, bytes, receipt } = await visualEngineBundle();
    const out = await publishExportBundle({
      destination: join(dir, "vocabulary-check"),
      fileName: "deck.pptx",
      artifact: bytes,
      receipt,
      format: "pptx",
      renderInput,
    });
    expect(typeof out.exportId).toBe("string");
  });
});
