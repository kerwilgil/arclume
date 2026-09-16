/**
 * PPTX export (Phase 8) — ArclumeDeck → PowerPoint via PptxGenJS.
 *
 * Contract:
 *  - input is the Phase 7 CanonicalDeckRenderInput; diagram artifacts rebind
 *    through its own validation before a single byte is written;
 *  - everything goes through in-memory `write({ outputType: "nodebuffer" })`;
 *    never `writeFile`, never `path:` images, never hyperlinks/OLE/macros;
 *  - speaker notes are exported verbatim (never invented);
 *  - every diagram becomes a real visual: native SVG (renderer built) or the
 *    sanitized Visual Engine SVG. If SVG embedding fails, the SAME sanitized SVG is
 *    rendered to PNG offline (`export/pptx-svg-rasterized` loud warning) —
 *    never a text placeholder.
 */

import { createRequire } from "node:module";
import { Inflate } from "fflate";
import { SaxesParser, type SaxesTagPlain } from "saxes";
import { contentHash } from "../determinism/hash.js";
import type { ResolvedDiagramArtifact } from "../engines/types.js";
import { RenderError } from "../errors.js";
import type { NarrativePlan } from "../narrative/types.js";
import { validateDiagramArtifactBindings } from "../pipeline/canonical-render.js";
import type { CanonicalDeckRenderInput } from "../pipeline/canonical-render.js";
import { renderDiagram } from "../renderers/html/diagrams.js";
import type { ArclumeDeck, DiagramIR } from "../types/deck.js";
import { type Theme, getTheme } from "../visual/theme.js";
import { buildSemanticLayout } from "./pptx-layout.js";
import { buildExportReceipt, sha256Bytes } from "./receipt.js";
import { ASPECT_PPTX_INCH, type AspectRatio, type ExportReceipt } from "./types.js";

const require = createRequire(import.meta.url);

/** PptxGenJS structural surface ARCLUME uses. */
interface PptxSlideLike {
  addText(text: unknown, options: Record<string, unknown>): unknown;
  addImage(options: Record<string, unknown>): unknown;
  addTable(rows: unknown, options: Record<string, unknown>): unknown;
  addNotes(notes: string): unknown;
}
interface PptxGenInstance {
  defineLayout(l: { name: string; width: number; height: number }): void;
  layout: string;
  addSlide(): PptxSlideLike;
  write(options: { outputType: string }): Promise<unknown>;
}
interface PptxGenConstructor {
  new (): PptxGenInstance;
}
const PptxGenJS = require("pptxgenjs") as PptxGenConstructor;

export const PPTX_LAYOUT_PROFILE_VERSION = "0.1.0";

/* ------------------------------------------------------------------ */
/* aspect ratio                                                        */
/* ------------------------------------------------------------------ */

function aspectOf(deck: ArclumeDeck): AspectRatio {
  const a = deck.theme?.aspectRatio;
  return a === "16:9" || a === "16:10" || a === "4:3" ? a : "16:9";
}

/* ------------------------------------------------------------------ */
/* diagram embedding                                                   */
/* ------------------------------------------------------------------ */

/** Pre-resolved, writer-proof media for one diagram (built before layout). */
export interface DiagramMedia {
  dataUri: string;
  heightIn: number;
  source: "svg" | "png";
}

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

async function rasterizeSvg(svg: string, pixels: number): Promise<Buffer> {
  // offline Chromium turn: the sanitized SVG rendered alone into a PNG.
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: pixels, height: Math.max(1, Math.round(pixels / 2)) },
      offline: true,
    });
    await context.route("**/*", (route) => {
      const url = route.request().url();
      if (!url.startsWith("data:") && !url.startsWith("blob:")) {
        route.abort().catch(() => undefined);
        return;
      }
      route.continue().catch(() => undefined);
    });
    const page = await context.newPage();
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`,
      { waitUntil: "load" },
    );
    const buf = await page.screenshot({ type: "png", omitBackground: false });
    return Buffer.from(buf);
  } finally {
    await browser.close();
  }
}

/**
 * Probe the writer with the ACTUAL SVG bytes of THIS diagram: a minimal
 * throwaway deck embedding exactly `svgDataUri(svg)`. A generic probe would
 * only prove global capability — here the writer must accept THIS document,
 * not just "some SVG". Productively safe: in-memory, no network.
 */
async function probeWriterSvgAccepts(svg: string): Promise<boolean> {
  try {
    const probe = new PptxGenJS();
    probe.defineLayout({ name: "arclume-probe", width: 10, height: 7.5 });
    probe.layout = "arclume-probe";
    probe.addSlide().addImage({ data: svgDataUri(svg), x: 0, y: 0, w: 1, h: 1 });
    await probe.write({ outputType: "nodebuffer" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Produce the media for one diagram, respecting its provenance:
 *  - Visual Engine `svg` artifact → the sanitized SVG (authoritative).
 *  - native-fallback or no artifact → the native renderer's SVG (same bytes as
 *    the HTML renderer would produce, never re-derived).
 * Then package it for the writer: embeddable SVG first; if the writer cannot
 * take SVG, the SAME validated SVG is rasterized offline into PNG and the
 * media is marked `export/pptx-svg-rasterized`. If both fail the export is
 * fatal (`export/pptx-diagram-render-failed`) — never a silent placeholder.
 *
 * Runs entirely BEFORE `buildSemanticLayout`: by the time layout starts the
 * media map holds bytes the writer has already accepted.
 */
/**
 * Extract viewBox dimensions from an SVG string.
 * Returns { width, height } in viewBox units, or null if not parseable.
 */
function extractSvgViewBox(svg: string): { width: number; height: number } | null {
  const vbMatch = svg.match(/viewBox\s*=\s*["']([^"']+)["']/i);
  if (!vbMatch || !vbMatch[1]) return null;
  const parts = vbMatch[1].trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return null;
  const width = parts[2];
  const height = parts[3];
  if (width === undefined || height === undefined) return null;
  return { width, height };
}

/**
 * Compute diagram height in inches from SVG viewBox, preserving aspect ratio
 * within the available content width.
 */
function computeDiagramHeightIn(svg: string, availableWidthIn: number): number {
  const vb = extractSvgViewBox(svg);
  if (!vb || vb.width <= 0 || vb.height <= 0) return 3.6; // fallback
  const aspect = vb.height / vb.width;
  const heightIn = availableWidthIn * aspect;
  // Clamp to reasonable bounds
  return Math.max(1.5, Math.min(5.5, heightIn));
}

async function buildDiagramMedia(
  diag: DiagramIR,
  artifacts: ReadonlyMap<string, ResolvedDiagramArtifact> | undefined,
  warnings: string[],
  opts?: { forceSvgRasterization?: boolean; rejectSvgForDiagramIds?: string[] },
): Promise<DiagramMedia> {
  const artifact = artifacts?.get(diag.id);
  let svg: string;
  if (artifact !== undefined && artifact.kind === "svg") {
    svg = artifact.svg;
  } else {
    const native = renderDiagram(diag);
    const match = native.html.match(/<svg[\s\S]*<\/svg>/);
    if (match === null) {
      throw new RenderError(`diagram "${diag.id}" has no native SVG to export`, {
        code: "export/pptx-diagram-render-failed",
      });
    }
    svg = match[0];
  }
  const writerAcceptsSvg =
    opts?.forceSvgRasterization === true || opts?.rejectSvgForDiagramIds?.includes(diag.id)
      ? false
      : await probeWriterSvgAccepts(svg);
  const availableWidthIn = 8.5; // Standard slide content width for 16:9 (10in - 2*0.75in margins)
  const heightIn = computeDiagramHeightIn(svg, availableWidthIn);
  if (writerAcceptsSvg) {
    return { dataUri: svgDataUri(svg), heightIn, source: "svg" };
  }
  // The writer rejected SVG: rasterize the SAME validated SVG offline.
  try {
    const png = await rasterizeSvg(svg, 1280);
    warnings.push("export/pptx-svg-rasterized");
    return {
      dataUri: `data:image/png;base64,${png.toString("base64")}`,
      heightIn,
      source: "png",
    };
  } catch (cause) {
    throw new RenderError(
      `diagram "${diag.id}" could not be embedded (SVG rejected and rasterization failed)`,
      { code: "export/pptx-diagram-render-failed", cause: cause as Error },
    );
  }
}

/* ------------------------------------------------------------------ */
/* receipts                                                            */
/* ------------------------------------------------------------------ */

export interface PptxBuildMeta {
  warnings: string[];
  notes: string[];
  artifactIds: string[];
}

export interface PptxExportInput extends CanonicalDeckRenderInput {
  narrative?: NarrativePlan | undefined;
  options?: Record<string, never>;
}

export interface ExportPptxOutput {
  bytes: Buffer;
  receipt: ExportReceipt;
}

/* ------------------------------------------------------------------ */
/* structural validation of the emitted package                        */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* ZIP container reading (bounded, no symlink of trust to the names)   */
/* ------------------------------------------------------------------ */

interface ZipEntryMeta {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  localHeaderOffset: number;
}

const PPTX_MAX_TOTAL_UNCOMPRESSED = 256 * 1024 * 1024;

/** Parse EOCD + central directory; reject duplicates and unsafe paths. */
function parseZipCentralDirectory(bytes: Buffer): { meta: ZipEntryMeta[]; errors: string[] } {
  const meta: ZipEntryMeta[] = [];
  const errors: string[] = [];
  if (bytes.length < 22 || bytes.readUInt32LE(0) !== 0x04034b50) {
    return { meta, errors: ["export/pptx-invalid-package:not-a-zip"] };
  }
  let eocd = -1;
  for (let i = Math.max(0, bytes.length - 22 - 64 * 1024); i <= bytes.length - 22; i += 1) {
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return { meta, errors: ["export/pptx-invalid-package:no-eocd"] };

  // Multi-disk and inconsistent-count archives are not a generated PPTX shape.
  const diskNo = bytes.readUInt16LE(eocd + 4);
  const cenDisk = bytes.readUInt16LE(eocd + 6);
  const entriesThisDisk = bytes.readUInt16LE(eocd + 8);
  const entryCount = bytes.readUInt16LE(eocd + 10);
  if (diskNo !== 0 || cenDisk !== 0) {
    return { meta, errors: ["export/pptx-invalid-package:multi-disk"] };
  }
  if (entriesThisDisk !== entryCount) {
    return { meta, errors: ["export/pptx-invalid-package:inconsistent-entry-count"] };
  }
  const cdOffset = bytes.readUInt32LE(eocd + 16);
  if (cdOffset + entryCount * 46 > bytes.length) {
    return { meta, errors: ["export/pptx-invalid-package:bad-central-directory"] };
  }
  const seen = new Set<string>();
  let off = cdOffset;
  for (let j = 0; j < entryCount; j += 1) {
    if (off + 46 > bytes.length || bytes.readUInt32LE(off) !== 0x02014b50) {
      errors.push("export/pptx-invalid-package:central-directory-truncated");
      break;
    }
    const flags = bytes.readUInt16LE(off + 8);
    const method = bytes.readUInt16LE(off + 10);
    const compressedSize = bytes.readUInt32LE(off + 20);
    const uncompressedSize = bytes.readUInt32LE(off + 24);
    const nameLen = bytes.readUInt16LE(off + 28);
    const extraLen = bytes.readUInt16LE(off + 30);
    const commentLen = bytes.readUInt16LE(off + 32);
    const lho = bytes.readUInt32LE(off + 42);
    const name = bytes.subarray(off + 46, off + 46 + nameLen).toString("utf8");
    off += 46 + nameLen + extraLen + commentLen;

    if (flags & 0x0001) {
      errors.push(`export/pptx-invalid-package:encrypted-entry:${name}`);
      continue;
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || lho === 0xffffffff) {
      errors.push(`export/pptx-invalid-package:zip64:${name}`);
      continue;
    }
    if (
      name.includes("..") ||
      name.startsWith("/") ||
      name.includes("\\") ||
      name.includes(":") ||
      name.includes(String.fromCharCode(0))
    ) {
      errors.push(`export/pptx-traversal:${name}`);
      continue;
    }
    if (name === "" || name.endsWith("/")) continue; // directory marker
    if (seen.has(name)) {
      errors.push(`export/pptx-duplicate-entry:${name}`);
      continue;
    }
    seen.add(name);
    if (method === 0 || method === 8) {
      meta.push({ name, method, flags, compressedSize, localHeaderOffset: lho });
      continue;
    }
    errors.push(`export/pptx-invalid-package:unsupported-compression:${method}`);
  }
  return { meta, errors };
}

class ZipBudgetExceeded extends Error {
  constructor() {
    super("pptx package exceeds the decompression budget");
  }
}

/**
 * Inflate every entry with STREAMING hard caps, enforced DURING decompression
 * (never after): each entry may emit at most the remaining package budget, and
 * the central-directory declared sizes are treated as metadata, never truth.
 */
function inflateEntries(
  bytes: Buffer,
  metas: ZipEntryMeta[],
): { data: Map<string, Buffer>; errors: string[] } {
  const data = new Map<string, Buffer>();
  const errors: string[] = [];
  let total = 0;
  for (const m of metas) {
    const off = m.localHeaderOffset;
    if (off + 30 > bytes.length || bytes.readUInt32LE(off) !== 0x04034b50) {
      errors.push(`export/pptx-invalid-package:local-header-missing:${m.name}`);
      continue;
    }
    // Local header must agree with the central directory (name/method/flags).
    const lhFlags = bytes.readUInt16LE(off + 6);
    const lhMethod = bytes.readUInt16LE(off + 8);
    const nameLen = bytes.readUInt16LE(off + 26);
    const extraLen = bytes.readUInt16LE(off + 28);
    const lhName = bytes.subarray(off + 30, off + 30 + nameLen).toString("utf8");
    if (lhName !== m.name || lhMethod !== m.method || lhFlags !== m.flags) {
      errors.push(`export/pptx-invalid-package:local-central-mismatch:${m.name}`);
      continue;
    }
    const start = off + 30 + nameLen + extraLen;
    if (start + m.compressedSize > bytes.length) {
      errors.push(`export/pptx-invalid-package:entry-overrun:${m.name}`);
      continue;
    }
    const payload = bytes.subarray(start, start + m.compressedSize);
    const remaining = PPTX_MAX_TOTAL_UNCOMPRESSED - total;

    if (m.method === 0) {
      if (payload.length > remaining) {
        errors.push("export/pptx-invalid-package:package-too-large");
        break;
      }
      total += payload.length;
      data.set(m.name, Buffer.from(payload));
      continue;
    }

    const parts: Buffer[] = [];
    let emitted = 0;
    const inflater = new Inflate((chunk: Uint8Array) => {
      emitted += chunk.length;
      if (emitted > remaining) throw new ZipBudgetExceeded();
      parts.push(Buffer.from(chunk));
    });
    try {
      inflater.push(new Uint8Array(payload), true);
    } catch (err) {
      if (err instanceof ZipBudgetExceeded) {
        errors.push("export/pptx-invalid-package:package-too-large");
        break;
      }
      errors.push(`export/pptx-invalid-package:inflate-failed:${m.name}`);
      continue;
    }
    total += emitted;
    data.set(m.name, Buffer.concat(parts));
  }
  return { data, errors };
}

/* ------------------------------------------------------------------ */
/* XML helpers (bounded SAX — never DOM, never external resolution)    */
/* ------------------------------------------------------------------ */

interface XmlScan {
  ok: boolean;
  tags: Array<{ name: string; attributes: Record<string, string> }>;
}

function scanXml(xml: string): XmlScan {
  const tags: XmlScan["tags"] = [];
  const parser = new SaxesParser({});
  let bad = false;
  parser.on("error", () => {
    bad = true;
  });
  parser.on("opentag", (t: SaxesTagPlain) => {
    tags.push({ name: t.name, attributes: t.attributes as Record<string, string> });
  });
  try {
    parser.write(xml).close();
  } catch {
    bad = true;
  }
  return { ok: !bad, tags };
}

/** Resolve an OPC relationship target against its part's directory. */
function resolveRelTarget(baseDir: string, target: string): string | undefined {
  if (
    target.includes("\\") ||
    target.startsWith("/") ||
    target.includes(":") ||
    target.includes(String.fromCharCode(0))
  ) {
    return undefined;
  }
  const parts = (baseDir === "" ? [] : baseDir.split("/")).concat(target.split("/"));
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") {
      if (out.length === 0) return undefined; // escapes the package
      out.pop();
      continue;
    }
    out.push(p);
  }
  return out.join("/");
}

/** Audit one `.rels` part: no external targets, every internal target exists. */
function auditRelsPart(
  partName: string,
  baseDir: string,
  xml: string,
  parts: ReadonlySet<string>,
  errors: string[],
): Array<{ id: string; type: string; target: string; normalized: string }> {
  const scan = scanXml(xml);
  if (!scan.ok) {
    errors.push(`export/pptx-invalid-package:rels-unparseable:${partName}`);
    return [];
  }
  const rels: Array<{ id: string; type: string; target: string; normalized: string }> = [];
  for (const t of scan.tags) {
    if (!t.name.endsWith("Relationship")) continue;
    const type = t.attributes["Type"] ?? "";
    const target = t.attributes["Target"] ?? "";
    const id = t.attributes["Id"] ?? "";
    if (t.attributes["TargetMode"] === "External") {
      errors.push(`export/pptx-external-relationship:${partName}:${id}`);
      continue;
    }
    const normalized = resolveRelTarget(baseDir, target);
    if (normalized === undefined) {
      errors.push(`export/pptx-traversal:${target}`);
      continue;
    }
    if (!parts.has(normalized)) {
      errors.push(`export/pptx-dangling-relationship:${partName}:${id}->${normalized}`);
      continue;
    }
    rels.push({ id, type, target, normalized });
  }
  return rels;
}

/* ------------------------------------------------------------------ */
/* full package validation                                             */
/* ------------------------------------------------------------------ */

const EMU_PER_INCH = 914400;

export interface PptxPackageExpectations {
  slideCount: number;
  aspectRatio: AspectRatio;
}

/**
 * Validate a PPTX package against an original deck.
 * Settles its full identity expectations (slide count + aspect) from the deck.
 */
export function validatePptxPackage(bytes: Buffer, deck: ArclumeDeck): string[] {
  const a = deck.theme?.aspectRatio;
  const aspect: AspectRatio = a === "16:9" || a === "16:10" || a === "4:3" ? a : "16:9";
  return validatePptxPackageCore(bytes, { slideCount: deck.slides.length, aspectRatio: aspect });
}

/**
 * Validate against EXPLICIT expectations (Phase 9 `arclume validate` path):
 * same checks, without requiring the original deck in hand.
 */
export function validatePptxPackageExpectations(
  bytes: Buffer,
  expectations: PptxPackageExpectations,
): string[] {
  return validatePptxPackageCore(bytes, expectations);
}

function validatePptxPackageCore(bytes: Buffer, expected: PptxPackageExpectations): string[] {
  const errors: string[] = [];
  const { meta, errors: zipErrors } = parseZipCentralDirectory(bytes);
  errors.push(...zipErrors);
  if (meta.length === 0) {
    if (errors.length === 0) errors.push("export/pptx-invalid-package:no-entries");
    return errors;
  }

  const names = new Set(meta.map((m) => m.name));

  // Forbidden parts: macros, ActiveX, OLE, embedded packages, customXml.
  for (const n of names) {
    const lc = n.toLowerCase();
    if (lc.includes("vbaproject") || lc.includes("vba/")) errors.push(`export/pptx-macro:${n}`);
    if (/(^|\/)activex\//i.test(n)) errors.push(`export/pptx-activex:${n}`);
    if (lc.includes("oleobject") || /(^|\/)oleobjects\//i.test(n)) {
      errors.push(`export/pptx-ole:${n}`);
    }
    if (/(^|\/)embeddings\//i.test(n)) errors.push(`export/pptx-embedded-package:${n}`);
    if (/(^|\/)customxml\//i.test(n)) errors.push(`export/pptx-customxml:${n}`);
  }

  const required = ["[Content_Types].xml", "_rels/.rels", "ppt/presentation.xml"];
  for (const r of required) {
    if (!names.has(r)) errors.push(`export/pptx-missing-part:${r}`);
  }
  if (!names.has("[Content_Types].xml") || !names.has("_rels/.rels")) return errors;
  if (!names.has("ppt/presentation.xml")) return errors;

  const { data, errors: inflateErrors } = inflateEntries(bytes, meta);
  errors.push(...inflateErrors);

  const readUtf8 = (name: string): string | undefined => {
    const b = data.get(name);
    return b === undefined ? undefined : b.toString("utf8");
  };

  // [Content_Types].xml must parse.
  const ct = readUtf8("[Content_Types].xml");
  if (ct === undefined) {
    errors.push("export/pptx-missing-part:[Content_Types].xml");
  } else if (!scanXml(ct).ok) {
    errors.push("export/pptx-invalid-package:content-types-unparseable");
  }

  // Every .rels part in the package is audited: no TargetMode=External,
  // every internal target must exist.
  const relsParts = [...names].filter((n) => n.endsWith(".rels"));
  const presentationRels = new Map<string, string>(); // id -> normalized target
  for (const relsName of relsParts) {
    const xml = readUtf8(relsName);
    if (xml === undefined) {
      errors.push(`export/pptx-invalid-package:rels-unreadable:${relsName}`);
      continue;
    }
    // base directory of the OWNING part: "ppt/slides/_rels/slide1.xml.rels" → "ppt/slides"
    const withoutRels = relsName.slice(0, relsName.length - ".rels".length);
    const baseDir =
      withoutRels.endsWith("/_rels/") || withoutRels.includes("/_rels/")
        ? withoutRels.slice(0, withoutRels.lastIndexOf("/_rels/"))
        : "";
    const rels = auditRelsPart(relsName, baseDir, xml, names, errors);
    if (relsName === "ppt/_rels/presentation.xml.rels") {
      for (const r of rels) presentationRels.set(r.id, r.normalized);
    }
  }

  // presentation.xml: slide size + exact slide identity list.
  const presXml = readUtf8("ppt/presentation.xml");
  if (presXml === undefined) {
    errors.push("export/pptx-missing-part:ppt/presentation.xml");
    return errors;
  }
  const pres = scanXml(presXml);
  if (!pres.ok) {
    errors.push("export/pptx-invalid-package:presentation-unparseable");
    return errors;
  }

  let sldSz: { cx: number; cy: number } | undefined;
  const sldIds: Array<{ id: string; rId: string }> = [];
  for (const t of pres.tags) {
    const local = t.name.includes(":") ? (t.name.split(":")[1] as string) : t.name;
    if (local === "sldSz") {
      const cx = Number(t.attributes["cx"]);
      const cy = Number(t.attributes["cy"]);
      if (Number.isFinite(cx) && Number.isFinite(cy)) sldSz = { cx, cy };
    }
    if (local === "sldId") {
      const id = t.attributes["id"] ?? "";
      const rId =
        t.attributes["r:id"] ??
        (Object.entries(t.attributes).find(([k]) => k.endsWith("|id") || k.endsWith(":id"))?.[1] as
          | string
          | undefined) ??
        "";
      sldIds.push({ id, rId });
    }
  }

  const dims = ASPECT_PPTX_INCH[expected.aspectRatio];
  const expCx = Math.round(dims.width * EMU_PER_INCH);
  const expCy = Math.round(dims.height * EMU_PER_INCH);
  if (sldSz === undefined) {
    errors.push("export/pptx-slide-size-missing");
  } else if (Math.abs(sldSz.cx - expCx) > 16 || Math.abs(sldSz.cy - expCy) > 16) {
    errors.push(`export/pptx-slide-size-mismatch:${sldSz.cx}x${sldSz.cy}`);
  }

  if (sldIds.length !== expected.slideCount) {
    errors.push(`export/pptx-slide-count-mismatch:${sldIds.length}!=${expected.slideCount}`);
  }
  const seenSlideIds = new Set<string>();
  for (const s of sldIds) {
    if (seenSlideIds.has(s.id)) errors.push(`export/pptx-duplicate-slide-id:${s.id}`);
    seenSlideIds.add(s.id);
    const target = presentationRels.get(s.rId);
    if (target === undefined) {
      errors.push(`export/pptx-dangling-relationship:presentation:${s.rId}`);
    } else if (!/^ppt\/slides\/slide\d+\.xml$/.test(target)) {
      errors.push(`export/pptx-slide-target-invalid:${s.rId}->${target}`);
    }
  }

  // Every expected slide part (and its rels, including notes targets) exists.
  if (expected.slideCount > 0) {
    for (let i = 1; i <= expected.slideCount; i += 1) {
      const key = `ppt/slides/slide${i}.xml`;
      if (!names.has(key)) errors.push(`export/pptx-slide-missing:${i}`);
      const relsKey = `ppt/slides/_rels/slide${i}.xml.rels`;
      if (!names.has(relsKey)) errors.push(`export/pptx-slide-rels-missing:${i}`);
    }
  }

  return errors;
}

/* ------------------------------------------------------------------ */
/* main exporter                                                       */
/* ------------------------------------------------------------------ */

export interface ExportPptxOptions {
  knowledge?: unknown;
  narrative?: NarrativePlan | undefined;
  diagramArtifacts?: ReadonlyMap<string, ResolvedDiagramArtifact> | undefined;
  /**
   * TEST-ONLY seam: simulates a writer without SVG support so tests can force
   * the offline SVG→PNG raster fallback and observe `export/pptx-svg-rasterized`.
   * Never set productively.
   */
  forceSvgRasterization?: boolean;
  /**
   * TEST-ONLY seam: simulates the writer rejecting the ACTUAL SVG of the
   * listed diagram ids (while accepting others), to prove the per-SVG probe
   * contract. Never set productively.
   */
  rejectSvgForDiagramIds?: string[];
}

export async function buildDeckPptx(
  input: PptxExportInput,
  options: ExportPptxOptions = {},
): Promise<ExportPptxOutput> {
  const deck = input.deck;
  const themeName = deck.theme?.name;
  if (themeName !== "minimal" && themeName !== "executive") {
    throw new RenderError(`theme "${String(themeName)}" cannot be resolved for PPTX export`, {
      code: "export/theme-unresolved",
    });
  }
  // Phase 7 binding now governs artifact use regardless of caller shape.
  validateDiagramArtifactBindings(deck, input.diagramArtifacts ?? options.diagramArtifacts);

  const theme = getTheme(themeName);
  const aspect = aspectOf(deck);
  const dims = ASPECT_PPTX_INCH[aspect];

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: `arclume-${aspect}`, width: dims.width, height: dims.height });
  pptx.layout = `arclume-${aspect}`;

  const warnings: string[] = [];
  const notes: string[] = [];
  const artifactIds: string[] = [];
  const artifacts = input.diagramArtifacts ?? options.diagramArtifacts;

  // Pre-resolve every diagram into writer-safe media BEFORE any slide is
  // produced: validated SVG → probe the writer → embeddable SVG, or offline
  // PNG raster fallback of the same bytes (loud warning), or fatal.
  const diagramMedia = new Map<string, DiagramMedia>();
  for (const slide of deck.slides) {
    for (const block of slide.blocks) {
      if (!("diagramRef" in block)) continue;
      const dref = block.diagramRef as string;
      const diag = deck.diagrams.find((d) => d.id === dref);
      if (diag === undefined) {
        throw new RenderError(`slide "${slide.id}" references missing diagram "${dref}"`, {
          code: "export/pptx-schema-mismatch",
        });
      }
      if (diagramMedia.has(dref)) continue;
      const media = await buildDiagramMedia(diag, artifacts, warnings, {
        ...(options.forceSvgRasterization === true ? { forceSvgRasterization: true } : {}),
        ...(options.rejectSvgForDiagramIds !== undefined
          ? { rejectSvgForDiagramIds: options.rejectSvgForDiagramIds }
          : {}),
      });
      diagramMedia.set(dref, media);
    }
  }

  for (const slide of deck.slides) {
    const slide_ = pptx.addSlide();
    const ctx = {
      pptx,
      slide: slide_,
      theme,
      aspect,
      diagramsById: new Map(deck.diagrams.map((d) => [d.id, d])),
      notes,
      warnings,
      artifactIds,
      diagramArtifacts: artifacts,
      diagramMedia,
    };
    buildSemanticLayout(ctx, slide);
    if (slide.speakerNotes !== undefined && slide.speakerNotes !== "") {
      slide_.addNotes(slide.speakerNotes);
    }
  }

  const bytes = await pptx.write({ outputType: "nodebuffer" });
  const out = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes as ArrayBuffer);

  // Structural validation now, before the receipt ever exists.
  const structural = validatePptxPackage(out, deck);
  if (structural.length > 0) {
    throw new RenderError(`PPTX structural validation failed: ${structural.join("; ")}`, {
      code: "export/pptx-invalid-package",
    });
  }

  const receipt = buildExportReceipt({
    format: "pptx",
    deck,
    diagramArtifacts: artifacts,
    output: { fileName: "deck.pptx", bytes: out.length, sha256: sha256Bytes(out) },
    slideCount: deck.slides.length,
    validation: { valid: true, errors: [], warnings: [...warnings] },
    layoutProfile: { version: PPTX_LAYOUT_PROFILE_VERSION, aspectRatio: aspect },
    notes,
  });
  return { bytes: out, receipt };
}

export { contentHash, sha256Bytes };
export { PptxGenJS };
