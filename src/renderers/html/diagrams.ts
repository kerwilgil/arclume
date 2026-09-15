/**
 * Native diagram rendering: `DiagramIR` (`engine: "native"`, spec
 * `arclume.native.v1`) → deterministic inline SVG.
 *
 * The renderer builds every SVG element itself from the structured spec. It
 * never takes raw SVG from a deck string, never runs a physics / random layout,
 * and never re-derives topology from knowledge — the `ArclumeDeck` is the sole
 * source. Every label is escaped. Node / edge / item identity is preserved as
 * `data-*` attributes for Phase 6.
 */

import type { ResolvedDiagramArtifact } from "../../engines/types.js";
import type { DiagramIR } from "../../types/deck.js";
import { escapeHtml, isSafeId, oneLine } from "./escape.js";
import type { HtmlRenderWarning } from "./types.js";

export interface DiagramRenderOutcome {
  html: string;
  warnings: HtmlRenderWarning[];
}

interface NativeSpec {
  format?: unknown;
  kind?: unknown;
  condensed?: unknown;
  nodes?: unknown;
  edges?: unknown;
  steps?: unknown;
  items?: unknown;
}

const asArray = (v: unknown): Array<Record<string, unknown>> =>
  Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** Deterministic word wrap by character budget. Pure. */
function wrapLabel(text: string, maxChars: number, maxLines: number): string[] {
  const words = oneLine(text).split(" ").filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur === "") cur = w;
    else if (cur.length + 1 + w.length <= maxChars) cur = `${cur} ${w}`;
    else {
      lines.push(cur);
      cur = w;
    }
    if (lines.length === maxLines) break;
  }
  if (cur !== "" && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines) {
    const last = lines[maxLines - 1] ?? "";
    const consumed = lines.join(" ").length;
    if (consumed < oneLine(text).length) lines[maxLines - 1] = `${last.replace(/\.*$/, "")}…`;
  }
  return lines.length > 0 ? lines : [""];
}

function svgText(
  x: number,
  y: number,
  lines: string[],
  opts: { anchor?: "start" | "middle" | "end"; cls?: string; lineHeight?: number } = {},
): string {
  const anchor = opts.anchor ?? "middle";
  const lh = opts.lineHeight ?? 15;
  const cls = opts.cls ? ` class="${escapeHtml(opts.cls)}"` : "";
  const tspans = lines
    .map((ln, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : lh}">${escapeHtml(ln)}</tspan>`)
    .join("");
  return `<text x="${x}" y="${y}" text-anchor="${anchor}"${cls}>${tspans}</text>`;
}

function dataId(name: string, value: unknown): string {
  return isSafeId(value) ? ` data-${name}="${value}"` : "";
}

const ARROW_DEFS = `<defs><marker id="arclume-arrow" class="edge-marker" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z"/></marker></defs>`;

function frame(width: number, height: number, kind: string, body: string): string {
  const w = Math.max(320, Math.round(width));
  const h = Math.max(160, Math.round(height));
  return (
    `<svg viewBox="0 0 ${w} ${h}" role="img" preserveAspectRatio="xMidYMid meet" ` +
    `data-diagram-kind="${escapeHtml(kind)}">${ARROW_DEFS}${body}</svg>`
  );
}

/* ------------------------------------------------------------------ */
/* architecture                                                        */
/* ------------------------------------------------------------------ */

const ARCH = { NW: 200, NH: 64, GX: 96, GY: 30, MX: 44, MY: 44 } as const;

interface ArchLayout {
  pos: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
  cyclic: boolean;
}

/**
 * Deterministic, genuinely cycle-safe placement for an architecture graph.
 *
 *  - A DAG (proven by a deterministic Kahn topological sort) gets a layered
 *    layout: `layer` is computed in topological order, so it is bounded by
 *    `nodes.length - 1` and never grows without limit.
 *  - Any graph with a cycle falls back to a deterministic stable grid
 *    (id-sorted, `ceil(sqrt(n))` columns). Edges may cross; that is acceptable
 *    for Phase 5. The Visual Engine owns sophisticated cyclic layout.
 *
 * In both cases the returned `width` / `height` are derived from the **real**
 * node-box bounds plus a margin, so no node can fall outside the viewBox.
 */
function layoutArchitecture(
  nodes: ReadonlyArray<{ id: string }>,
  edges: ReadonlyArray<{ from: string; to: string }>,
): ArchLayout {
  const { NW, NH, GX, GY, MX, MY } = ARCH;
  const ids = nodes.map((n) => n.id).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const known = new Set(ids);
  // Real, non-self edges between two known nodes drive the topology.
  const dag = edges.filter((e) => known.has(e.from) && known.has(e.to) && e.from !== e.to);

  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of dag) {
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
    (out.get(e.from) as string[]).push(e.to);
  }
  for (const list of out.values()) list.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  // Kahn, deterministic: always take the smallest id among in-degree-0 nodes.
  const layer = new Map<string, number>(ids.map((id) => [id, 0]));
  const ready = ids.filter((id) => (indeg.get(id) ?? 0) === 0);
  const seen = new Set<string>(ready);
  let processed = 0;
  while (ready.length > 0) {
    ready.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const u = ready.shift() as string;
    processed += 1;
    for (const v of out.get(u) ?? []) {
      const want = (layer.get(u) ?? 0) + 1;
      if (want > (layer.get(v) ?? 0)) layer.set(v, want);
      indeg.set(v, (indeg.get(v) ?? 0) - 1);
      if ((indeg.get(v) ?? 0) === 0 && !seen.has(v)) {
        seen.add(v);
        ready.push(v);
      }
    }
  }
  const cyclic = processed !== ids.length;

  const pos = new Map<string, { x: number; y: number }>();
  if (!cyclic) {
    const rowOf = new Map<number, number>();
    for (const id of ids) {
      const l = layer.get(id) ?? 0;
      const row = rowOf.get(l) ?? 0;
      rowOf.set(l, row + 1);
      pos.set(id, { x: MX + l * (NW + GX), y: MY + row * (NH + GY) });
    }
  } else {
    const cols = Math.max(1, Math.ceil(Math.sqrt(ids.length)));
    ids.forEach((id, i) => {
      pos.set(id, {
        x: MX + (i % cols) * (NW + GX),
        y: MY + Math.floor(i / cols) * (NH + GY),
      });
    });
  }

  // viewBox strictly from the real bounds — never from a layer count.
  let maxX = MX + NW;
  let maxY = MY + NH;
  for (const p of pos.values()) {
    maxX = Math.max(maxX, p.x + NW);
    maxY = Math.max(maxY, p.y + NH);
  }
  return { pos, width: maxX + MX, height: maxY + MY, cyclic };
}

function renderArchitecture(spec: NativeSpec): string {
  const nodes = asArray(spec.nodes)
    .map((n) => ({
      id: str(n["id"]) ?? "",
      label: str(n["label"]) ?? str(n["id"]) ?? "",
      entityId: str(n["entityId"]),
      group: str(n["group"]),
    }))
    .filter((n) => n.id !== "");
  const edges = asArray(spec.edges)
    .map((e) => ({
      id: str(e["id"]) ?? "",
      from: str(e["from"]) ?? "",
      to: str(e["to"]) ?? "",
      label: str(e["label"]) ?? str(e["relationType"]) ?? "",
      relationId: str(e["relationId"]),
    }))
    .filter((e) => e.from !== "" && e.to !== "");

  const { NW, NH } = ARCH;
  const { pos, width, height } = layoutArchitecture(nodes, edges);

  const edgeEls = edges
    .map((e) => {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      if (!a || !b) return "";
      const x1 = a.x + NW;
      const y1 = a.y + NH / 2;
      const x2 = b.x;
      const y2 = b.y + NH / 2;
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const label = e.label
        ? svgText(mx, my - 4, [oneLine(e.label).slice(0, 24)], { cls: "edge-label" })
        : "";
      return (
        `<g${dataId("relation-id", e.relationId)}>` +
        `<line class="edge-line" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#arclume-arrow)"/>` +
        `${label}</g>`
      );
    })
    .join("");

  const nodeEls = nodes
    .map((n) => {
      const p = pos.get(n.id);
      if (!p) return "";
      const lines = wrapLabel(n.label, 24, 2);
      return `<g${dataId("node-id", n.id)}${dataId("entity-id", n.entityId)}><rect class="node-box" x="${p.x}" y="${p.y}" width="${NW}" height="${NH}" rx="6"/>${svgText(p.x + NW / 2, p.y + NH / 2 - (lines.length - 1) * 7 + 4, lines)}</g>`;
    })
    .join("");

  return frame(width, height, "architecture", edgeEls + nodeEls);
}

/* ------------------------------------------------------------------ */
/* process                                                            */
/* ------------------------------------------------------------------ */

function readSteps(
  spec: NativeSpec,
): Array<{ id: string; label: string; ref?: string | undefined; index: number }> {
  return asArray(spec.steps)
    .map((s, i) => ({
      id: str(s["id"]) ?? "",
      label: str(s["label"]) ?? "",
      ref: str(s["ref"]),
      index: typeof s["index"] === "number" ? (s["index"] as number) : i,
    }))
    .filter((s) => s.id !== "")
    .sort((a, b) => a.index - b.index);
}
function readFlowEdges(
  spec: NativeSpec,
): Array<{ from: string; to: string; relationId?: string | undefined }> {
  return asArray(spec.edges)
    .map((e) => ({
      from: str(e["from"]) ?? "",
      to: str(e["to"]) ?? "",
      relationId: str(e["relationId"]),
    }))
    .filter((e) => e.from !== "" && e.to !== "");
}

function renderProcess(spec: NativeSpec): string {
  const steps = readSteps(spec);
  const edges = readFlowEdges(spec);
  const BW = 176;
  const BH = 62;
  const GAP = 74;
  const MX = 30;
  const MY = 54;
  const posX = new Map<string, number>();
  steps.forEach((s, i) => posX.set(s.id, MX + i * (BW + GAP)));
  const width = MX * 2 + steps.length * (BW + GAP) - GAP;
  const height = MY + BH + 40;
  const y = MY;

  const edgeEls = edges
    .map((e) => {
      const xa = posX.get(e.from);
      const xb = posX.get(e.to);
      if (xa === undefined || xb === undefined) return "";
      const x1 = xa + BW;
      const x2 = xb;
      return `<g${dataId("relation-id", e.relationId)}><path class="edge-line" d="M${x1} ${y + BH / 2} L${x2} ${y + BH / 2}" marker-end="url(#arclume-arrow)"/></g>`;
    })
    .join("");

  const boxEls = steps
    .map((s, i) => {
      const x = posX.get(s.id) ?? MX;
      const lines = wrapLabel(s.label || `Step ${i + 1}`, 22, 2);
      return `<g${dataId("step-id", s.id)}${dataId("entity-id", s.ref)}><rect class="node-box" x="${x}" y="${y}" width="${BW}" height="${BH}" rx="6"/>${svgText(x + BW / 2, y + BH / 2 - (lines.length - 1) * 7 + 4, lines)}${svgText(x + 14, y - 12, [`${i + 1}`], { anchor: "middle", cls: "edge-label" })}</g>`;
    })
    .join("");

  return frame(width, height, "process", edgeEls + boxEls);
}

/* ------------------------------------------------------------------ */
/* sequence                                                           */
/* ------------------------------------------------------------------ */

function renderSequence(spec: NativeSpec): string {
  const steps = readSteps(spec);
  const edges = readFlowEdges(spec);
  const RH = 54;
  const GAP = 16;
  const MY = 30;
  const LIFELINE_X = 34;
  const BX = 72;
  const BW = 760;
  const width = BX + BW + 90;
  const rowY = new Map<string, number>();
  steps.forEach((s, i) => rowY.set(s.id, MY + i * (RH + GAP)));
  const height = MY + steps.length * (RH + GAP) + 20;

  const lifeline =
    steps.length > 1
      ? `<line class="edge-line" x1="${LIFELINE_X}" y1="${MY + RH / 2}" x2="${LIFELINE_X}" y2="${
          MY + (steps.length - 1) * (RH + GAP) + RH / 2
        }"/>`
      : "";

  const rows = steps
    .map((s, i) => {
      const yTop = rowY.get(s.id) ?? MY;
      const lines = wrapLabel(s.label || `Step ${i + 1}`, 64, 2);
      return `<g${dataId("step-id", s.id)}${dataId("entity-id", s.ref)}><circle class="node-box" cx="${LIFELINE_X}" cy="${yTop + RH / 2}" r="13"/>${svgText(LIFELINE_X, yTop + RH / 2 + 4, [`${i + 1}`])}<rect class="node-box is-outline" x="${BX}" y="${yTop}" width="${BW}" height="${RH}" rx="6"/>${svgText(BX + 14, yTop + RH / 2 - (lines.length - 1) * 7 + 4, lines, { anchor: "start" })}</g>`;
    })
    .join("");

  const arrowX = BX + BW + 24;
  const edgeEls = edges
    .map((e) => {
      const ya = rowY.get(e.from);
      const yb = rowY.get(e.to);
      if (ya === undefined || yb === undefined) return "";
      return `<g${dataId("relation-id", e.relationId)}><path class="edge-line" d="M${arrowX} ${ya + RH / 2} L${arrowX} ${yb + RH / 2}" marker-end="url(#arclume-arrow)"/></g>`;
    })
    .join("");

  return frame(width, height, "sequence", lifeline + rows + edgeEls);
}

/* ------------------------------------------------------------------ */
/* timeline / roadmap                                                  */
/* ------------------------------------------------------------------ */

function readItems(spec: NativeSpec): Array<{
  id: string;
  label: string;
  ref?: string | undefined;
  date?: string | undefined;
  state?: string | undefined;
  status?: string | undefined;
}> {
  return asArray(spec.items)
    .map((it) => ({
      id: str(it["id"]) ?? "",
      label: str(it["label"]) ?? "",
      ref: str(it["ref"]),
      date: str(it["date"]),
      state: str(it["state"]),
      status: str(it["status"]),
    }))
    .filter((it) => it.id !== "" || it.label !== "");
}

function renderTimeline(spec: NativeSpec): string {
  const items = readItems(spec);
  const STEP = 210;
  const MX = 60;
  const axisY = 150;
  const width = MX * 2 + Math.max(1, items.length - 1) * STEP;
  const height = 260;
  const axis = `<line class="edge-line" x1="${MX}" y1="${axisY}" x2="${width - MX}" y2="${axisY}"/>`;
  const ticks = items
    .map((it, i) => {
      const x = MX + i * STEP;
      const above = i % 2 === 0;
      const labelLines = wrapLabel(it.label, 20, 2);
      const labelY = above ? axisY - 58 : axisY + 34;
      const meta = [it.date, it.state].filter(Boolean).join(" · ");
      return `<g${dataId("item-id", it.id)}${dataId("entity-id", it.ref)}><circle class="node-box" cx="${x}" cy="${axisY}" r="6"/>${svgText(x, labelY, labelLines)}${
        meta
          ? svgText(x, above ? axisY - 20 : axisY + 68, [oneLine(meta).slice(0, 28)], {
              cls: "edge-label",
            })
          : ""
      }</g>`;
    })
    .join("");
  return frame(width, height, "timeline", axis + ticks);
}

function renderRoadmap(spec: NativeSpec): string {
  const items = readItems(spec);
  const RH = 44;
  const GAP = 14;
  const MY = 24;
  const NAME_X = 20;
  const NAME_W = 220;
  const BAR_X = 256;
  const BAR_W = 460;
  const width = BAR_X + BAR_W + 40;
  const height = MY * 2 + items.length * (RH + GAP);
  const rows = items
    .map((it, i) => {
      const y = MY + i * (RH + GAP);
      const nameLines = wrapLabel(it.label, 26, 2);
      const status = it.status ?? it.state ?? "";
      const dates = [it.date].filter(Boolean).join(" ");
      return `<g${dataId("item-id", it.id)}${dataId("entity-id", it.ref)}>${svgText(
        NAME_X,
        y + RH / 2 - (nameLines.length - 1) * 7 + 4,
        nameLines,
        {
          anchor: "start",
        },
      )}${
        dates
          ? svgText(NAME_X, y + RH / 2 + 20, [oneLine(dates).slice(0, 24)], {
              anchor: "start",
              cls: "edge-label",
            })
          : ""
      }<rect class="node-box" x="${BAR_X}" y="${y}" width="${BAR_W}" height="${RH}" rx="6"/>${
        status
          ? svgText(BAR_X + 12, y + RH / 2 + 4, [oneLine(status).slice(0, 24)], {
              anchor: "start",
              cls: "edge-label",
            })
          : ""
      }</g>`;
    })
    .join("");
  return frame(width, Math.max(160, height), "roadmap", rows);
}

/* ------------------------------------------------------------------ */

const NATIVE_KINDS = new Set(["architecture", "process", "sequence", "timeline", "roadmap"]);

export function renderDiagram(
  dir: DiagramIR,
  artifacts?: ReadonlyMap<string, ResolvedDiagramArtifact>,
): DiagramRenderOutcome {
  const warnings: HtmlRenderWarning[] = [];
  const title = str(dir.title);
  const caption = title
    ? `<figcaption class="arclume-block-caption">${escapeHtml(title)}</figcaption>`
    : "";

  const wrap = (inner: string, engine: string = String(dir.engine)): string =>
    `<figure class="arclume-diagram"${dataId("diagram-id", dir.id)} data-diagram-engine="${escapeHtml(
      engine,
    )}" data-diagram-type="${escapeHtml(String(dir.diagramType))}">${inner}${caption}</figure>`;

  /* ---- Phase 7: resolved artifacts outrank the deck's raw request ---- */
  const artifact = artifacts?.get(dir.id);
  if (artifact !== undefined) {
    if (artifact.kind === "svg" && artifact.engineUsed === "visual") {
      // The SVG is already trusted: parsed, allowlisted, class-mapped, rebuilt
      // and provenance-injected by the engine layer. Embed verbatim.
      for (const w of artifact.warnings) {
        warnings.push({ code: w.code, message: w.message, diagramId: w.diagramId });
      }
      return { html: wrap(artifact.svg, "visual"), warnings };
    }
    if (artifact.kind === "native-fallback") {
      warnings.push({
        code: "visual-engine/fallback-native",
        message: `diagram "${dir.id}" requested the visual engine but rendered with the native engine (${artifact.code})`,
        diagramId: isSafeId(dir.id) ? dir.id : undefined,
      });
      for (const w of artifact.warnings) {
        warnings.push({ code: w.code, message: w.message, diagramId: w.diagramId });
      }
      const native = renderNative(dir);
      return { html: wrap(native.bytes, "native"), warnings: [...warnings, ...native.warnings] };
    }
  }

  if (dir.engine === "visual") {
    // Low-level, non-canonical path: a hand-built deck with no resolved
    // artifact keeps the Phase 6 placeholder. Canonical surfaces never take
    // this branch (missing artifacts are fatal upstream).
    warnings.push({
      code: "render/unsupported-diagram-engine",
      message: `diagram "${dir.id}" uses engine "visual" but no resolved artifact was supplied — showing a placeholder`,
      diagramId: isSafeId(dir.id) ? dir.id : undefined,
    });
    return {
      html: wrap(
        `<div class="arclume-diagram-fallback">Diagram not rendered (engine: visual).</div>`,
      ),
      warnings,
    };
  }

  const native = renderNative(dir);
  return { html: wrap(native.bytes), warnings: native.warnings };
}

function renderNative(dir: DiagramIR): { bytes: string; warnings: HtmlRenderWarning[] } {
  const warnings: HtmlRenderWarning[] = [];
  const placeholder = (message: string): string =>
    `<div class="arclume-diagram-fallback">${message}</div>`;

  const spec = (dir.spec ?? undefined) as NativeSpec | undefined;
  if (!spec || spec.format !== "arclume.native.v1" || typeof spec.kind !== "string") {
    warnings.push({
      code: "render/diagram-unrenderable",
      message: `diagram "${dir.id}" has no renderable native spec — showing a placeholder`,
      diagramId: isSafeId(dir.id) ? dir.id : undefined,
    });
    return { bytes: placeholder("Diagram not rendered (no native spec)."), warnings };
  }

  if (!NATIVE_KINDS.has(spec.kind)) {
    warnings.push({
      code: "render/unsupported-diagram",
      message: `diagram "${dir.id}" native kind "${spec.kind}" is not supported`,
      diagramId: isSafeId(dir.id) ? dir.id : undefined,
    });
    return {
      bytes: placeholder(`Diagram not rendered (kind: ${escapeHtml(spec.kind)}).`),
      warnings,
    };
  }

  let svg: string;
  switch (spec.kind) {
    case "architecture":
      svg = renderArchitecture(spec);
      break;
    case "process":
      svg = renderProcess(spec);
      break;
    case "sequence":
      svg = renderSequence(spec);
      break;
    case "timeline":
      svg = renderTimeline(spec);
      break;
    case "roadmap":
      svg = renderRoadmap(spec);
      break;
    default:
      svg = `<div class="arclume-diagram-fallback">Diagram not rendered.</div>`;
  }
  if (spec.condensed === true) {
    warnings.push({
      code: "render/diagram-condensed",
      message: `diagram "${dir.id}" was condensed upstream; some nodes/steps are not shown`,
      diagramId: isSafeId(dir.id) ? dir.id : undefined,
    });
  }
  return { bytes: svg, warnings };
}
