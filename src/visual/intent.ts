/**
 * Visual intent resolution (Phase 4, extended in Slice 2B).
 *
 * `SlidePlan` proposes a `visualIntent` (+ `visualCandidates`). The
 * VisualDirector never trusts it blindly: it re-checks the real knowledge and
 * either ACCEPTS, REFINES (same family, better fit) or DOWNGRADES it to a form
 * that is actually supported. It never invents topology, metrics or dates to
 * keep a richer form.
 *
 * Slice 2B adds an auditable `reasonCode` (closed union), the `evidenceRefs`
 * subset (considered ids whose entities carry a `SourceRef`) and, on a
 * downgrade, the `fallbackKind` that the evidence did not support. No
 * chain-of-thought is stored — only the structured decision.
 */

import type { KnowledgeView } from "../narrative/knowledge-view.js";
import type { PlannedSlide, VisualIntent } from "../planning/types.js";
import type { Id } from "../types/common.js";
import { buildArchitectureModel, buildFlowModel, buildTimelineModel } from "./models.js";
import type {
  VisualKind,
  VisualLimits,
  VisualReasonCode,
  VisualResolutionOutcome,
} from "./types.js";

export interface ResolvedVisual {
  visualKind: VisualKind;
  outcome: VisualResolutionOutcome;
  /** Auditable, closed-set reason for this resolution. */
  reasonCode: VisualReasonCode;
  reason: string;
  /** ids considered for the visual (knowledgeRefs ∪ visualCandidates). */
  consideredRefs: Id[];
  /** Subset of `consideredRefs` whose entities carry ≥1 `SourceRef`. */
  evidenceRefs: Id[];
  /** On a downgrade, the richer kind the evidence did not support. */
  fallbackKind?: VisualKind;
}

function considered(slide: PlannedSlide): Id[] {
  return [...new Set([...slide.knowledgeRefs, ...(slide.visualCandidates ?? [])])];
}

/** ids in `refs` that resolve to a knowledge item carrying at least one SourceRef. */
export function evidenceRefsOf(view: KnowledgeView, refs: readonly Id[]): Id[] {
  return refs.filter((id) => {
    const item = view.byId.get(id);
    return item !== undefined && item.sourceRefs.length > 0;
  });
}

/** The `VisualKind` a requested `VisualIntent` maps to (for `fallbackKind`). */
export function intentToKind(intent: VisualIntent): VisualKind {
  return intent === "process" ? "process" : (intent as VisualKind);
}

function has(
  view: KnowledgeView,
  ids: readonly Id[],
  pred: (collection: string, raw: Record<string, unknown>) => boolean,
): boolean {
  for (const id of ids) {
    const item = view.byId.get(id);
    if (item && pred(item.collection, item.raw)) return true;
  }
  return false;
}

function count(view: KnowledgeView, ids: readonly Id[], collection: string): number {
  let n = 0;
  for (const id of ids) if (view.byId.get(id)?.collection === collection) n += 1;
  return n;
}

export function resolveVisual(
  slide: PlannedSlide,
  view: KnowledgeView,
  limits: VisualLimits,
): ResolvedVisual {
  const refs = considered(slide);
  const evidenceRefs = evidenceRefsOf(view, refs);
  const intent = slide.visualIntent;
  const accept = (
    visualKind: VisualKind,
    reasonCode: VisualReasonCode,
    reason: string,
  ): ResolvedVisual => ({
    visualKind,
    outcome: "accepted",
    reasonCode,
    reason,
    consideredRefs: refs,
    evidenceRefs,
  });
  const refine = (
    visualKind: VisualKind,
    reasonCode: VisualReasonCode,
    reason: string,
  ): ResolvedVisual => ({
    visualKind,
    outcome: "refined",
    reasonCode,
    reason,
    consideredRefs: refs,
    evidenceRefs,
  });
  const downgrade = (
    visualKind: VisualKind,
    reasonCode: VisualReasonCode,
    reason: string,
  ): ResolvedVisual => ({
    visualKind,
    outcome: "downgraded",
    reasonCode,
    reason,
    consideredRefs: refs,
    evidenceRefs,
    fallbackKind: intentToKind(intent),
  });

  if (slide.kind === "cover" || slide.kind === "closing" || intent === "none") {
    return accept("none", "intent-none", "cover/closing slides carry no structural visual");
  }

  const metricBacked =
    has(view, refs, (c, raw) => c === "metrics" && typeof raw["value"] === "string") ||
    slide.claimRefs.some((id) => view.byId.get(id)?.factType === "FACT");

  switch (intent) {
    case "architecture": {
      if (buildArchitectureModel(view, refs, limits)) {
        return accept(
          "architecture",
          "intent-accepted",
          "components and ≥1 real relation support a native architecture model",
        );
      }
      if (count(view, refs, "components") >= 2) {
        return downgrade(
          "relationship",
          "fallback-relationship-no-edge",
          "components present but no relation connects two of them",
        );
      }
      return downgrade(
        "summary",
        "fallback-summary-no-evidence",
        "not enough structural knowledge for an architecture visual",
      );
    }
    case "process": {
      if (buildFlowModel(view, refs, "process", limits)) {
        return accept(
          "process",
          "intent-accepted",
          "a process with real steps (or PRECEDES relations) supports a flow",
        );
      }
      return downgrade(
        "summary",
        "fallback-summary-no-evidence",
        "no process steps or PRECEDES relations behind this slide",
      );
    }
    case "sequence": {
      if (buildFlowModel(view, refs, "sequence", limits)) {
        return accept(
          "sequence",
          "intent-accepted",
          "PRECEDES relations (or ordered steps) support a sequence",
        );
      }
      if (buildFlowModel(view, refs, "process", limits)) {
        return refine(
          "process",
          "intent-refined",
          "no strict sequence; ordered process steps are available",
        );
      }
      return downgrade(
        "summary",
        "fallback-summary-no-evidence",
        "no ordering evidence behind this slide",
      );
    }
    case "metrics": {
      if (metricBacked)
        return accept(
          "metrics",
          "metrics-backed",
          "at least one real metric value (or FACT claim) backs the slide",
        );
      return downgrade(
        "summary",
        "fallback-summary-no-evidence",
        "no metric with a value and no FACT claim to quantify",
      );
    }
    case "roadmap": {
      if (buildTimelineModel(view, refs, "roadmap", limits)) {
        return accept(
          "roadmap",
          "intent-accepted",
          "phases / milestones give an ordered progression",
        );
      }
      if (buildTimelineModel(view, refs, "timeline", limits)) {
        return refine(
          "timeline",
          "intent-refined",
          "temporal evidence exists but not an ordered roadmap",
        );
      }
      return downgrade(
        "status",
        "fallback-summary-no-evidence",
        "no phases, milestones or dated temporal evidence",
      );
    }
    case "timeline": {
      if (buildTimelineModel(view, refs, "timeline", limits)) {
        return accept(
          "timeline",
          "intent-accepted",
          "dated milestones / phases support a timeline",
        );
      }
      if (buildTimelineModel(view, refs, "roadmap", limits)) {
        return refine("roadmap", "intent-refined", "phases present but without explicit dates");
      }
      return downgrade(
        "summary",
        "fallback-summary-no-evidence",
        "no temporal evidence for a timeline",
      );
    }
    case "risk": {
      if (count(view, refs, "risks") >= 1)
        return accept("risk", "risk-tracked", "tracked risks back this slide");
      if (count(view, refs, "gaps") >= 1)
        return refine("risk", "risk-tracked", "open questions are shown as risk-shaped items");
      return downgrade("summary", "fallback-summary-no-evidence", "no risks or gaps to show");
    }
    case "status": {
      return accept(
        "status",
        "status-derived",
        "status is derived from project.status / phase status / gaps",
      );
    }
    case "relationship": {
      if (has(view, refs, (c) => c === "relations")) {
        return accept(
          "relationship",
          "intent-accepted",
          "≥1 real relation among the referenced entities",
        );
      }
      return downgrade("summary", "fallback-summary-no-evidence", "no relation to draw");
    }
    case "hierarchy": {
      if (has(view, refs, (_c, raw) => raw["type"] === "PART_OF")) {
        return accept(
          "hierarchy",
          "intent-accepted",
          "PART_OF relations form a containment hierarchy",
        );
      }
      if (has(view, refs, (c) => c === "relations")) {
        return refine("relationship", "intent-refined", "relations exist but none are PART_OF");
      }
      return downgrade("summary", "fallback-summary-no-evidence", "no hierarchy evidence");
    }
    case "comparison": {
      const metricWithBaseline = has(
        view,
        refs,
        (c, raw) =>
          c === "metrics" &&
          typeof raw["value"] === "string" &&
          typeof raw["baseline"] === "string",
      );
      if (metricWithBaseline)
        return accept(
          "comparison",
          "comparison-baseline",
          "a metric with a baseline is a real before/after",
        );
      return downgrade(
        "summary",
        "fallback-summary-no-evidence",
        "ProjectKnowledge has no explicit comparison structure",
      );
    }
    case "quote": {
      // A QuoteBlock is a verbatim quotation. It may ONLY be built when a
      // relevant knowledge item carries a verified verbatim `SourceRef.quote` —
      // never a paraphrase of `claim.statement` / `result.statement`.
      const quoteScope = [...new Set([...slide.claimRefs, ...refs])];
      const hasVerbatim = quoteScope.some((id) =>
        view.byId
          .get(id)
          ?.sourceRefs.some((sr) => typeof sr.quote === "string" && sr.quote.trim().length > 0),
      );
      if (hasVerbatim) {
        return accept(
          "quote",
          "quote-verbatim",
          "a verified verbatim SourceRef.quote backs this slide",
        );
      }
      if (slide.claimRefs.length > 0 || has(view, refs, (c) => c === "results" || c === "claims")) {
        return downgrade(
          "summary",
          "fallback-summary-no-evidence",
          "a claim / result exists but carries no verbatim SourceRef.quote — shown as a summary, not a quotation",
        );
      }
      return downgrade(
        "summary",
        "fallback-summary-no-evidence",
        "nothing quotable behind this slide",
      );
    }
    default:
      return accept("summary", "auto-summary", "a concise summary of the referenced knowledge");
  }
}
