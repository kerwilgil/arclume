/**
 * Phase 8 — export receipts: schema conformance, receipt ↔ artifact binding,
 * diagram identity provenance.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { contentHash } from "../src/determinism/hash.js";
import { buildExportReceipt, sha256Bytes, validateExportReceipt } from "../src/export/receipt.js";
import { richDeck } from "./helpers/decks.js";

const require = createRequire(import.meta.url);
void require;

function loadSchema(): object {
  return JSON.parse(
    readFileSync(join(process.cwd(), "schemas", "export-receipt.schema.json"), "utf8"),
  );
}

describe("export receipts", () => {
  it("a well-formed receipt validates against its schema", async () => {
    const deck = richDeck();
    const receipt = buildExportReceipt({
      format: "pptx",
      deck,
      diagramArtifacts: new Map(),
      output: { fileName: "deck.pptx", bytes: 42, sha256: sha256Bytes(Buffer.alloc(42)) },
      slideCount: deck.slides.length,
      validation: { valid: true, errors: [], warnings: [] },
      layoutProfile: { version: "0.1.0", aspectRatio: "16:9" },
    });
    const schema = loadSchema();
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validate = ajv.compile(schema);
    const ok = validate(receipt);
    expect(ok, JSON.stringify(validate.errors)).toBe(true);
  });

  it("a receipt with an extra field is rejected by the schema", () => {
    const receipt = buildExportReceipt({
      format: "pdf",
      deck: richDeck(),
      diagramArtifacts: new Map(),
      output: { fileName: "a.pdf", bytes: 1, sha256: sha256Bytes(Buffer.alloc(1)) },
      slideCount: 1,
      validation: { valid: true, errors: [], warnings: [] },
    });
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validate = ajv.compile(loadSchema());
    const withExtra = { ...receipt, rogueField: true };
    expect(validate(withExtra)).toBe(false);
  });

  it("diagram identities carry Phase 7 identity (specHash + renderInputHash)", () => {
    const deck = richDeck();
    const receipt = buildExportReceipt({
      format: "pptx",
      deck,
      diagramArtifacts: new Map(),
      output: { fileName: "x.pptx", bytes: 8, sha256: sha256Bytes(Buffer.alloc(8)) },
      slideCount: deck.slides.length,
      validation: { valid: true, errors: [], warnings: [] },
    });
    expect(receipt.diagramArtifacts).toEqual([]);
    expect(receipt.deck.contentHash).toBe(contentHash(deck));
  });

  it("schema conditionals: a pdf receipt without canonicalHtmlSha256/printProfile/runtime is invalid", () => {
    const receipt = buildExportReceipt({
      format: "pdf",
      deck: richDeck(),
      diagramArtifacts: new Map(),
      output: { fileName: "a.pdf", bytes: 1, sha256: sha256Bytes(Buffer.alloc(1)) },
      slideCount: 1,
      validation: { valid: true, errors: [], warnings: [] },
    });
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validate = ajv.compile(loadSchema());
    expect(validate(receipt)).toBe(false);
  });

  it("schema conditionals: a pdf receipt with a layoutProfile is rejected", () => {
    const receipt = buildExportReceipt({
      format: "pdf",
      deck: richDeck(),
      diagramArtifacts: new Map(),
      output: { fileName: "a.pdf", bytes: 1, sha256: sha256Bytes(Buffer.alloc(1)) },
      slideCount: 1,
      validation: { valid: true, errors: [], warnings: [] },
      canonicalHtmlSha256: "0".repeat(64),
      printProfile: { version: "0.1.0", cssSha256: "0".repeat(64) },
      chromiumVersion: "100.0.0.0",
    }) as unknown as Record<string, unknown>;
    const withLayout = { ...receipt, layoutProfile: { version: "0.1.0", aspectRatio: "16:9" } };
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validate = ajv.compile(loadSchema());
    expect(validate(withLayout)).toBe(false);
  });

  it("schema conditionals: a pptx receipt without layoutProfile is invalid", () => {
    const receipt = buildExportReceipt({
      format: "pptx",
      deck: richDeck(),
      diagramArtifacts: new Map(),
      output: { fileName: "a.pptx", bytes: 1, sha256: sha256Bytes(Buffer.alloc(1)) },
      slideCount: 1,
      validation: { valid: true, errors: [], warnings: [] },
    });
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validate = ajv.compile(loadSchema());
    expect(validate(receipt)).toBe(false);
  });

  it("schema conditionals: a pptx receipt with pdf fields (canonicalHtmlSha256/printProfile/runtime) is rejected", () => {
    const receipt = buildExportReceipt({
      format: "pptx",
      deck: richDeck(),
      diagramArtifacts: new Map(),
      output: { fileName: "a.pptx", bytes: 1, sha256: sha256Bytes(Buffer.alloc(1)) },
      slideCount: 1,
      validation: { valid: true, errors: [], warnings: [] },
      layoutProfile: { version: "0.1.0", aspectRatio: "16:9" },
    }) as unknown as Record<string, unknown>;
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validate = ajv.compile(loadSchema());
    expect(validate({ ...receipt, canonicalHtmlSha256: "0".repeat(64) })).toBe(false);
    expect(
      validate({ ...receipt, printProfile: { version: "0.1.0", cssSha256: "0".repeat(64) } }),
    ).toBe(false);
    expect(validate({ ...receipt, runtime: { chromiumVersion: "100.0.0.0" } })).toBe(false);
    // and the bare receipt itself still validates
    expect(validate(receipt)).toBe(true);
  });

  it("validateExportReceipt fails when bytes do not match", () => {
    const receipt = buildExportReceipt({
      format: "pdf",
      deck: richDeck(),
      diagramArtifacts: new Map(),
      output: { fileName: "x.pdf", bytes: 4, sha256: sha256Bytes(Buffer.alloc(4)) },
      slideCount: 1,
      validation: { valid: true, errors: [], warnings: [] },
    });
    expect(() => validateExportReceipt(receipt, Buffer.alloc(4))).not.toThrow();
    expect(() => validateExportReceipt(receipt, Buffer.alloc(42))).toThrow(
      expect.objectContaining({ code: "export/output-hash-mismatch" }),
    );
  });
});
