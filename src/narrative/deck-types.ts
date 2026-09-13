/**
 * Deck Type presets (Product Intelligence gate).
 *
 * A *deck type* is independent of the *audience*: it selects the narrative ARC
 * (which sections, in what order, what the deck is trying to accomplish), while
 * the audience governs density, technical depth and evidence visibility.
 *
 * Examples:
 *  - audience=executive + deckType=architecture-review → the architecture arc,
 *    but summarized and decision-oriented (executive density).
 *  - audience=technical + deckType=architecture-review → the same arc, but
 *    dense, low-level and evidence-forward.
 *
 * A deck type is declarative data (an ordered list of section templates). It
 * never invents knowledge: a section with no supporting knowledge drops itself,
 * exactly as audience-driven sections do.
 */

import type { NarrativePurpose } from "../narrative/types.js";
import type { KnowledgeCollectionName } from "../types/knowledge.js";
import type { SectionTemplate } from "./presets/types.js";

export type DeckTypeName =
  | "project-overview"
  | "architecture-review"
  | "technical-deep-dive"
  | "executive-brief"
  | "proposal"
  | "status-report"
  | "migration-plan"
  | "product-overview"
  | "incident-postmortem";

/** All nine deck-type ids. The UI/CLI vocabulary. */
export const DECK_TYPE_NAMES: readonly DeckTypeName[] = [
  "project-overview",
  "architecture-review",
  "technical-deep-dive",
  "executive-brief",
  "proposal",
  "status-report",
  "migration-plan",
  "product-overview",
  "incident-postmortem",
] as const;

export function isDeckTypeName(value: string): value is DeckTypeName {
  return (DECK_TYPE_NAMES as readonly string[]).includes(value);
}

export interface DeckTypeProfile {
  id: DeckTypeName;
  /** `{project}` is substituted with the project name to form the plan objective. */
  objectiveTemplate: string;
  /** Ordered section templates — the deck type's narrative arc. */
  sections: SectionTemplate[];
  /** Closing emphasis override; first satisfiable wins. */
  closingEmphasis: Array<"next-steps" | "roadmap" | "recommendations" | "open-decisions" | "gaps">;
}

function section(
  id: string,
  title: string,
  narrativePurpose: NarrativePurpose,
  purpose: string,
  collections?: KnowledgeCollectionName[],
  opts: Partial<
    Pick<SectionTemplate["sources"], "projectFields" | "minRefs" | "keyword" | "claimFactTypes">
  > = {},
): SectionTemplate {
  return {
    id,
    title,
    purpose,
    narrativePurpose,
    sources: {
      ...(collections !== undefined ? { collections } : {}),
      ...(opts.projectFields !== undefined ? { projectFields: opts.projectFields } : {}),
      ...(opts.minRefs !== undefined ? { minRefs: opts.minRefs } : {}),
      ...(opts.keyword !== undefined ? { keyword: opts.keyword } : {}),
      ...(opts.claimFactTypes !== undefined ? { claimFactTypes: opts.claimFactTypes } : {}),
    },
  };
}

const proj = (
  ...fields: Array<"purpose" | "problem" | "solution" | "status" | "summary" | "nextSteps">
) => fields;

const projectOverview: DeckTypeProfile = {
  id: "project-overview",
  objectiveTemplate:
    "Introduce {project}: its context, purpose, structure, current state, risks and roadmap.",
  closingEmphasis: ["roadmap", "next-steps", "open-decisions", "gaps"],
  sections: [
    section(
      "context",
      "Context",
      "context",
      "Establish what {project} is and why it exists.",
      undefined,
      {
        projectFields: proj("purpose", "summary"),
      },
    ),
    section("purpose", "Purpose", "context", "State the purpose of {project}.", undefined, {
      projectFields: proj("purpose"),
    }),
    section("system", "The system", "solution", "Describe the approach and structure.", undefined, {
      projectFields: proj("solution"),
    }),
    section(
      "components",
      "Key components",
      "architecture",
      "Walk through the main components.",
      ["components", "relations"],
      {
        minRefs: 2,
      },
    ),
    section("flows", "Flows", "process", "Trace the main flows.", ["processes"]),
    section(
      "state",
      "Current state",
      "status",
      "Report the current state.",
      ["phases", "milestones"],
      {
        projectFields: proj("status"),
      },
    ),
    section("risks", "Risks", "risk", "State the current risks.", ["risks", "gaps"]),
  ],
};

const architectureReview: DeckTypeProfile = {
  id: "architecture-review",
  objectiveTemplate:
    "Review the architecture of {project}: structure, components, dependencies, flows, risks and recommendations.",
  closingEmphasis: ["gaps", "open-decisions", "roadmap", "next-steps"],
  sections: [
    section("context", "Context", "context", "Establish the system under review.", undefined, {
      projectFields: proj("purpose", "summary"),
    }),
    section(
      "architecture",
      "Architecture",
      "architecture",
      "Describe the structure: components and their connections.",
      ["components", "relations", "dependencies"],
      {
        minRefs: 2,
      },
    ),
    section(
      "components",
      "Components",
      "architecture",
      "Review the components and their responsibilities.",
      ["components"],
    ),
    section(
      "dependencies",
      "Dependencies",
      "architecture",
      "List the external and internal dependencies.",
      ["dependencies", "technologies"],
    ),
    section("dataflow", "Flow", "process", "Trace the runtime and data flows.", [
      "processes",
      "relations",
    ]),
    section("risks", "Risks", "risk", "State the architecture risks.", ["risks", "gaps"]),
    section(
      "decisions",
      "Decisions",
      "status",
      "Record the architectural decisionse under review.",
      ["decisions"],
    ),
  ],
};

const technicalDeepDive: DeckTypeProfile = {
  id: "technical-deep-dive",
  objectiveTemplate:
    "Go deep into how {project} is built: architecture, subsystems, flows, lifecycle, implementation detail, risks and evidence.",
  closingEmphasis: ["roadmap", "gaps", "open-decisions", "next-steps"],
  sections: [
    section("context", "Technical context", "context", "State the technical context.", undefined, {
      projectFields: proj("purpose", "summary"),
    }),
    section("constraints", "Constraints", "context", "The hard constraints.", [
      "constraints",
      "requirements",
    ]),
    section(
      "architecture",
      "Architecture",
      "architecture",
      "The structure.",
      ["components", "relations", "dependencies"],
      {
        minRefs: 2,
      },
    ),
    section("subsystems", "Subsystems", "architecture", "The components and subsystems.", [
      "components",
    ]),
    section("dataflow", "Data flow", "process", "The data and control flows.", [
      "processes",
      "relations",
    ]),
    section("lifecycle", "Lifecycle", "process", "Lifecycle and process detail.", [
      "processes",
      "phases",
    ]),
    section("technologies", "Technologies", "summary", "The technology stack.", [
      "technologies",
      "dependencies",
    ]),
    section("risks", "Technical risks", "risk", "The technical risks.", ["risks", "gaps"]),
    section("evidence", "Evidence", "evidence", "The backing evidence.", ["claims", "results"], {
      claimFactTypes: ["FACT"],
    }),
  ],
};

const executiveBrief: DeckTypeProfile = {
  id: "executive-brief",
  objectiveTemplate:
    "A compact brief for decision-makers on {project}: the problem, the state, the impact, the risks and the next move.",
  closingEmphasis: ["next-steps", "roadmap", "open-decisions", "gaps"],
  sections: [
    section("problem", "The problem", "problem", "The problem in one slide.", undefined, {
      projectFields: proj("problem", "purpose"),
    }),
    section("state", "Current state", "status", "Where it stands.", ["phases", "milestones"], {
      projectFields: proj("status"),
    }),
    section("findings", "Key findings", "summary", "The few findings that matter.", [
      "results",
      "claims",
    ]),
    section("impact", "Impact", "impact", "The measurable impact.", ["metrics", "results"]),
    section("risks", "Risks", "risk", "The risks to weigh.", ["risks", "gaps"]),
  ],
};

const proposal: DeckTypeProfile = {
  id: "proposal",
  objectiveTemplate:
    "A proposal for {project}: context, approach, benefit, plan and the next steps.",
  closingEmphasis: ["next-steps", "roadmap", "open-decisions", "gaps"],
  sections: [
    section("context", "Context", "context", "The context.", undefined, {
      projectFields: proj("purpose", "summary"),
    }),
    section("problem", "The problem", "problem", "The problem being addressed.", undefined, {
      projectFields: proj("problem"),
    }),
    section("approach", "Proposed approach", "solution", "The proposed approach.", undefined, {
      projectFields: proj("solution"),
    }),
    section("capabilities", "What it delivers", "capability", "The capabilities delivered.", [
      "capabilities",
    ]),
    section("benefits", "Benefits", "impact", "The benefit and upside.", ["results", "metrics"]),
    section(
      "structure",
      "Structure",
      "architecture",
      "How it fits together at a glance.",
      ["components", "relations"],
      {
        minRefs: 2,
      },
    ),
    section("risks", "Risks", "risk", "The risks and unknowns.", ["risks", "gaps"]),
    section("roadmap", "Plan", "roadmap", "The plan and next steps.", ["phases", "milestones"], {
      projectFields: proj("nextSteps"),
    }),
  ],
};

const statusReport: DeckTypeProfile = {
  id: "status-report",
  objectiveTemplate:
    "A status report for {project}: current state, completed, in progress, blocked, risks, decisions and next steps.",
  closingEmphasis: ["next-steps", "roadmap", "open-decisions", "gaps"],
  sections: [
    section("status", "Current status", "status", "The current status.", ["phases", "milestones"], {
      projectFields: proj("status"),
    }),
    section("completed", "Completed", "status", "What is done.", [
      "milestones",
      "phases",
      "results",
    ]),
    section(
      "in-progress",
      "In progress",
      "status",
      "What is in progress.",
      ["phases", "processes"],
      {
        projectFields: proj("nextSteps"),
      },
    ),
    section("risks", "Risks and blockers", "risk", "The risks and blockers.", ["risks", "gaps"]),
    section("decisions", "Decisions", "status", "The open and taken decisions.", ["decisions"]),
    section("roadmap", "Next steps", "next-steps", "What happens next.", ["phases", "milestones"], {
      projectFields: proj("nextSteps"),
    }),
  ],
};

const migrationPlan: DeckTypeProfile = {
  id: "migration-plan",
  objectiveTemplate:
    "A migration plan for {project}: current state, target, dependencies, phases, risks, validation, rollback and roadmap.",
  closingEmphasis: ["roadmap", "next-steps", "gaps", "open-decisions"],
  sections: [
    section("current", "Current state", "status", "The current state.", undefined, {
      projectFields: proj("status", "summary"),
    }),
    section("target", "Target state", "solution", "The target state.", undefined, {
      projectFields: proj("solution", "purpose"),
    }),
    section("dependencies", "Dependencies", "architecture", "The dependencies.", [
      "dependencies",
      "components",
    ]),
    section("phases", "Migration phases", "roadmap", "The migration phases and milestones.", [
      "phases",
      "milestones",
    ]),
    section("risks", "Risks", "risk", "The migration risks.", ["risks", "gaps"]),
    section(
      "constraints",
      "Validation and rollback",
      "context",
      "Constraints, validation gates and rollback considerations.",
      ["constraints", "requirements"],
    ),
    section("roadmap", "Roadmap", "roadmap", "The remaining plan.", ["phases", "milestones"], {
      projectFields: proj("nextSteps"),
    }),
  ],
};

const productOverview: DeckTypeProfile = {
  id: "product-overview",
  objectiveTemplate:
    "A product overview of {project}: the problem, users, capabilities, flows, summarized structure and roadmap.",
  closingEmphasis: ["roadmap", "next-steps", "open-decisions", "gaps"],
  sections: [
    section("problem", "The problem", "problem", "The problem {project} solves.", undefined, {
      projectFields: proj("problem", "purpose"),
    }),
    section("users", "Users", "context", "Who {project} serves.", ["actors"], {
      projectFields: proj("purpose"),
    }),
    section("capabilities", "Capabilities", "capability", "What it can do.", ["capabilities"]),
    section("flows", "Flows", "process", "The main product flows.", ["processes"]),
    section(
      "structure",
      "Structure",
      "architecture",
      "A summarized view of how it is built.",
      ["components", "relations"],
      {
        minRefs: 2,
      },
    ),
    section("roadmap", "Roadmap", "roadmap", "The product roadmap.", ["phases", "milestones"], {
      projectFields: proj("nextSteps"),
    }),
  ],
};

const incidentPostmortem: DeckTypeProfile = {
  id: "incident-postmortem",
  objectiveTemplate:
    "A postmortem for {project}: what happened, impact, timeline, root cause (when the evidence allows), resolution and follow-up.",
  closingEmphasis: ["next-steps", "open-decisions", "gaps", "roadmap"],
  sections: [
    section("summary", "Summary", "context", "Summarize what happened.", undefined, {
      projectFields: proj("summary", "status", "purpose"),
    }),
    section("impact", "Impact", "impact", "The measured impact.", ["results", "metrics", "risks"]),
    section("timeline", "Timeline", "roadmap", "The sequence of events.", [
      "phases",
      "milestones",
      "processes",
    ]),
    section(
      "root-cause",
      "Root cause",
      "risk",
      "The root cause; left out when the evidence cannot establish one.",
      ["risks", "claims", "decisions"],
    ),
    section("resolution", "Resolution", "solution", "How the incident was resolved.", undefined, {
      projectFields: proj("solution"),
    }),
    section("follow-up", "Follow-up", "risk", "Corrective actions and open questions.", [
      "gaps",
      "decisions",
      "risks",
    ]),
  ],
};

export const DECK_TYPES: Record<DeckTypeName, DeckTypeProfile> = {
  "project-overview": projectOverview,
  "architecture-review": architectureReview,
  "technical-deep-dive": technicalDeepDive,
  "executive-brief": executiveBrief,
  proposal,
  "status-report": statusReport,
  "migration-plan": migrationPlan,
  "product-overview": productOverview,
  "incident-postmortem": incidentPostmortem,
};

/** Look up a deck type preset. Throws on an unknown id — callers validate first. */
export function getDeckTypeProfile(id: DeckTypeName): DeckTypeProfile {
  const profile = DECK_TYPES[id];
  if (!profile) throw new Error(`arclume: no deck type preset "${id}"`);
  return profile;
}
