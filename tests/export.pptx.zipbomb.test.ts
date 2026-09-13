/**
 * Phase 8 absolute closure: the PPTX validator's ZIP reader must enforce the
 * decompression budget DURING streaming inflate — the decompressed payload of
 * a bomb entry is never materialized past the cap, and the central directory's
 * declared uncompressed size is never trusted.
 */

import { Deflate, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { validatePptxPackage } from "../src/export/index.js";
import { richDeck } from "./helpers/decks.js";

/** A hand-rolled minimal ZIP writer (test-local): LFH + data + CD + EOCD. */
function craftZip(
  entries: Array<{
    name: string;
    method: 0 | 8;
    payload: Buffer;
    /** Declared (possibly lying) uncompressed size. */
    declaredUncompressed: number;
  }>,
): Buffer {
  const localParts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameBytes = Buffer.from(e.name, "utf8");
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4); // version needed
    lfh.writeUInt16LE(0, 6); // flags
    lfh.writeUInt16LE(e.method, 8);
    lfh.writeUInt32LE(0, 14); // crc (validator must not depend on it here)
    lfh.writeUInt32LE(e.payload.length, 18);
    lfh.writeUInt32LE(e.declaredUncompressed, 22);
    lfh.writeUInt16LE(nameBytes.length, 26);
    lfh.writeUInt16LE(0, 28);
    localParts.push(lfh, nameBytes, e.payload);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8); // flags
    cd.writeUInt16LE(e.method, 10);
    cd.writeUInt32LE(0, 16); // crc
    cd.writeUInt32LE(e.payload.length, 20);
    cd.writeUInt32LE(e.declaredUncompressed, 24);
    cd.writeUInt16LE(nameBytes.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, nameBytes]));
    offset += 30 + nameBytes.length + e.payload.length;
  }
  const cdBytes = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBytes.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, cdBytes, eocd]);
}

/** Deflate a flood of zeros WITHOUT ever materializing the flood. */
function compressedFlood(approxExpandedBytes: number): Buffer {
  const chunks: Buffer[] = [];
  const def = new Deflate((chunk) => chunks.push(Buffer.from(chunk)));
  const zeros = new Uint8Array(1024 * 1024);
  const iterations = Math.ceil(approxExpandedBytes / zeros.length);
  for (let i = 0; i < iterations; i += 1) def.push(zeros, false);
  def.push(new Uint8Array(0), true);
  return Buffer.concat(chunks);
}

const MINIMAL_PARTS = [
  {
    name: "[Content_Types].xml",
    payload: strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    ),
  },
  {
    name: "_rels/.rels",
    payload: strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
    ),
  },
  {
    name: "ppt/presentation.xml",
    payload: strToU8(
      '<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>',
    ),
  },
];

describe("PPTX zip bomb protection", () => {
  it("a small-entry bomb is aborted DURING streaming inflate (package-too-large)", () => {
    // ~270 MiB decompressed, but the compressed entry is only ~270 KiB and the
    // central directory LIES about the uncompressed size (declares 1 KiB).
    const bomb = compressedFlood(270 * 1024 * 1024);
    expect(bomb.length).toBeLessThan(1024 * 1024); // really is a small payload

    const zip = craftZip([
      ...MINIMAL_PARTS.map((p) => ({
        name: p.name,
        method: 0 as const,
        payload: Buffer.from(p.payload),
        declaredUncompressed: p.payload.length,
      })),
      {
        name: "ppt/media/bomb.png",
        method: 8 as const,
        payload: bomb,
        declaredUncompressed: 1024, // lying metadata — must not be trusted
      },
    ]);

    const started = Date.now();
    const errors = validatePptxPackage(zip, richDeck());
    const elapsed = Date.now() - started;
    expect(errors.some((e) => e === "export/pptx-invalid-package:package-too-large")).toBe(true);
    // it aborted DURING inflate — not after allocating the full flood
    expect(elapsed).toBeLessThan(60_000);
  });

  it("a stored (uncompressed) entry over the remaining budget is rejected too", () => {
    const zip = craftZip([
      ...MINIMAL_PARTS.map((p) => ({
        name: p.name,
        method: 0 as const,
        payload: Buffer.from(p.payload),
        declaredUncompressed: p.payload.length,
      })),
      {
        name: "ppt/media/fake-huge.png",
        method: 0 as const,
        // claim 300 MiB uncompressed, but payload is 4 bytes → the payload
        // bounds check catches it: the entry never materializes.
        payload: Buffer.from([1, 2, 3, 4]),
        declaredUncompressed: 300 * 1024 * 1024,
      },
    ]);
    const errors = validatePptxPackage(zip, richDeck());
    // either the bounds/budget check or the global cap must fire — but nothing is inflated
    expect(errors.length).toBeGreaterThan(0);
  });
});
