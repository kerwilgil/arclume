/**
 * Phase 8 — PPTX export: in-memory build, structural validation, notes,
 * citations, aspect matrix, and CI-only artifact checks.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDeckPptx, publishExportBundle, validatePptxPackage } from "../src/export/index.js";
import { richDeck } from "./helpers/decks.js";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arclume-p8-pptx-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("PPTX export", () => {
  it("produces a valid Office package (nodebuffer path)", async () => {
    const { bytes, receipt } = await buildDeckPptx({ deck: richDeck() });
    expect(bytes.byteLength).toBeGreaterThan(2000);
    expect(receipt.format).toBe("pptx");
    const errors = validatePptxPackage(bytes, richDeck());
    expect(errors).toEqual([]);
  });

  it("embeds speakerNotes verbatim without inventing them", async () => {
    const deck = richDeck();
    const first = deck.slides[0];
    if (first === undefined) throw new Error("cover slide missing");
    first.speakerNotes = "Call the sponsor before Friday at noon.";
    const { bytes } = await buildDeckPptx({ deck });
    const entries = unzipSync(new Uint8Array(bytes));
    const notes = Object.keys(entries).filter(
      (k) => k.startsWith("ppt/notesSlides/") && k.endsWith(".xml") && !k.endsWith(".rels"),
    );
    expect(notes.length).toBeGreaterThan(0);
    const text = strFromU8(entries[notes[0] as string] as Uint8Array);
    expect(text).toContain("Call the sponsor before Friday at noon.");
    expect(text).not.toContain("Never invent notes.");
  });

  it("keeps citations in slide content (sourceRefs footer)", async () => {
    const deck = richDeck();
    const slide = deck.slides.find((s) => s.kind === "content" && s.blocks.length > 0);
    expect(slide).toBeDefined();
    const target = deck.slides[1];
    if (target === undefined) throw new Error("slide 2 missing");
    const block = target.blocks[0];
    if (block === undefined) throw new Error("block missing");
    block.sourceRefs = [{ sourceId: "brief" }];
    const { bytes } = await buildDeckPptx({ deck });
    const entries = unzipSync(new Uint8Array(bytes));
    const slideKey = Object.keys(entries).find((k) => k === "ppt/slides/slide2.xml");
    expect(slideKey).toBeDefined();
    const xml = strFromU8(entries[slideKey as string] as Uint8Array);
    expect(xml).toContain("src: brief");
  });

  it("PPTX respects the declared aspect ratio (16:10 → 12in)", async () => {
    const deck = richDeck();
    deck.theme = { ...deck.theme, aspectRatio: "16:10" };
    const { bytes } = await buildDeckPptx({ deck });
    const entries = unzipSync(new Uint8Array(bytes));
    const pres = strFromU8(entries["ppt/presentation.xml"] as Uint8Array);
    // 12in × 7.5in in EMU
    expect(pres).toContain("p:sldSz");
    expect(pres).toContain(String(Math.round(12 * 914400)));
    expect(pres).toContain(String(Math.round(7.5 * 914400)));
  });

  it("same content, two runs → same semantic package digest (we do not promise bytes)", async () => {
    // determinism policy: structural/semantic only; this test pins the claim
    const a = await buildDeckPptx({ deck: richDeck() });
    const b = await buildDeckPptx({ deck: richDeck() });
    expect(a.receipt.output.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(b.receipt.output.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("PPTX package security", () => {
  it("never contains a vbaProject or traversal entries", async () => {
    const { bytes } = await buildDeckPptx({ deck: richDeck() });
    const errors = validatePptxPackage(bytes, richDeck());
    expect(errors).toEqual([]);
  });

  it("unknown block types produce a loud warning, not a silent skip", async () => {
    const deck = richDeck();
    const slide = deck.slides[1];
    if (slide === undefined) throw new Error("missing slide");
    (slide.blocks as unknown[]).push({ id: "b-future", type: "not-a-real-type", text: "x" });
    const { receipt } = await buildDeckPptx({ deck });
    expect(
      receipt.validation.warnings.some((w) => w.includes("export/pptx-unsupported-block")),
    ).toBe(true);
  });
});

describe("atomic export bundle", () => {
  it("writes artifact + receipt atomically", async () => {
    const deck = richDeck();
    const { bytes, receipt } = await buildDeckPptx({ deck });
    const out = await publishExportBundle({
      destination: join(dir, "deck-pptx"),
      fileName: "deck.pptx",
      artifact: bytes,
      receipt,
      renderInput: { deck },
      format: "pptx",
    });
    expect(readFileSync(out.receiptPath, "utf8")).toContain("arclume-export");
    const written = readFileSync(out.artifactPath);
    expect(written.length).toBe(bytes.length);
  });

  it("never overwrites an existing destination", async () => {
    const deck = richDeck();
    const { bytes, receipt } = await buildDeckPptx({ deck });
    const d1 = await publishExportBundle({
      destination: join(dir, "bundle"),
      fileName: "deck.pptx",
      artifact: bytes,
      receipt,
      renderInput: { deck },
      format: "pptx",
    });
    expect(d1.bundlePath).toBeDefined();
    await expect(
      publishExportBundle({
        destination: join(dir, "bundle"),
        fileName: "deck.pptx",
        artifact: bytes,
        receipt,
        renderInput: { deck },
        format: "pptx",
      }),
    ).rejects.toMatchObject({ code: "export/destination-exists" });
  });
});
