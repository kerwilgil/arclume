/**
 * Phase 8 final trust-boundary: the PPTX package validator proves itself
 * against MUTATED packages, not just against PptxGenJS's clean output.
 * Every hostile mutation of a real exported bundle must be rejected with the
 * corresponding error code.
 */

import { Zip, ZipDeflate, strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";
import { buildDeckPptx, validatePptxPackage } from "../src/export/index.js";
import { richDeck } from "./helpers/decks.js";

let cleanBytes: Buffer;
const deck = richDeck();

beforeAll(async () => {
  const out = await buildDeckPptx({ deck });
  cleanBytes = out.bytes;
});

/** Unzip the clean package, mutate the part map, re-zip. */
function mutate(mutator: (parts: Record<string, Uint8Array>) => void): Buffer {
  const parts = unzipSync(new Uint8Array(cleanBytes)) as Record<string, Uint8Array>;
  mutator(parts);
  return Buffer.from(zipSync(parts));
}

/** Re-zip keeping duplicate entries (zip objects cannot carry them). */
function zipWithDuplicate(duplicateName: string): Buffer {
  const parts = unzipSync(new Uint8Array(cleanBytes)) as Record<string, Uint8Array>;
  const chunks: Uint8Array[] = [];
  const zip = new Zip((err, chunk) => {
    if (err) throw err;
    chunks.push(chunk);
  });
  for (const [name, data] of Object.entries(parts)) {
    if (name === "" || data.length === 0) {
      const f = new ZipDeflate(name);
      zip.add(f);
      f.push(new Uint8Array(0), true);
      continue;
    }
    const f = new ZipDeflate(name);
    zip.add(f);
    f.push(data, true);
  }
  void 0;
  const dup = new ZipDeflate(duplicateName);
  zip.add(dup);
  dup.push(strToU8("<forged/>"), true);
  zip.end();
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

describe("PPTX package validation — mutated hostile packages", () => {
  it('A: a _rels/.rels with TargetMode="External" is rejected', () => {
    const bytes = mutate((parts) => {
      const rels = strFromU8(parts["_rels/.rels"] as Uint8Array);
      parts["_rels/.rels"] = strToU8(rels.replace("/>", ' TargetMode="External"/>'));
    });
    const errors = validatePptxPackage(bytes, deck);
    expect(errors.some((e) => e.startsWith("export/pptx-external-relationship"))).toBe(true);
  });

  it("B: a slide rel pointing at missing media is rejected", () => {
    const bytes = mutate((parts) => {
      // find whichever slide actually references media
      const name = Object.keys(parts).find(
        (k) =>
          k.startsWith("ppt/slides/_rels/") &&
          strFromU8(parts[k] as Uint8Array).includes("../media/"),
      );
      if (name === undefined) throw new Error("no slide references media in this package");
      const rels = strFromU8(parts[name] as Uint8Array);
      parts[name] = strToU8(
        rels.replace(/Target="\.\.\/media\/[^"]+"/, 'Target="../media/gone.png"'),
      );
    });
    const errors = validatePptxPackage(bytes, deck);
    expect(errors.some((e) => e.startsWith("export/pptx-dangling-relationship"))).toBe(true);
  });

  it("C: presentation.xml with the wrong slide size is rejected", () => {
    const bytes = mutate((parts) => {
      const name = "ppt/presentation.xml";
      const pres = strFromU8(parts[name] as Uint8Array);
      const m = pres.match(/cx="(\d+)"/);
      if (m === null) throw new Error("no sldSz in package");
      parts[name] = strToU8(pres.replace(m[0], `cx="${Number(m[1]) + 91440}"`));
    });
    const errors = validatePptxPackage(bytes, deck);
    expect(errors.some((e) => e.startsWith("export/pptx-slide-size-mismatch"))).toBe(true);
  });

  it("D: an added ppt/activeX/activeX1.xml part is rejected", () => {
    const bytes = mutate((parts) => {
      parts["ppt/activeX/activeX1.xml"] = strToU8("<activeX/>");
    });
    const errors = validatePptxPackage(bytes, deck);
    expect(errors.some((e) => e.startsWith("export/pptx-activex"))).toBe(true);
  });

  it("E: an added ppt/embeddings/object.bin part is rejected", () => {
    const bytes = mutate((parts) => {
      parts["ppt/embeddings/object.bin"] = new Uint8Array([1, 2, 3]);
    });
    const errors = validatePptxPackage(bytes, deck);
    expect(errors.some((e) => e.startsWith("export/pptx-embedded-package"))).toBe(true);
  });

  it("a vbaProject part is rejected (macros)", () => {
    const bytes = mutate((parts) => {
      parts["ppt/vbaProject.bin"] = new Uint8Array([0xd0, 0xcf]);
    });
    const errors = validatePptxPackage(bytes, deck);
    expect(errors.some((e) => e.startsWith("export/pptx-macro"))).toBe(true);
  });

  it("an OLE object part is rejected", () => {
    const bytes = mutate((parts) => {
      parts["ppt/media/oleObject1.bin"] = new Uint8Array([0xd0, 0xcf]);
    });
    const errors = validatePptxPackage(bytes, deck);
    expect(errors.some((e) => e.startsWith("export/pptx-ole"))).toBe(true);
  });

  it("a traversal entry is rejected", () => {
    const bytes = mutate((parts) => {
      parts["../outside.xml"] = strToU8("<evil/>");
    });
    const errors = validatePptxPackage(bytes, deck);
    expect(errors.some((e) => e.startsWith("export/pptx-traversal"))).toBe(true);
  });

  it("a duplicate ZIP entry is rejected", () => {
    const bytes = zipWithDuplicate("ppt/slides/slide1.xml");
    const errors = validatePptxPackage(bytes, deck);
    expect(errors.some((e) => e.startsWith("export/pptx-duplicate-entry"))).toBe(true);
  });

  it("a slide target missing from presentation rels is rejected", () => {
    const bytes = mutate((parts) => {
      const name = "ppt/_rels/presentation.xml.rels";
      const rels = strFromU8(parts[name] as Uint8Array);
      parts[name] = strToU8(rels.replace('Target="slides/slide1.xml"', 'Target="slides/nope.xml"'));
    });
    const errors = validatePptxPackage(bytes, deck);
    expect(errors.some((e) => e.startsWith("export/pptx-dangling-relationship"))).toBe(true);
  });

  it("a missing notes target is rejected", () => {
    const bytes = mutate((parts) => {
      delete parts["ppt/notesSlides/notesSlide1.xml"];
    });
    const errors = validatePptxPackage(bytes, deck);
    expect(errors.some((e) => e.startsWith("export/pptx-dangling-relationship"))).toBe(true);
  });

  it("the unmutated clean package still validates", () => {
    expect(validatePptxPackage(cleanBytes, deck)).toEqual([]);
  });
});
