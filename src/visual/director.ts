/**
 * VisualDirector (Phase 4).
 *
 *   ProjectKnowledge + NarrativePlan + SlidePlan + Theme  →  ArclumeDeck
 *
 * The director never alters the truth of the SlidePlan: it does not invent
 * content, metrics, relations, phases or results, and it never rewrites a
 * `keyMessage` (only whitespace is collapsed). It decides *how* to show each
 * slide — visual kind, layout, blocks, emphasis, theme tokens — and records
 * every decision.
 *
 * Deterministic: no LLM, no clock, no RNG, no network, no filesystem, no
 * browser. Same four inputs ⇒ byte-identical `ArclumeDeck`.
 */

import { contentHash } from "../determinism/hash.js";
import { PlanningError } from "../errors.js";
import { buildKnowledgeView, firstSentence } from "../narrative/knowledge-view.js";
import { narrativeContentHash } from "../narrative/planner.js";
import { getAudienceProfile } from "../narrative/presets/index.js";
import type { NarrativePlan } from "../narrative/types.js";
import { slidePlanContentHash } from "../planning/slide-planner.js";
import type { PlannedSlide, PlanningDecision, PlanningNote, SlidePlan } from "../planning/types.js";
import type { Evidence } from "../types/common.js";
import type { ArclumeDeck, AudiencePreset, DiagramIR, Slide } from "../types/deck.js";
import type { ProjectKnowledge } from "../types/knowledge.js";
import type { ValidationResult } from "../validation/result.js";
import {
  formatValidationReport,
  validateArclumeDeck,
  validateNarrativePlan,
  validateSlidePlan,
} from "../validation/validator.js";
import { IR_VERSION } from "../version.js";
import { buildSlideBlocks } from "./blocks.js";
import { applyEmphasis } from "./emphasis.js";
import { deckLayoutFor, selectLayout } from "./layouts.js";
import {
  type DiagramModel,
  buildArchitectureModel,
  buildDataflowModel,
  buildFlowModel,
  buildLifecycleModel,
  modelKnowledgeRefs,
  nativeDiagramAdapter,
} from "./models.js";
import { selectVisualIntent } from "./select.js";
import { type Theme, type ThemeId, getTheme, themeTokensRef } from "./theme.js";
import {
  DEFAULT_VISUAL_LIMITS,
  type VisualDecision,
  type VisualKind,
  type VisualLimits,
} from "./types.js";

export interface BuildVisualDeckInput {
  knowledge: ProjectKnowledge;
  narrative: NarrativePlan;
  slidePlan: SlidePlan;
  /** Defaults to `executive` for an executive narrative, otherwise `minimal`. */
  theme?: ThemeId;
  limits?: Partial<VisualLimits>;
}

export interface VisualDeckResult {
  deck: ArclumeDeck;
  decisions: VisualDecision[];
  notes: PlanningNote[];
  validation: ValidationResult;
}

class IdMint {
  #used = new Set<string>();
  mint(base: string): string {
    let id = base;
    let n = 2;
    while (this.#used.has(id)) {
      id = `${base}-${n}`;
      n += 1;
    }
    this.#used.add(id);
    return id;
  }
}

const AUDIENCE_PRESET: Record<string, AudiencePreset> = {
  executive: "executive",
  technical: "technical",
  general: "general",
  product: "product",
  client: "client",
  investor: "investor",
  "internal-review": "internal-review",
};

function clampShort(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** Collapse whitespace only — never re-word or truncate the key message. */
function normalizeKeyMessage(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Density budget comes from the **SlidePlan's** semantic density only — never
 * the theme. A theme changes spacing / type scale (Phase 5), not how much
 * knowledge a slide carries, so `minimal` and `executive` stay semantically
 * identical (Phase 4 §27 / §42).
 */
function densityLimits(base: VisualLimits, slideDensity: string): VisualLimits {
  const rank = (d: string): number => (d === "low" ? 0 : d === "medium" ? 1 : 2);
  const level = rank(slideDensity);
  if (level === 0) {
    return {
      ...base,
      maxBlocksPerSlide: Math.min(base.maxBlocksPerSlide, 3),
      maxItemsPerBlock: Math.min(base.maxItemsPerBlock, 4),
    };
  }
  if (level === 1) {
    return {
      ...base,
      maxBlocksPerSlide: Math.min(base.maxBlocksPerSlide, 5),
      maxItemsPerBlock: Math.min(base.maxItemsPerBlock, 6),
    };
  }
  return base;
}

/**
 * How much evidence per slide each audience surfaces. Pure presentation policy:
 * the underlying evidence (in ProjectKnowledge) never changes — only how much
 * of it lands on the deck. `high` (technical / internal-review) shows the most;
 * `low` (executive / client) the least.
 */
const EVIDENCE_LIMIT: Record<"low" | "medium" | "high", number> = {
  low: 2,
  medium: 4,
  high: 6,
};

function buildEvidence(
  slide: PlannedSlide,
  view: ReturnType<typeof buildKnowledgeView>,
  maxEvidence: number,
): Evidence[] {
  const out: Evidence[] = [];
  for (const id of slide.claimRefs) {
    const claim = view.byId.get(id);
    if (!claim || claim.collection !== "claims") continue;
    if (claim.sourceRefs.length === 0) continue; // never emit an unsourced evidence entry
    const ev: Evidence = { claimId: claim.id, sourceRefs: claim.sourceRefs.slice(0, 8) };
    if (typeof claim.factType === "string") ev.factType = claim.factType;
    ev.statement = clampShort(claim.text, 2000);
    out.push(ev);
    if (out.length >= maxEvidence) break;
  }
  return out;
}

export function buildVisualDeck(input: BuildVisualDeckInput): VisualDeckResult {
  const { knowledge, narrative, slidePlan } = input;

  // ---- 3. input binding: validate all three, refuse stale / mixed ----------
  const nv = validateNarrativePlan(narrative, knowledge);
  if (!nv.valid) {
    throw new PlanningError("VisualDirector received a NarrativePlan that does not validate", {
      code: "visual/invalid-narrative",
      severity: "fatal",
      hint: firstLines(formatValidationReport(nv), 12),
    });
  }
  const sv = validateSlidePlan(slidePlan, { narrative, knowledge });
  if (!sv.valid) {
    throw new PlanningError(
      "VisualDirector received a SlidePlan that does not validate against its narrative / knowledge",
      {
        code: "visual/invalid-slide-plan",
        severity: "fatal",
        hint: firstLines(formatValidationReport(sv), 12),
      },
    );
  }

  const view = buildKnowledgeView(knowledge);
  const themeId: ThemeId =
    input.theme ?? (narrative.audience === "executive" ? "executive" : "minimal");
  const theme = getTheme(themeId);
  const limits: VisualLimits = { ...DEFAULT_VISUAL_LIMITS, ...(input.limits ?? {}) };

  // Evidence visibility policy comes from the audience preset, not the deck
  // type: the audience is the presentation-expectation layer.
  const evidenceVisibility = getAudienceProfile(narrative.audience).evidenceVisibility;
  const maxEvidencePerSlide = EVIDENCE_LIMIT[evidenceVisibility];

  const decisions: VisualDecision[] = [];
  const notes: PlanningNote[] = [];
  const mint = new IdMint();

  const slides: Slide[] = [];
  const diagrams: DiagramIR[] = [];

  for (const planned of slidePlan.slides) {
    mint.mint(planned.id); // reserve the slide id
    const suffix = planned.id.replace(/^slide-/, "");
    const mintId = (base: string): string => mint.mint(`b-${suffix}-${base}`);

    const resolved = selectVisualIntent(planned, view, limits);

    /** Record one decision, filling the Slice 2B contract fields from `resolved`. */
    const pushDecision = (
      d: Partial<VisualDecision> & Pick<VisualDecision, "code" | "reason">,
    ): void => {
      decisions.push({
        slideId: planned.id,
        requestedIntent: planned.visualIntent,
        resolvedVisual: resolved.visualKind,
        outcome: resolved.outcome,
        reasonCode: "recorded",
        layout: "single-focus",
        knowledgeRefs: [],
        consideredRefs: resolved.consideredRefs,
        evidenceRefs: resolved.evidenceRefs,
        ...d,
        kind: d.kind ?? d.resolvedVisual ?? resolved.visualKind,
      });
    };

    const slideLimits = densityLimits(limits, planned.density);
    if (
      slideLimits.maxBlocksPerSlide !== limits.maxBlocksPerSlide ||
      slideLimits.maxItemsPerBlock !== limits.maxItemsPerBlock
    ) {
      pushDecision({
        code: "density-adjusted",
        reason: `SlidePlan density "${planned.density}" → ≤${slideLimits.maxBlocksPerSlide} blocks, ≤${slideLimits.maxItemsPerBlock} items per block`,
      });
    }

    const built = buildSlideBlocks({
      slide: planned,
      view,
      visualKind: resolved.visualKind,
      limits: slideLimits,
      mintId,
    });
    notes.push(...built.notes);
    for (const n of built.notes) {
      pushDecision({
        code: n.code === "visual/content-condensed" ? "content-condensed" : "content-deferred",
        reason: n.message,
      });
    }

    let blocks = built.blocks;
    let slideDiagramRef: string | undefined;
    let effectiveVisual: VisualKind = resolved.visualKind;

    if (built.wantsDiagram) {
      const refs = resolved.consideredRefs;
      let model: DiagramModel | null = null;
      if (resolved.visualKind === "architecture")
        model = buildArchitectureModel(view, refs, slideLimits);
      else if (resolved.visualKind === "process")
        model = buildFlowModel(view, refs, "process", slideLimits);
      else if (resolved.visualKind === "sequence")
        model = buildFlowModel(view, refs, "sequence", slideLimits);
      else if (resolved.visualKind === "dataflow")
        model = buildDataflowModel(view, refs, slideLimits);
      else if (resolved.visualKind === "lifecycle")
        model = buildLifecycleModel(view, refs, slideLimits);

      if (model) {
        const diagId = mint.mint(`dgm-${suffix}`);
        const dir = nativeDiagramAdapter.toDiagramIR(model, diagId, clampShort(planned.title, 240));
        diagrams.push(dir);
        slideDiagramRef = diagId;
        // `workflow` block only for a real workflow; `sequence` / `dataflow` /
        // `lifecycle` use the generic `diagram` block (their diagramType is not
        // `workflow`, so a `workflow` block would trip a type-mismatch warning).
        const blockType =
          model.kind === "architecture"
            ? "architecture"
            : model.kind === "process"
              ? "workflow"
              : "diagram";
        const blockBase =
          model.kind === "architecture" ? "arch" : model.kind === "process" ? "flow" : model.kind;
        blocks = [
          {
            id: mintId(blockBase),
            type: blockType,
            diagramRef: diagId,
          },
        ];
        pushDecision({
          code: "diagram-built",
          reasonCode: model.condensed ? "diagram-condensed-to-limits" : resolved.reasonCode,
          layout: "diagram-focus",
          reason: `native ${model.kind} model: ${modelKnowledgeRefs(model).length} real knowledge ref(s)${model.condensed ? " (condensed to fit diagram limits)" : ""}`,
          knowledgeRefs: modelKnowledgeRefs(model),
        });
        if (model.condensed) {
          notes.push({
            code: "visual/content-condensed",
            message: `diagram for "${planned.title}" was limited to ${slideLimits.maxDiagramNodes} nodes / ${slideLimits.maxDiagramSteps} steps; the slide keeps all its knowledgeRefs`,
            severity: "warning",
          });
        }
      } else {
        // the intent said architecture/process but the knowledge no longer
        // supports it once density limits are applied — fall back safely.
        effectiveVisual = "summary";
        const fb = buildSlideBlocks({
          slide: planned,
          view,
          visualKind: "summary",
          limits: slideLimits,
          mintId,
        });
        blocks = fb.blocks;
        pushDecision({
          code: "visual-downgraded",
          resolvedVisual: "summary",
          kind: "summary",
          outcome: "downgraded",
          reasonCode: "diagram-model-unbuildable",
          fallbackKind: resolved.visualKind,
          reason:
            "structural model could not be built within the density limits; fell back to a summary",
          knowledgeRefs: resolved.consideredRefs,
        });
      }
    }

    blocks = applyEmphasis(blocks);
    const layout = selectLayout(planned, effectiveVisual, blocks);
    const deckLayout = deckLayoutFor(layout);

    const rejected: string[] = [];
    if (resolved.outcome !== "accepted" && planned.visualIntent !== effectiveVisual) {
      rejected.push(`visualIntent=${planned.visualIntent}`);
    }

    pushDecision({
      code:
        resolved.outcome === "accepted"
          ? "visual-accepted"
          : resolved.outcome === "refined"
            ? "visual-refined"
            : "visual-downgraded",
      resolvedVisual: effectiveVisual,
      kind: effectiveVisual,
      reasonCode: resolved.reasonCode,
      ...(resolved.fallbackKind !== undefined ? { fallbackKind: resolved.fallbackKind } : {}),
      layout,
      reason: resolved.reason,
      knowledgeRefs: resolved.consideredRefs,
    });
    pushDecision({
      code: "layout-selected",
      resolvedVisual: effectiveVisual,
      kind: effectiveVisual,
      layout,
      reason: `${planned.kind} slide + ${effectiveVisual} visual + ${blocks.length} block(s) → ${layout}`,
    });
    pushDecision({
      code: "blocks-selected",
      resolvedVisual: effectiveVisual,
      kind: effectiveVisual,
      layout,
      reason:
        blocks.length === 0
          ? "no blocks (cover/closing composition)"
          : `${blocks.map((b) => b.type).join(", ")}`,
      knowledgeRefs: planned.knowledgeRefs,
    });

    const evidence = buildEvidence(planned, view, maxEvidencePerSlide);
    const slide: Slide = {
      id: planned.id,
      index: slides.length,
      sectionId: planned.sectionId,
      kind: planned.kind,
      title: clampShort(planned.title, 240),
      keyMessage: normalizeKeyMessage(planned.keyMessage),
      narrativePurpose: planned.narrativePurpose,
      layout: deckLayout,
      blocks,
      visual: {
        chosenForm: effectiveVisual,
        rationale: clampShort(resolved.reason, 600),
        ...(rejected.length > 0 ? { rejected } : {}),
      },
      ...(slideDiagramRef !== undefined ? { diagramRef: slideDiagramRef } : {}),
      ...(evidence.length > 0 ? { evidence } : {}),
      checks: { visualQa: "pending" },
    };
    slides.push(slide);
  }

  const throughline = clampShort(narrative.throughline, 400);
  const oneLiner = firstSentence(knowledge.project.purpose ?? knowledge.project.summary);

  const deck: ArclumeDeck = {
    irVersion: IR_VERSION,
    meta: {
      title: clampShort(`${knowledge.project.name.trim()} — ${narrative.audience} deck`, 240),
      generator: "arclume-visual-director@0.1.0",
      locale: "es",
    },
    project: {
      name: clampShort(knowledge.project.name.trim(), 240),
      ...(oneLiner ? { oneLiner: clampShort(oneLiner, 240) } : {}),
      ...(Array.isArray(knowledge.project.tags) && knowledge.project.tags.length > 0
        ? { domain: clampShort(knowledge.project.tags.join(", "), 240) }
        : {}),
      ...(Array.isArray(knowledge.project.sourceRefs) && knowledge.project.sourceRefs.length > 0
        ? { sourceRefs: knowledge.project.sourceRefs.slice(0, 8) }
        : {}),
    },
    audience: { preset: AUDIENCE_PRESET[narrative.audience] ?? "general", locale: "es" },
    narrative: {
      preset: narrative.audience,
      ...(narrative.deckType !== undefined ? { deckType: narrative.deckType } : {}),
      throughline,
      sections: narrative.sections.map((s) => ({
        id: s.id,
        title: clampShort(s.title, 240),
        purpose: clampShort(s.purpose, 400),
      })),
    },
    theme: {
      name: theme.deckThemeName,
      aspectRatio: theme.aspectRatio,
      mode: theme.mode,
      tokensRef: themeTokensRef(theme),
    },
    provenance: {
      // canonical order so the deck never depends on the input array order
      sources: [...knowledge.sources].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      ...(knowledge.meta?.contentHash ? { knowledgeHash: knowledge.meta.contentHash } : {}),
      narrativeRef: narrativeContentHash(narrative),
      slidePlanRef: slidePlanContentHash(slidePlan),
    },
    slides,
    diagrams,
  };

  const validation = validateArclumeDeck(deck, { knowledge, narrative, slidePlan });

  return { deck, decisions, notes, validation };
}

/** Inspect the visual decisions without materialising the whole deck. */
export function directVisuals(input: BuildVisualDeckInput): {
  decisions: VisualDecision[];
  notes: PlanningNote[];
} {
  const { decisions, notes } = buildVisualDeck(input);
  return { decisions, notes };
}

function firstLines(text: string, n: number): string {
  return text.split("\n").slice(0, n).join("\n");
}

export type { PlanningDecision };
