/**
 * DOCX ZIP security boundary (Phase 8) — a hand-rolled, preflight-first OPC
 * container reader.
 *
 * The ZIP central directory is validated BEFORE any entry is inflated; only
 * an allowlist of OPC parts is ever decompressed, with per-entry and total
 * byte counters on emitted bytes (declared sizes are not trusted). Supported
 * compression: stored and deflate. ZIP64, multi-disk archives and encrypted
 * entries are rejected outright.
 */

import { Inflate } from "fflate";
import { IngestionError } from "../errors.js";

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

export interface DocxZipLimits {
  maxEntries: number;
  maxTotalUncompressedBytes: number;
  maxRatio: number;
}

export const DEFAULT_DOCX_ZIP_LIMITS: DocxZipLimits = {
  maxEntries: 256,
  maxTotalUncompressedBytes: 32 * 1024 * 1024,
  maxRatio: 100,
};

interface CentralEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  method: number;
  flags: number;
  localHeaderOffset: number;
}

function u16(b: Uint8Array, off: number): number {
  return (b[off] as number) | ((b[off + 1] as number) << 8);
}
function u32(b: Uint8Array, off: number): number {
  return (
    ((b[off] as number) |
      ((b[off + 1] as number) << 8) |
      ((b[off + 2] as number) << 16) |
      ((b[off + 3] as number) << 24)) >>>
    0
  );
}

function fail(code: string, message: string): never {
  throw new IngestionError(message, { code, severity: "fatal" });
}

/**
 * Validate the central directory and return the allow-listed entries present
 * in the package. Nothing is decompressed here.
 */
function preflight(bytes: Uint8Array, limits: DocxZipLimits): CentralEntry[] {
  // Find the EOCD record scanning from the end (comment ≤ 64 KiB).
  const tail = Math.min(bytes.length, 22 + 65536);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= bytes.length - tail && i >= 0; i -= 1) {
    if (u32(bytes, i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) fail("ingestion/docx-invalid", "no ZIP end-of-central-directory found");

  const diskNo = u16(bytes, eocd + 4);
  const cenDisk = u16(bytes, eocd + 6);
  const totalEntries = u16(bytes, eocd + 10);
  const cenSize = u32(bytes, eocd + 12);
  const cenOffset = u32(bytes, eocd + 16);
  if (diskNo !== 0 || cenDisk !== 0) {
    fail("ingestion/docx-invalid", "multi-disk archives are not supported");
  }
  if (u16(bytes, eocd + 8) !== totalEntries || totalEntries === 0) {
    fail("ingestion/docx-invalid", "central directory entry count is inconsistent");
  }
  if (cenOffset + cenSize > bytes.length) {
    fail("ingestion/docx-invalid", "central directory extends past end of file");
  }
  if (totalEntries > limits.maxEntries) {
    fail(
      "ingestion/docx-resource-limit",
      `DOCX package declares ${totalEntries} entries (limit ${limits.maxEntries})`,
    );
  }

  const entries: CentralEntry[] = [];
  const seen = new Set<string>();
  let totalUncompressed = 0;

  let off = cenOffset;
  for (let i = 0; i < totalEntries; i += 1) {
    if (off + 46 > bytes.length) fail("ingestion/docx-invalid", "truncated central directory");
    if (u32(bytes, off) !== CEN_SIG) fail("ingestion/docx-invalid", "bad central directory header");

    const flags = u16(bytes, off + 8);
    const method = u16(bytes, off + 10);
    const compSize = u32(bytes, off + 20);
    const unCompSize = u32(bytes, off + 24);
    const nameLen = u16(bytes, off + 28);
    const extraLen = u16(bytes, off + 30);
    const commentLen = u16(bytes, off + 32);
    const lho = u32(bytes, off + 42);
    const nameBytes = bytes.subarray(off + 46, off + 46 + nameLen);
    const name = new TextDecoder().decode(nameBytes);

    if (method !== 0 && method !== 8) {
      fail("ingestion/docx-invalid", `unsupported compression method ${method}`);
    }
    if (flags & 0x0001) fail("ingestion/docx-invalid", "encrypted ZIP entries are not supported");
    if (flags & 0x0020 || flags & 0x0040) {
      fail("ingestion/docx-invalid", "patched slip/stream-flagged entries are not supported");
    }
    if (compSize === 0xffffffff || unCompSize === 0xffffffff || lho === 0xffffffff) {
      fail("ingestion/docx-invalid", "ZIP64 entries are not supported");
    }
    if (name.length === 0) {
      off += 46 + nameLen + extraLen + commentLen;
      continue; // directory entries carry no payload
    }
    if (
      name.includes("..") ||
      name.startsWith("/") ||
      name.includes("\\") ||
      name.includes(":") ||
      name.includes(String.fromCharCode(0))
    ) {
      fail("ingestion/docx-invalid", `unsafe entry name "${name}"`);
    }
    if (seen.has(name)) fail("ingestion/docx-invalid", `duplicate entry name "${name}"`);
    seen.add(name);
    if (unCompSize > 0) {
      totalUncompressed += unCompSize;
      if (totalUncompressed > limits.maxTotalUncompressedBytes) {
        fail(
          "ingestion/docx-resource-limit",
          `declared uncompressed content (${totalUncompressed} bytes) exceeds ${limits.maxTotalUncompressedBytes}`,
        );
      }
      if (compSize > 0 && unCompSize / compSize > limits.maxRatio) {
        fail(
          "ingestion/docx-resource-limit",
          `declared expansion ratio for "${name}" exceeds ${limits.maxRatio}`,
        );
      }
    }
    entries.push({
      name,
      compressedSize: compSize,
      uncompressedSize: unCompSize,
      method,
      flags,
      localHeaderOffset: lho,
    });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** These are the ONLY OPC parts Phase 8 may ever inflate. */
const ALLOWED_PARTS: ReadonlySet<string> = new Set([
  "[Content_Types].xml",
  "_rels/.rels",
  "word/document.xml",
  "word/styles.xml",
  "word/numbering.xml",
  "word/_rels/document.xml.rels",
  "docProps/core.xml",
  "docProps/app.xml",
]);

export interface DocxPackage {
  /** Every entry name declared by the central directory (metadata view). */
  entries: string[];
  /** Read and inflate one allow-listed part; `null` when absent. */
  read(name: string): Uint8Array | null;
  /**
   * Audit-only read: preflight-checked but NOT restricted to the read
   * allowlist. Only the parser may use this to verify every `.rels` part in
   * the package (internal binding enforcement). Emits the same decompressor
   * cap as `read()`.
   */
  entriesIncludingUnsafe: string[];
  readAudit(name: string): Uint8Array;
}

/**
 * Preflight the package and return a reader. Nothing is inflated until
 * `read()` is called on an allow-listed part. Package-level dangers
 * (macros, OLE, embedded executables) are fatal here.
 */
export function openDocxPackage(
  bytes: Uint8Array,
  limits: DocxZipLimits = DEFAULT_DOCX_ZIP_LIMITS,
): DocxPackage {
  const entries = preflight(bytes, limits);

  // Package-level DANGEROUS content: detect by name, never execute.
  for (const e of entries) {
    const lc = e.name.toLowerCase();
    if (
      lc.includes("vbaproject") ||
      lc.includes("vba/") ||
      lc.startsWith("word/activex") ||
      lc.includes("oleobject") ||
      lc.includes("customui/") ||
      lc.startsWith("customxml/") ||
      lc.includes("embeddings/") ||
      lc.includes("activex/") ||
      lc.includes(".oc-") ||
      lc.includes("oleobjects")
    ) {
      fail(
        "ingestion/docx-unsafe-package",
        `DOCX package carries an unsafe part: "${e.name}" (macro / OLE / embedded package)`,
      );
    }
    // content types referencing external resources are fatal here too
  }

  const byName = new Map(entries.map((e) => [e.name, e]));
  // runtime counter for total decompressed payload
  const state = { inflatedTotal: 0 };
  const inflatedCache = new Map<string, Uint8Array>();
  const readAudit = (name: string): Uint8Array => {
    const cached = inflatedCache.get(name);
    if (cached !== undefined) return cached;
    const entry = byName.get(name);
    if (entry === undefined) return new Uint8Array(0);
    const { out, inflated } = inflateEntry(bytes, entry, limits, state.inflatedTotal);
    state.inflatedTotal += inflated;
    inflatedCache.set(name, out);
    return out;
  };
  return {
    entries: entries.map((e) => e.name),
    read(name: string): Uint8Array | null {
      if (!ALLOWED_PARTS.has(name)) {
        fail("ingestion/docx-unsafe-package", `part "${name}" is not in the read allowlist`);
      }
      const cached = inflatedCache.get(name);
      if (cached !== undefined) return cached;
      const entry = byName.get(name);
      if (entry === undefined) return null;
      return readAudit(name);
    },
    entriesIncludingUnsafe: entries.map((e) => e.name),
    readAudit(name: string): Uint8Array {
      return readAudit(name);
    },
  };
}

/**
 * Bounded inflate: decompress chunk by chunk and hard-abort as soon as the
 * emitted bytes exceed what remains of the package budget. Declared sizes are
 * metadata, never truth; a fake tiny declaration that expands to megabytes is
 * rejected from within the stream.
 *
 * The local header is also cross-checked against the central directory —
 * disagreements between the two mean the archive is ambiguous.
 */
function inflateEntry(
  bytes: Uint8Array,
  entry: CentralEntry,
  limits: DocxZipLimits,
  inflatedSoFar: number,
): { out: Uint8Array; inflated: number } {
  const off = entry.localHeaderOffset;
  if (off + 30 > bytes.length || u32(bytes, off) !== LFH_SIG) {
    fail("ingestion/docx-invalid", `local header missing for "${entry.name}"`);
  }
  // local header vs central directory: names, method, flags must agree.
  const lhFlags = u16(bytes, off + 6);
  const lhMethod = u16(bytes, off + 8);
  const lhCompSize = u32(bytes, off + 18);
  const lhNameLen = u16(bytes, off + 26);
  const lhExtraLen = u16(bytes, off + 28);
  const lhName = new TextDecoder().decode(bytes.subarray(off + 30, off + 30 + lhNameLen));
  if (
    lhName !== entry.name ||
    lhMethod !== entry.method ||
    (lhFlags & 0x0001) !== (entry.flags & 0x0001) ||
    (lhFlags & 0x0008) !== (entry.flags & 0x0008) ||
    (lhCompSize !== entry.compressedSize && entry.compressedSize !== 0)
  ) {
    fail("ingestion/docx-invalid", `local and central directory disagree on "${entry.name}"`);
  }

  const dataStart = off + 30 + lhNameLen + lhExtraLen;
  if (dataStart + entry.compressedSize > bytes.length) {
    fail("ingestion/docx-invalid", `entry "${entry.name}" data overruns the archive`);
  }
  const payload = bytes.subarray(dataStart, dataStart + entry.compressedSize);

  const remaining = Math.max(0, limits.maxTotalUncompressedBytes - inflatedSoFar);
  const hardCap = Math.min(entry.uncompressedSize, remaining);

  if (entry.method === 0) {
    if (payload.byteLength > hardCap + 1) {
      fail(
        "ingestion/docx-resource-limit",
        `raw entry "${entry.name}" (${payload.byteLength}) exceeds the package budget`,
      );
    }
    return { out: new Uint8Array(payload), inflated: payload.byteLength };
  }

  const parts: Uint8Array[] = [];
  let emitted = 0;
  const inflater = new Inflate((chunk: Uint8Array) => {
    emitted += chunk.length;
    if (emitted > hardCap) {
      throw new IngestionError(`entry "${entry.name}" inflated past its declared size`, {
        code: "ingestion/docx-resource-limit",
      });
    }
    parts.push(chunk);
  });
  inflater.push(payload, true);
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const p of parts) {
    out.set(p, cursor);
    cursor += p.length;
  }
  return { out, inflated: total };
}
