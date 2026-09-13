/**
 * Final-form artifact validation — trust boundary.
 *
 * A `ResolvedDiagramArtifact` is caller-controlled data. Before canonical /
 * delivery surfaces accept a `kind: "svg"` artifact, the final SVG is parsed
 * again from its bytes and every claim is re-derived independently:
 *
 *  1. rooted well-formedness: exactly one document root, that root IS the
 *     artifact SVG (no wrapping groups, no nested/second `<svg>`);
 *  2. element + attribute allowlists (the exact grammar the sanitizer emits);
 *  3. no XML surface the sanitizer never produces (DOCTYPE / ENTITY / CDATA /
 *     processing instructions / XML declarations / comments);
 *  4. physical viewBox (minX/minY finite, width/height > 0);
 *  5. two-pass local references: every `url(#id)` / fragment reference must
 *     resolve to an `id` declared in the same document;
 *  6. diagramId binding;
 *  7. visual↔semantic MAPPINGS (not just sets) vs the CURRENT deck spec:
 *     - architecture: data-node-id → data-entity-id must equal
 *       `nodeToEntity` exactly (swapping two entity ids is fatal);
 *     - workflow: data-step-id → data-step-ref exact against `stepToRef`;
 *     - edges: data-visual-edge-id → data-relation-id and direction must
 *       equal `maps.edgeToRelation` / `maps.edgeDirection` exactly
 *       (parallel edges over the same endpoints stay distinguishable);
 *  8. svgSha256 recomputation.
 *
 * Codes: structural problems are `visual-engine/output-invalid`; anything with
 * active or unlinkable content is `visual-engine/unsafe-output`; wrong identity
 * bindings are `visual-engine/topology-mismatch` / `visual-engine/provenance-loss`.
 */

import { SaxesParser, type SaxesTagPlain } from "saxes";
import { sha256Hex } from "../../determinism/hash.js";
import type { DiagramIR } from "../../types/deck.js";
import type { ResolvedDiagramArtifact } from "../types.js";
import { adaptDiagramToVisualEngine } from "./adapter.js";
import { VisualEngineError } from "./errors.js";
import type { SanitizedSummary } from "./sanitize.js";

/* ------------------------------------------------------------------ */
/* the exact final grammar                                             */
/* ------------------------------------------------------------------ */

/** Elements the sanitizer can emit. */
const FINAL_ELEMENTS = new Set([
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
]);

/**
 * Attributes the sanitizer can emit. No `href`, no `use`: the v2.16.0 output
 * we sanitize never uses them, and the final form must stay exactly what the
 * sanitizer writes (no dead acceptance surface).
 */
const FINAL_ATTRIBUTES = new Set([
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
  // ARCLUME provenance
  "data-diagram-id",
  "data-entity-id",
  "data-node-id",
  "data-relation-id",
  "data-visual-edge-id",
  "data-relation-from-node-id",
  "data-relation-to-node-id",
  "data-step-id",
  "data-step-ref",
]);

const URL_REF_RE = /^url\(\s*(['"]?)#([A-Za-z][A-Za-z0-9_.:-]*)\1\s*\)$/;

export interface FinalFormIssue {
  code:
    | "visual-engine/unsafe-output"
    | "visual-engine/output-invalid"
    | "visual-engine/topology-mismatch"
    | "visual-engine/provenance-loss";
  message: string;
}

type Die = (code: FinalFormIssue["code"], message: string) => never;

interface NodeMapping {
  nodeId: string;
  entityId?: string;
  stepRef?: string;
}
interface EdgeMapping {
  visualEdgeId: string;
  relationId: string;
  from: string;
  to: string;
}

interface Parsed {
  declaredIds: Set<string>;
  referencedIds: Set<string>;
  diagramId: string | undefined;
  viewBox: { minX: number; minY: number; width: number; height: number } | undefined;
  /** data-node-id → data-entity-id bindings in doc order (architecture). */
  nodeBindings: NodeMapping[];
  /** data-step-id → data-step-ref bindings in doc order (workflow). */
  stepBindings: NodeMapping[];
  /** visual edge bindings in doc order. */
  edgeBindings: EdgeMapping[];
}

function parseFinalSvg(svg: string, die: Die): Parsed {
  const out: Parsed = {
    declaredIds: new Set(),
    referencedIds: new Set(),
    diagramId: undefined,
    viewBox: undefined,
    nodeBindings: [],
    stepBindings: [],
    edgeBindings: [],
  };

  const parser = new SaxesParser({});
  let firstError: string | undefined;
  parser.on("error", (err: Error) => {
    if (firstError === undefined) firstError = err.message;
  });

  // XML surface the sanitizer never emits — hard reject.
  parser.on("comment", () =>
    die("visual-engine/output-invalid", "comments are not part of the final form"),
  );
  parser.on("cdata", () => die("visual-engine/unsafe-output", "CDATA is not allowed"));
  parser.on("doctype", () => die("visual-engine/output-invalid", "DOCTYPE is not allowed"));
  const parserWithPi = parser as SaxesParser & {
    on: (event: string, handler: (d: unknown) => void) => void;
  };
  parserWithPi.on("processinginstruction", () =>
    die("visual-engine/output-invalid", "processing instructions are not allowed"),
  );
  parserWithPi.on("xmldecl", () =>
    die("visual-engine/output-invalid", "an XML declaration is not allowed"),
  );

  const stack: string[] = [];
  let roots = 0;
  let rootIsSvg = false;

  parser.on("opentag", (tag: SaxesTagPlain) => {
    const name = tag.name;
    if (stack.length === 0) {
      roots += 1;
      if (roots > 1) die("visual-engine/output-invalid", "multiple document roots");
      rootIsSvg = name === "svg";
    } else if (name === "svg") {
      die("visual-engine/output-invalid", "nested <svg> is not the final form of an artifact");
    }

    if (!FINAL_ELEMENTS.has(name))
      die("visual-engine/unsafe-output", `element <${name}> not allowed`);

    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(tag.attributes)) attrs[k] = String(v);

    for (const [attrName, value] of Object.entries(attrs)) {
      if (/^on/i.test(attrName)) die("visual-engine/unsafe-output", `event handler "${attrName}"`);
      if (attrName === "class") die("visual-engine/unsafe-output", "class attribute in final SVG");
      if (attrName === "style") die("visual-engine/unsafe-output", "style attribute in final SVG");
      if (attrName.startsWith("aria-")) continue;
      if (!FINAL_ATTRIBUTES.has(attrName)) {
        die("visual-engine/unsafe-output", `attribute "${attrName}" not allowed in final SVG`);
      }
      if (attrName === "id") {
        if (out.declaredIds.has(value))
          die("visual-engine/output-invalid", `duplicate id "${value}"`);
        out.declaredIds.add(value);
      }
      if (/url\s*\(/i.test(value)) {
        const m = URL_REF_RE.exec(value);
        if (m === null) die("visual-engine/unsafe-output", `non-local url() "${value}"`);
        else out.referencedIds.add(m[2] as string);
      }
    }

    if (name === "svg") {
      if (attrs["xmlns"] !== "http://www.w3.org/2000/svg") {
        die(
          "visual-engine/output-invalid",
          `the SVG root must carry xmlns="http://www.w3.org/2000/svg"`,
        );
      }
      out.diagramId = attrs["data-diagram-id"];
      const vb = attrs["viewBox"];
      if (vb === undefined) die("visual-engine/output-invalid", "missing viewBox");
      const parts = vb.split(/[ ,]+/).filter((p) => p !== "");
      if (parts.length !== 4) die("visual-engine/output-invalid", `malformed viewBox "${vb}"`);
      const nums = parts.map((p) => Number(p));
      if (nums.some((n) => !Number.isFinite(n))) {
        die("visual-engine/output-invalid", `non-finite viewBox "${vb}"`);
      }
      const [minX, minY] = [nums[0] as number, nums[1] as number];
      const width = nums[2] as number;
      const height = nums[3] as number;
      if (width <= 0 || height <= 0) {
        die("visual-engine/output-invalid", `non-positive viewBox dimensions "${vb}"`);
      }
      out.viewBox = { minX, minY, width, height };
    }

    const nodeId = attrs["data-node-id"];
    const entityId = attrs["data-entity-id"];
    if (nodeId !== undefined || entityId !== undefined) {
      if (nodeId === undefined || entityId === undefined) {
        die("visual-engine/provenance-loss", "incomplete visual→semantic node binding");
      }
      out.nodeBindings.push({ nodeId, entityId });
    }
    const stepId = attrs["data-step-id"];
    const stepRef = attrs["data-step-ref"];
    if (stepId !== undefined || stepRef !== undefined) {
      if (stepId === undefined || stepRef === undefined) {
        die("visual-engine/provenance-loss", "incomplete step↔ref binding");
      }
      out.stepBindings.push({ nodeId: stepId, stepRef });
    }
    const relationId = attrs["data-relation-id"];
    if (relationId !== undefined) {
      const visualEdgeId = attrs["data-visual-edge-id"];
      const from = attrs["data-relation-from-node-id"];
      const to = attrs["data-relation-to-node-id"];
      if (visualEdgeId === undefined || from === undefined || to === undefined) {
        die(
          "visual-engine/provenance-loss",
          `relation "${relationId}" lacks visual identity or endpoint evidence`,
        );
      }
      out.edgeBindings.push({
        visualEdgeId: visualEdgeId as string,
        relationId,
        from: from as string,
        to: to as string,
      });
    }

    if (!tag.isSelfClosing) stack.push(name);
  });
  parser.on("closetag", (tag: SaxesTagPlain) => {
    if (!tag.isSelfClosing) stack.pop();
  });

  try {
    parser.write(svg).close();
  } catch (err) {
    if (err instanceof VisualEngineError) throw err;
    die("visual-engine/output-invalid", `final SVG parse failure: ${(err as Error).message}`);
  }
  if (firstError !== undefined)
    die("visual-engine/output-invalid", `final SVG parse failure: ${firstError}`);
  if (stack.length !== 0) die("visual-engine/output-invalid", "unbalanced tags in final SVG");

  if (roots === 0) die("visual-engine/output-invalid", "empty document");
  if (!rootIsSvg) die("visual-engine/output-invalid", "the document root is not <svg>");

  // two-pass: every local reference must resolve to a declared id
  for (const ref of out.referencedIds) {
    if (!out.declaredIds.has(ref)) {
      die("visual-engine/unsafe-output", `dangling local reference "#${ref}" in final SVG`);
    }
  }

  return out;
}

/**
 * Derive the semantic expectation from the CURRENT deck spec (the adapter is
 * authoritative about what a diagram of this spec must contain).
 */
export interface FinalFormExpectation {
  visualToEntity: Map<string, string>;
  stepToRef: Map<string, string>;
  edgeToBinding: Map<string, { relationId: string; from: string; to: string }>;
}

export function finalFormExpectation(diagram: DiagramIR): FinalFormExpectation {
  const adaptation = adaptDiagramToVisualEngine(diagram);
  if (adaptation.kind !== "ok") {
    throw new VisualEngineError(adaptation.code as never, adaptation.message, adaptation.diagramId);
  }
  const edgeToBinding = new Map<string, { relationId: string; from: string; to: string }>();
  for (const [visualId, rel] of adaptation.maps.edgeToRelation) {
    const dir = adaptation.maps.edgeDirection.get(visualId) as { from: string; to: string };
    edgeToBinding.set(visualId, { relationId: rel, from: dir.from, to: dir.to });
  }
  return {
    visualToEntity: adaptation.maps.nodeToEntity,
    stepToRef: adaptation.maps.stepToRef,
    edgeToBinding,
  };
}

function uniqueBindingKeys(values: readonly string[], kind: string, die: Die): void {
  const seen = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) {
      die(
        "visual-engine/topology-mismatch",
        `duplicate ${kind} binding key "${v}" — one-to-one artifact identity violated`,
      );
    }
    seen.add(v);
  }
}

function mapEquals(
  given: ReadonlyMap<string, string>,
  expected: ReadonlyMap<string, string>,
): { equal: boolean; problem?: string } {
  if (given.size !== expected.size) return { equal: false, problem: "size" };
  for (const [k, v] of expected) {
    if (given.get(k) !== v) return { equal: false, problem: `key "${k}"` };
  }
  for (const k of given.keys()) {
    if (!expected.has(k)) return { equal: false, problem: `unexpected key "${k}"` };
  }
  return { equal: true };
}

/**
 * Revalidate an artifact's final SVG against the deck's current diagram
 * (independent derivation). Fatal `VisualEngineError` on any mismatch.
 */
export function validateResolvedArtifactFinalForm(
  artifact: ResolvedDiagramArtifact,
  diagram: DiagramIR,
): SanitizedSummary {
  const die: Die = (code, message) => {
    throw new VisualEngineError(code, message, diagram.id);
  };

  if (artifact.kind !== "svg") {
    die("visual-engine/output-invalid", "final-form validation applies to kind=svg artifacts");
  }
  const svgArtifact = artifact as Extract<ResolvedDiagramArtifact, { kind: "svg" }>;

  if (sha256Hex(svgArtifact.svg) !== svgArtifact.svgSha256) {
    die("visual-engine/output-invalid", "artifact.svg does not hash to artifact.svgSha256");
  }
  if (svgArtifact.diagramId !== diagram.id) {
    die(
      "visual-engine/output-invalid",
      `artifact is for "${svgArtifact.diagramId}", not "${diagram.id}"`,
    );
  }

  const parsed = parseFinalSvg(svgArtifact.svg, die);

  if (parsed.diagramId !== diagram.id) {
    die(
      "visual-engine/provenance-loss",
      `final SVG data-diagram-id "${String(parsed.diagramId)}" != "${diagram.id}"`,
    );
  }

  const expected = finalFormExpectation(diagram);

  // One-to-one identity: an artifact must contain exactly one physical
  // representation per visual / semantic identity. Never let `new Map()`
  // silently collapse duplicates.
  uniqueBindingKeys(
    parsed.nodeBindings.map((b) => b.nodeId),
    "data-node-id",
    die,
  );
  uniqueBindingKeys(
    parsed.stepBindings.map((b) => b.nodeId),
    "data-step-id",
    die,
  );
  uniqueBindingKeys(
    parsed.edgeBindings.map((b) => b.visualEdgeId),
    "data-visual-edge-id",
    die,
  );
  // Architecture semantic identity is one-to-one as well.
  uniqueBindingKeys(
    parsed.nodeBindings.map((b) => b.entityId as string),
    "data-entity-id",
    die,
  );

  // Mirror the exact maps — never just the sets (P1: swapping two entity ids
  // swaps the bindings while keeping the set).
  const givenNodes = new Map(parsed.nodeBindings.map((b) => [b.nodeId, b.entityId as string]));
  const nodesCmp = mapEquals(givenNodes, expected.visualToEntity);
  if (!nodesCmp.equal) {
    die(
      "visual-engine/topology-mismatch",
      `final SVG visual→entity bindings differ from the deck (${nodesCmp.problem})`,
    );
  }

  const givenSteps = new Map(parsed.stepBindings.map((b) => [b.nodeId, b.stepRef as string]));
  const stepsCmp = mapEquals(givenSteps, expected.stepToRef);
  if (!stepsCmp.equal) {
    die(
      "visual-engine/topology-mismatch",
      `final SVG step→ref bindings differ from the deck (${stepsCmp.problem})`,
    );
  }

  const givenEdges = new Map(
    parsed.edgeBindings.map((b) => [
      b.visualEdgeId,
      { relationId: b.relationId, from: b.from, to: b.to },
    ]),
  );
  if (givenEdges.size !== expected.edgeToBinding.size) {
    die("visual-engine/topology-mismatch", "final SVG relation count differs from the deck");
  }
  for (const [edgeId, exp] of expected.edgeToBinding) {
    const got = givenEdges.get(edgeId);
    if (got === undefined) {
      die("visual-engine/provenance-loss", `relation for visual edge "${edgeId}" is missing`);
    }
    if (got.relationId !== exp.relationId || got.from !== exp.from || got.to !== exp.to) {
      die(
        "visual-engine/topology-mismatch",
        `edge "${edgeId}" binding mismatch: expected ${exp.relationId} (${exp.from}→${exp.to}), found ${got.relationId} (${got.from}→${got.to})`,
      );
    }
  }
  for (const [edgeId] of givenEdges) {
    if (!expected.edgeToBinding.has(edgeId)) {
      die("visual-engine/topology-mismatch", `final SVG carries unknown relation edge "${edgeId}"`);
    }
  }

  return {
    nodes: parsed.nodeBindings.map((b) => b.entityId as string),
    visualNodes: parsed.nodeBindings.map((b) => ({
      nodeId: b.nodeId,
      entityId: b.entityId as string,
    })),
    relations: parsed.edgeBindings,
    viewBox: {
      width: parsed.viewBox?.width ?? 0,
      height: parsed.viewBox?.height ?? 0,
    },
  };
}
