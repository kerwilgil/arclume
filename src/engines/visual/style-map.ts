/**
 * Visual Engine class → ARCLUME presentation-attribute map.
 *
 * The visual engine styles its SVG with document-scoped CSS classes. ARCLUME documents
 * never embed visual engine CSS, so the sanitizer replaces every known visual engine class
 * with ARCLUME-owned SVG presentation attributes and then removes `class`
 * entirely. The values reference ARCLUME theme tokens (CSS custom properties
 * defined by the single document stylesheet), so visual engine diagrams follow the
 * deck theme exactly like native diagrams.
 *
 * The map is scoped to `architecture` + `workflow`, `classic` preset,
 * `animation: none`, visual engine v2.16.0. A presentation class that the sanitizer
 * encounters but is not listed here is fatal (`visual-engine/unsafe-output`) — this
 * map is the coverage contract the vendor-upgrade tests must keep green.
 */

export interface VisualEnginePresentation {
  fill?: string;
  stroke?: string;
  "stroke-opacity"?: string;
  "stroke-dasharray"?: string;
}

const NODE_FILL = "var(--arclume-diagram-node-fill)";
const EDGE_STROKE = "var(--arclume-diagram-stroke)";
const TEXT_PRIMARY = "var(--arclume-color-text-primary)";
const TEXT_SECONDARY = "var(--arclume-color-text-secondary)";
const SURFACE = "var(--arclume-color-background)";
const STAGE = "var(--arclume-color-stage-ground)";

/** Component fills — every component type maps to the same ARCLUME node style
 *  (component *type* is sentinel plumbing, never semantics). */
const componentEntry: VisualEnginePresentation = { fill: NODE_FILL, stroke: EDGE_STROKE };

export const VISUAL_ENGINE_CLASS_MAP: Readonly<Record<string, VisualEnginePresentation>> = {
  /* background grid pattern */
  "c-grid": { stroke: EDGE_STROKE, fill: "none", "stroke-opacity": "0.18" },
  /* background mask (label cutouts, hover masks) */
  "c-mask": { fill: SURFACE, stroke: "none" },
  /* workflow lane band */
  "c-lane": { fill: STAGE, stroke: EDGE_STROKE, "stroke-opacity": "0.35" },

  /* component fills */
  "c-frontend": componentEntry,
  "c-backend": componentEntry,
  "c-database": componentEntry,
  "c-cloud": componentEntry,
  "c-security": componentEntry,
  "c-messagebus": componentEntry,
  "c-external": componentEntry,

  /* text */
  "t-primary": { fill: TEXT_PRIMARY },
  "t-muted": { fill: TEXT_SECONDARY },
  "t-dim": { fill: TEXT_SECONDARY },
  "t-backend": { fill: TEXT_PRIMARY },

  /* edges */
  "a-default": { stroke: EDGE_STROKE, fill: "none" },
  "a-emphasis": { stroke: EDGE_STROKE, fill: "none" },
  "a-security": { stroke: EDGE_STROKE, fill: "none", "stroke-dasharray": "5,5" },
  "a-dashed": { stroke: EDGE_STROKE, fill: "none", "stroke-dasharray": "4,4" },

  /* arrowhead markers (defs always declare all four variants) */
  "m-default": { fill: EDGE_STROKE },
  "m-emphasis": { fill: EDGE_STROKE },
  "m-security": { fill: EDGE_STROKE },
  "m-dashed": { fill: EDGE_STROKE },
};

/** True when `cls` is a visual engine presentation class ARCLUME knows how to map. */
export function isKnownVisualEngineClass(cls: string): boolean {
  return Object.hasOwn(VISUAL_ENGINE_CLASS_MAP, cls);
}
