/**
 * ARCLUME Visual Engine SVG sanitizer — the security boundary.
 *
 * Visual engine output is UNTRUSTED until this module rebuilds it. The pipeline is:
 *
 *   Visual Engine HTML
 *     → extract the SVG region
 *     → parse XML with `saxes` (never regex, never raw passthrough)
 *     → strict element / attribute allowlist
 *     → presentation classes → ARCLUME presentation attributes
 *     → remove component-type sentinel classes and semantic sigils
 *     → inject ARCLUME provenance from the semantic↔visual maps:
 *         - architecture nodes: `data-entity-id` = real ProjectKnowledge entityId
 *         - workflow steps:     `data-step-id` (structural) + `data-step-ref`
 *         - edges:              `data-relation-id` = real relationId, plus
 *                               `data-relation-from-node-id` /
 *                               `data-relation-to-node-id` (visual direction)
 *         - root:               `data-diagram-id`
 *     → namespace every element id with the diagram id (no cross-diagram
 *       collisions inside a single document)
 *     → rebuild a standalone SVG string
 *
 * Failure model (all `VisualEngineError`, never silent):
 *  - `visual-engine/output-invalid`     — the region is not well-formed SVG;
 *  - `visual-engine/unsafe-output`      — elements / attributes / classes /
 *                                         references outside the strict allowlist;
 *  - `visual-engine/topology-mismatch`  — unknown node / edge identity or an edge
 *                                         direction that differs from the request.
 */

import { SaxesParser, type SaxesTagPlain } from "saxes";
import { VisualEngineError } from "./errors.js";
import { VISUAL_ENGINE_CLASS_MAP } from "./style-map.js";

/* ------------------------------------------------------------------ */
/* allowlists                                                          */
/* ------------------------------------------------------------------ */

/** Elements visual engine v2.16.0 architecture/workflow (classic, animation none)
 *  genuinely need. `pattern` is included: both renderers paint their
 *  background grid with it. Verified against real fixtures. */
const ALLOWED_ELEMENTS = new Set([
  "svg",
  "g",
  "defs",
  "marker",
  "pattern",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "title",
  "desc",
  "use",
]);

/** Exact attributes that survive (plus `aria-*`). */
const ALLOWED_ATTRIBUTES = new Set([
  // geometry
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "width",
  "height",
  "d",
  "points",
  "transform",
  "dx",
  "dy",
  // text
  "text-anchor",
  "font-size",
  "font-weight",
  // painting
  "fill",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-opacity",
  "fill-opacity",
  "fill-rule",
  "clip-rule",
  "opacity",
  "display",
  "visibility",
  // markers & references
  "marker-start",
  "marker-mid",
  "marker-end",
  "markerWidth",
  "markerHeight",
  "markerUnits",
  "refX",
  "refY",
  "orient",
  "patternUnits",
  "patternTransform",
  "preserveAspectRatio",
  // structure
  "viewBox",
  "id",
  "role",
  "xmlns",
  // ARCLUME provenance (injected only — never taken from input)
  "data-diagram-id",
  "data-entity-id",
  // visual node identity (kept alongside the semantic entityId)
  "data-node-id",
  "data-relation-id",
  "data-visual-edge-id",
  "data-relation-from-node-id",
  "data-relation-to-node-id",
  "data-step-id",
  "data-step-ref",
]);

/**
 * Known-benign visual engine attributes explicitly dropped: interactivity and
 * introspection hooks superseded by ARCLUME provenance. Anything not allowed
 * and not in this list is fatal — nothing else is silently stripped.
 */
const DROPPED_ATTRIBUTES = new Set([
  "tabindex",
  "focusable",
  "aria-pressed",
  "aria-hidden",
  "aria-label",
  "aria-labelledby",
  "lang",
  "data-node-id",
  "data-node-label",
  "data-node-kind",
  "data-node-context",
  "data-edge-from",
  "data-edge-to",
  "data-edge-key",
  "data-edge-label",
  "data-detail",
  "data-graph-role",
  "data-composition-points",
  "data-composition-frame-kind",
  "data-composition-frame-id",
  "data-composition-edge-from",
  "data-composition-edge-to",
  "data-composition-edge-id",
  "data-preset",
  "data-quality-profile",
  "data-quality-gates",
  "data-semantic-sigil",
]);

/** The class that marks a visual engine semantic-sigil subtree: removed whole. */
const SIGIL_CLASS = "semantic-sigil";

const URL_REF_RE = /^url\(\s*(['"]?)#([A-Za-z][A-Za-z0-9_.:-]*)\1\s*\)$/;
const LOCAL_HREF_RE = /^#([A-Za-z][A-Za-z0-9_.:-]*)$/;

/* ------------------------------------------------------------------ */
/* types                                                               */
/* ------------------------------------------------------------------ */

/** What ARCLUME expects the untrusted SVG to prove, per visual identity. */
export interface SanitizeExpectation {
  /**
   * visual node id → semantic identity. Architecture: `entityId` present.
   * Workflow: `ref` present.
   */
  nodeSemantics: ReadonlyMap<string, { entityId?: string; ref?: string }>;
  /** visual edge id → semantic relation id + authored visual direction. */
  edgeSemantics: ReadonlyMap<string, { relationId: string; from: string; to: string }>;
  visualKind: "architecture" | "workflow" | "dataflow" | "lifecycle" | "sequence";
  diagramId: string;
}

export interface SanitizedRelation {
  /** semantic relation id */
  relationId: string;
  /** visual edge id (maps exactly to the authored spec edge) */
  visualEdgeId: string;
  /** visual direction captured from the untrusted engine output */
  from: string;
  to: string;
}

/** What the sanitizer observed — the raw material of the validator. */
export interface SanitizedSummary {
  /** Architecture: semantic entity ids in doc order. Workflow: step ids. */
  nodes: string[];
  /** Visual→semantic node bindings actually observed (architecture). */
  visualNodes: Array<{ nodeId: string; entityId: string }>;
  /** semantic relation ids in doc order */
  relations: SanitizedRelation[];
  /** viewed node/step sets for set-equality checks */
  viewBox: { width: number; height: number };
}

export interface SanitizedSvg {
  svg: string;
  summary: SanitizedSummary;
}

interface XmlNode {
  name: string;
  attributes: Record<string, string>;
  children: Array<XmlNode | string>;
  selfClosing: boolean;
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">");
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '"').replace(/'/g, "'");
}

/* ------------------------------------------------------------------ */
/* main entry                                                          */
/* ------------------------------------------------------------------ */

/**
 * Extract, parse, sanitize and rebuild. Throws `VisualEngineError` with one of the
 * codes documented above. Never returns partial output; never passes anything
 * through unsanitized.
 */
export function sanitizeVisualEngineSvgRegion(
  html: string,
  expectation: SanitizeExpectation,
): SanitizedSvg {
  const die = (code: string, message: string): never => {
    throw new VisualEngineError(
      code as never,
      `[${expectation.diagramId}] ${message}`,
      expectation.diagramId,
    );
  };

  const region = extractSvgRegion(html, die);
  const root = parseSvg(region, die);

  const idSet = new Set<string>();
  collectIds(root, idSet, die);
  const idPrefix = `arcf-${expectation.diagramId}-`;

  const summary: SanitizedSummary = {
    nodes: [],
    visualNodes: [],
    relations: [],
    viewBox: { width: 0, height: 0 },
  };

  const svg = rebuildNode(root, {
    die,
    expectation,
    idSet,
    idPrefix,
    summary,
    seenEdgeIds: new Set<string>(),
  });
  if (svg === "") {
    die("visual-engine/output-invalid", "no SVG root survived sanitization");
  }
  return { svg, summary };
}

type Die = (code: string, message: string) => never;

/* ------------------------------------------------------------------ */
/* extraction + parse                                                  */
/* ------------------------------------------------------------------ */

function extractSvgRegion(html: string, die: Die): string {
  const start = html.indexOf("<svg");
  if (start < 0) return die("visual-engine/output-invalid", "no <svg> element in engine output");
  const end = html.indexOf("</svg>", start);
  if (end < 0)
    return die("visual-engine/output-invalid", "unterminated <svg> element in engine output");
  const region = html.slice(start, end + "</svg>".length);
  if (region.indexOf("<svg", 1) >= 0) {
    die("visual-engine/unsafe-output", "nested <svg> elements are not supported");
  }
  if (/<!\s*(doctype|entity)/i.test(region)) {
    die("visual-engine/unsafe-output", "DOCTYPE / ENTITY declarations are not allowed");
  }
  return region;
}

function parseSvg(region: string, die: Die): XmlNode {
  const parser = new SaxesParser({});
  let firstError: string | undefined;
  parser.on("error", (err: Error) => {
    if (firstError === undefined) firstError = err.message;
  });

  const stack: XmlNode[] = [];
  let root: XmlNode | undefined;

  parser.on("opentag", (tag: SaxesTagPlain) => {
    const name = tag.name;
    if (name.includes(":")) {
      die("visual-engine/unsafe-output", `prefixed element name "${name}" is not supported`);
    }
    if (!ALLOWED_ELEMENTS.has(name)) {
      die("visual-engine/unsafe-output", `element <${name}> is not in the allowlist`);
    }
    const attributes: Record<string, string> = {};
    for (const [attrName, attrValue] of Object.entries(tag.attributes)) {
      attributes[attrName] = String(attrValue);
    }
    const node: XmlNode = {
      name,
      attributes,
      children: [],
      selfClosing: Boolean(tag.isSelfClosing),
    };
    if (stack.length > 0) (stack[stack.length - 1] as XmlNode).children.push(node);
    else if (root === undefined) root = node;
    else die("visual-engine/output-invalid", "multiple root elements in SVG region");
    if (!node.selfClosing) stack.push(node);
  });

  parser.on("closetag", (tag: SaxesTagPlain) => {
    if (!tag.isSelfClosing) stack.pop();
  });

  parser.on("text", (text: string) => {
    if (stack.length === 0) return;
    (stack[stack.length - 1] as XmlNode).children.push(text);
  });

  parser.on("cdata", () => {
    die("visual-engine/unsafe-output", "CDATA sections are not allowed");
  });

  try {
    parser.write(region).close();
  } catch (err) {
    if (err instanceof VisualEngineError) throw err;
    die("visual-engine/output-invalid", `XML parse failure: ${(err as Error).message}`);
  }
  if (firstError !== undefined) {
    die("visual-engine/output-invalid", `XML parse failure: ${firstError}`);
  }
  if (root === undefined) die("visual-engine/output-invalid", "empty SVG region");
  if (root.name !== "svg") die("visual-engine/output-invalid", "the SVG root is not <svg>");
  if (stack.length !== 0) die("visual-engine/output-invalid", "unbalanced tags in SVG region");

  return root;
}

function collectIds(node: XmlNode, into: Set<string>, die: Die): void {
  const id = node.attributes["id"];
  if (id !== undefined) {
    if (!/^[A-Za-z][A-Za-z0-9_.:-]*$/.test(id)) {
      die("visual-engine/unsafe-output", `unsafe element id "${id}"`);
    }
    if (into.has(id)) die("visual-engine/output-invalid", `duplicate element id "${id}"`);
    into.add(id);
  }
  for (const child of node.children) {
    if (typeof child !== "string") collectIds(child, into, die);
  }
}

/* ------------------------------------------------------------------ */
/* rebuild                                                             */
/* ------------------------------------------------------------------ */

interface RebuildContext {
  die: Die;
  expectation: SanitizeExpectation;
  idSet: Set<string>;
  idPrefix: string;
  summary: SanitizedSummary;
  /** Edge ids already recorded in `summary.relations` — the sequence renderer
   * emits `data-edge-id` on more than one `<g>` per message. */
  seenEdgeIds: Set<string>;
}

function rebuildNode(node: XmlNode, ctx: RebuildContext): string {
  const { die, expectation } = ctx;
  const raw = node.attributes;

  const classes = (raw["class"] ?? "").split(/\s+/).filter(Boolean);
  if (classes.includes(SIGIL_CLASS) || raw["data-semantic-sigil"] !== undefined) {
    // Component-type sigils never survive: component.type is schema plumbing,
    // never semantics.
    return "";
  }

  // class → presentation attributes (unknown presentation class = fatal).
  const presentation: Record<string, string> = {};
  for (const cls of classes) {
    const mapped = VISUAL_ENGINE_CLASS_MAP[cls];
    if (mapped === undefined) {
      die("visual-engine/unsafe-output", `unknown presentation class "${cls}"`);
    }
    Object.assign(presentation, mapped);
  }

  const out: Record<string, string> = {};
  let nodeId: string | undefined;
  let edgeId: string | undefined;

  for (const [name, value] of Object.entries(raw)) {
    if (name === "class") continue;
    if (/^on/i.test(name)) die("visual-engine/unsafe-output", `event handler attribute "${name}"`);
    if (name === "style") die("visual-engine/unsafe-output", "style attributes are not allowed");

    if (name === "data-node-id") {
      nodeId = value;
      continue;
    }
    if (name === "data-edge-id") {
      edgeId = value;
      continue;
    }
    if (DROPPED_ATTRIBUTES.has(name)) continue;

    if (name === "role") {
      // Only the document image role survives; interactivity roles are dropped.
      if (node.name === "svg" && value === "img") out["role"] = "img";
      continue;
    }

    if (name === "id") {
      out["id"] = ctx.idPrefix + value;
      continue;
    }

    if (name === "href" || name === "xlink:href") {
      const m: RegExpExecArray | null = LOCAL_HREF_RE.exec(value);
      if (m === null || !ctx.idSet.has(m[1] as string)) {
        die("visual-engine/unsafe-output", `non-local or dangling reference "${value}"`);
      }
      const hrefId: string = m === null ? "" : (m[1] as string);
      out["href"] = `#${ctx.idPrefix}${hrefId}`;
      continue;
    }

    if (name.startsWith("aria-")) {
      out[name] = value;
      continue;
    }
    if (!ALLOWED_ATTRIBUTES.has(name)) {
      die("visual-engine/unsafe-output", `attribute "${name}" is not in the allowlist`);
    }

    if (/url\s*\(/i.test(value)) {
      const m = URL_REF_RE.exec(value);
      const refId = m?.[2];
      if (refId === undefined || !ctx.idSet.has(refId)) {
        die("visual-engine/unsafe-output", `non-local or dangling url() reference "${value}"`);
      }
      out[name] = `url(#${ctx.idPrefix}${refId})`;
      continue;
    }
    if (/javascript:/i.test(value)) {
      die("visual-engine/unsafe-output", `attribute "${name}" carries a javascript: URL`);
    }
    out[name] = value;
  }

  // Root normalization.
  if (node.name === "svg") {
    const vb: string | undefined = out["viewBox"];
    if (vb === undefined) die("visual-engine/output-invalid", "the SVG root has no viewBox");
    const vbValue = String(vb);
    const m: RegExpExecArray | null =
      /^-?\d+(?:\.\d+)?[ ,]+-?\d+(?:\.\d+)?[ ,]+(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)$/.exec(vbValue);
    if (m === null || Number(m[1]) <= 0 || Number(m[2]) <= 0) {
      die("visual-engine/output-invalid", `invalid viewBox "${vbValue}"`);
    }
    const vbMatch = m === null ? ["0", "0", "0"] : m;
    ctx.summary.viewBox = { width: Number(vbMatch[1]), height: Number(vbMatch[2]) };
    out["xmlns"] = "http://www.w3.org/2000/svg";
    out["data-diagram-id"] = expectation.diagramId;
  }

  // Provenance reinjection from the semantic↔visual maps (P1-1). Labels are
  // never identity.
  if (nodeId !== undefined) {
    const semantics = expectation.nodeSemantics.get(nodeId);
    if (semantics === undefined) {
      die("visual-engine/topology-mismatch", `engine emitted unknown node id "${nodeId}"`);
    }
    const sem = semantics as { entityId?: string; ref?: string };
    if (expectation.visualKind === "architecture") {
      const entityId = sem.entityId;
      if (entityId === undefined) {
        die(
          "visual-engine/topology-mismatch",
          `node "${nodeId}" has no entityId in the adaptation map`,
        );
      }
      out["data-entity-id"] = entityId as string;
      out["data-node-id"] = nodeId;
      ctx.summary.nodes.push(entityId as string);
      ctx.summary.visualNodes.push({ nodeId, entityId: entityId as string });
    } else {
      out["data-step-id"] = nodeId;
      if (sem.ref !== undefined) out["data-step-ref"] = sem.ref;
      ctx.summary.nodes.push(nodeId);
    }
  }
  // Architecture / workflow / dataflow / lifecycle carry a message/edge id on a
  // <path>; the vendored sequence renderer carries it on the message <g> (and a
  // second context <g>), both with data-edge-from / data-edge-to.
  const edgeCarrier =
    node.name === "path" || (expectation.visualKind === "sequence" && node.name === "g");
  if (edgeId !== undefined && edgeCarrier) {
    const expected = expectation.edgeSemantics.get(edgeId);
    if (expected === undefined) {
      die("visual-engine/topology-mismatch", `engine emitted unknown edge id "${edgeId}"`);
    }
    const exp = expected as { relationId: string; from: string; to: string };
    const from = raw["data-edge-from"];
    const to = raw["data-edge-to"];
    // A <g> that carries the id but not the endpoints (rare) is left to a
    // sibling element that does; a present-but-wrong endpoint is always fatal.
    if (from !== undefined && to !== undefined && (from !== exp.from || to !== exp.to)) {
      die(
        "visual-engine/topology-mismatch",
        `edge "${edgeId}" direction mismatch: expected ${exp.from}→${exp.to}, got ${String(from)}→${String(to)}`,
      );
    }
    out["data-relation-id"] = exp.relationId;
    out["data-visual-edge-id"] = edgeId;
    out["data-relation-from-node-id"] = exp.from;
    out["data-relation-to-node-id"] = exp.to;
    if (!ctx.seenEdgeIds.has(edgeId) && from !== undefined) {
      ctx.seenEdgeIds.add(edgeId);
      ctx.summary.relations.push({
        relationId: exp.relationId,
        visualEdgeId: edgeId,
        from: exp.from,
        to: exp.to,
      });
    }
  }

  const inner = node.children
    .map((child) =>
      typeof child === "string" ? escapeText(normalizeWhitespace(child)) : rebuildNode(child, ctx),
    )
    .filter((c) => c !== "")
    .join("");

  const finalAttributes = { ...out, ...presentation };
  const attrString = Object.keys(finalAttributes)
    .sort()
    .map((k) => ` ${k}="${escapeAttr(finalAttributes[k] as string)}"`)
    .join("");

  if (node.selfClosing || inner === "") return `<${node.name}${attrString}/>`;
  return `<${node.name}${attrString}>${inner}</${node.name}>`;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ");
}
