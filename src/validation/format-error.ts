/**
 * Turns raw AJV errors into {@link ValidationIssue}s enriched with context:
 * a stable `code`, a readable `message`, the nearest labeled ancestor
 * (`entityId` / `entityKind` / `label`), and a `hint` where useful.
 */

import type { ErrorObject } from "ajv";
import type { ValidationIssue } from "./result.js";

/** Decode one RFC 6901 JSON Pointer reference token. */
function decodeToken(token: string): string {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

/** Split an RFC 6901 JSON Pointer into decoded segments (`""` -> `[]`). */
export function pointerSegments(pointer: string): string[] {
  if (pointer === "") return [];
  return pointer.split("/").slice(1).map(decodeToken);
}

/** Navigate `doc` by `pointer`; returns `undefined` if any segment is missing. */
export function resolvePointer(doc: unknown, pointer: string): unknown {
  let current: unknown = doc;
  for (const seg of pointerSegments(pointer)) {
    if (Array.isArray(current)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0 || idx >= current.length) return undefined;
      current = current[idx];
    } else if (current !== null && typeof current === "object") {
      current = (current as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return current;
}

const LABEL_KEYS = ["name", "title", "label", "statement", "question", "keyMessage"] as const;

/** Singularize the common plural collection names used in the two schemas. */
function singularize(segment: string): string {
  const map: Record<string, string> = {
    slides: "slide",
    blocks: "block",
    sections: "section",
    diagrams: "diagram",
    components: "component",
    capabilities: "capability",
    actors: "actor",
    dependencies: "dependency",
    processes: "process",
    phases: "phase",
    milestones: "milestone",
    metrics: "metric",
    risks: "risk",
    decisions: "decision",
    requirements: "requirement",
    technologies: "technology",
    results: "result",
    constraints: "constraint",
    relations: "relation",
    claims: "claim",
    gaps: "gap",
    sources: "source",
    rows: "row",
    steps: "step",
  };
  return map[segment] ?? segment;
}

export interface AncestorContext {
  entityId?: string;
  entityKind?: string;
  label?: string;
}

/**
 * Walk from the error's instance path up to the root, returning the nearest
 * object that carries an `id` or a human label.
 */
export function nearestLabeledAncestor(doc: unknown, instancePath: string): AncestorContext {
  const segs = pointerSegments(instancePath);
  for (let end = segs.length; end >= 0; end -= 1) {
    const subPointer = end === 0 ? "" : `/${segs.slice(0, end).map(rfc6901).join("/")}`;
    const node = resolvePointer(doc, subPointer);
    if (node === null || typeof node !== "object" || Array.isArray(node)) continue;
    const obj = node as Record<string, unknown>;
    const hasId = typeof obj["id"] === "string";
    const labelKey = LABEL_KEYS.find((k) => typeof obj[k] === "string");
    if (!hasId && labelKey === undefined) continue;

    const ctx: AncestorContext = {};
    if (hasId) ctx.entityId = obj["id"] as string;
    if (labelKey !== undefined) {
      ctx.label = truncate(obj[labelKey] as string, 80);
    }
    // entity kind comes from the collection segment that precedes this node
    const preceding = end >= 2 ? segs[end - 2] : end === 1 ? segs[0] : undefined;
    if (preceding !== undefined && Number.isNaN(Number(segs[end - 1]))) {
      // node is a named property (e.g. `project`), not an array element
      ctx.entityKind = singularize(segs[end - 1] as string);
    } else if (preceding !== undefined) {
      ctx.entityKind = singularize(preceding);
    }
    return ctx;
  }
  return {};
}

function rfc6901(seg: string): string {
  return seg.replace(/~/g, "~0").replace(/\//g, "~1");
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

const RANGE_KEYWORDS = new Set([
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minProperties",
  "maxProperties",
]);

/** Stable machine-readable slug for an AJV error. */
export function codeForAjvError(err: ErrorObject): string {
  switch (err.keyword) {
    case "additionalProperties":
    case "unevaluatedProperties":
      return "schema/additional-properties";
    case "required":
      return "schema/required";
    case "enum":
      return "schema/enum";
    case "const":
      return "schema/const";
    case "type":
      return "schema/type";
    case "pattern":
      return "schema/pattern";
    case "format":
      return "schema/format";
    case "oneOf":
      return "schema/one-of";
    case "anyOf":
      return "schema/any-of";
    default:
      return RANGE_KEYWORDS.has(err.keyword) ? "schema/range" : `schema/${err.keyword}`;
  }
}

/** Readable message for an AJV error, including the offending parameter. */
export function messageForAjvError(err: ErrorObject): string {
  const params = err.params as Record<string, unknown>;
  switch (err.keyword) {
    case "additionalProperties":
    case "unevaluatedProperties":
      return `unknown property "${String(params["additionalProperty"])}" is not allowed`;
    case "required":
      return `missing required property "${String(params["missingProperty"])}"`;
    case "enum": {
      const allowed = Array.isArray(params["allowedValues"])
        ? (params["allowedValues"] as unknown[]).join(", ")
        : "";
      return `value is not one of the allowed values [${allowed}]`;
    }
    case "const":
      return `value must be ${JSON.stringify(params["allowedValue"])}`;
    case "oneOf":
      return "value does not match exactly one of the allowed shapes";
    case "pattern":
      return `value does not match required pattern ${String(params["pattern"])}`;
    case "type":
      return `value must be of type ${String(params["type"])}`;
    default:
      return err.message ?? `constraint "${err.keyword}" failed`;
  }
}

function hintForAjvError(err: ErrorObject, code: string): string | undefined {
  if (code === "schema/additional-properties") {
    return "remove the property or check for a typo against the schema";
  }
  if (err.keyword === "oneOf") {
    return "for blocks, set a valid `type` and provide exactly the fields that variant requires";
  }
  return undefined;
}

const KNOWN_BLOCK_TYPES = new Set([
  "text",
  "metric",
  "metric-grid",
  "comparison",
  "timeline",
  "roadmap",
  "risk",
  "status",
  "callout",
  "quote",
  "table",
  "image",
  "code",
  "diagram",
  "architecture",
  "workflow",
]);

/**
 * `oneOf` on the block schema produces one umbrella error plus the failures of
 * every non-matching branch. When the block has a recognizable `type`, keep the
 * umbrella error (with a precise message) and the branch errors for that type,
 * and drop the rest as noise.
 */
function refineBlockOneOf(errors: ErrorObject[], doc: unknown): ErrorObject[] {
  const oneOfErrors = errors.filter(
    (e) => e.keyword === "oneOf" && /\/blocks\/\d+$/.test(e.instancePath),
  );
  if (oneOfErrors.length === 0) return errors;

  const dropped = new Set<ErrorObject>();
  for (const oneOf of oneOfErrors) {
    const block = resolvePointer(doc, oneOf.instancePath) as { type?: unknown } | undefined;
    const type = typeof block?.type === "string" ? block.type : undefined;
    const branchErrors = errors.filter(
      (e) => e !== oneOf && e.instancePath.startsWith(oneOf.instancePath),
    );
    if (type === undefined || !KNOWN_BLOCK_TYPES.has(type)) {
      // keep only the umbrella error; branch errors are unhelpful here
      for (const e of branchErrors) dropped.add(e);
      continue;
    }
    const variant = blockVariantToken(type);
    for (const e of branchErrors) {
      if (!e.schemaPath.includes(variant)) dropped.add(e);
    }
  }
  return errors.filter((e) => !dropped.has(e));
}

/** Map a block `type` to the `$defs` token used in its schemaPath. */
function blockVariantToken(type: string): string {
  const pascal = type
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
  return `/block${pascal}`;
}

/**
 * Convert a batch of AJV errors for one document into enriched issues.
 */
export function formatAjvErrors(
  errors: readonly ErrorObject[] | null | undefined,
  doc: unknown,
): ValidationIssue[] {
  if (!errors || errors.length === 0) return [];
  const refined = refineBlockOneOf([...errors], doc);

  const seen = new Set<string>();
  const issues: ValidationIssue[] = [];
  for (const err of refined) {
    const code = codeForAjvError(err);
    const message = messageForAjvError(err);
    const dedupeKey = `${err.instancePath}|${err.keyword}|${message}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const ctx = nearestLabeledAncestor(doc, err.instancePath);
    const hint = hintForAjvError(err, code);
    const issue: ValidationIssue = {
      severity: "error",
      code,
      message,
      instancePath: err.instancePath === "" ? "/" : err.instancePath,
      schemaPath: err.schemaPath,
    };
    if (ctx.entityId !== undefined) issue.entityId = ctx.entityId;
    if (ctx.entityKind !== undefined) issue.entityKind = ctx.entityKind;
    if (ctx.label !== undefined) issue.label = ctx.label;
    if (hint !== undefined) issue.hint = hint;
    issues.push(issue);
  }
  return issues;
}
