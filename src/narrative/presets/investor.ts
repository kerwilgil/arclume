import type { AudienceProfile } from "./types.js";

/**
 * Investor: problem, opportunity, differentiation, defensibility (when the
 * knowledge actually supports it), roadmap and milestones. It NEVER invents
 * TAM, revenue, users, metrics or traction — those appear only when the
 * knowledge already contains them.
 */
export const investorPreset: AudienceProfile = {
  name: "investor",
  objectiveTemplate:
    "Make the case for {project}: the opportunity, differentiation, defensibility and the road ahead.",
  detailTolerance: "medium",
  narrativeDensity: "balanced",
  evidenceVisibility: "medium",
  weights: {
    project: 5,
    capabilities: 5,
    results: 4,
    metrics: 4,
    claims: 3,
    risks: 3,
    phases: 3,
    milestones: 3,
    processes: 3,
    components: 2,
    relations: 2,
    technologies: 2,
    constraints: 2,
    decisions: 2,
    actors: 1,
    dependencies: 1,
    requirements: 1,
    gaps: 1,
  },
  sections: [
    {
      id: "opportunity",
      title: "The opportunity",
      purpose: "Frame the problem and the opportunity it represents.",
      narrativePurpose: "problem",
      sources: { projectFields: ["problem", "purpose"] },
    },
    {
      id: "differentiation",
      title: "What is different",
      purpose: "Describe the capabilities that set it apart.",
      narrativePurpose: "capability",
      sources: { collections: ["capabilities"], projectFields: ["solution"] },
    },
    {
      id: "traction",
      title: "Signals of progress",
      purpose: "Show measured results and metrics, if the knowledge has them.",
      narrativePurpose: "impact",
      sources: { collections: ["results", "metrics"] },
    },
    {
      id: "defensibility",
      title: "Defensibility",
      purpose: "Surface structural and technical moats, if documented.",
      narrativePurpose: "architecture",
      sources: {
        collections: ["components", "relations", "technologies", "constraints"],
        minRefs: 2,
      },
    },
    {
      id: "risks",
      title: "Risks",
      purpose: "State the risks to the opportunity.",
      narrativePurpose: "risk",
      sources: { collections: ["risks", "gaps"] },
    },
    {
      id: "roadmap",
      title: "Roadmap and milestones",
      purpose: "Show milestones and the plan ahead.",
      narrativePurpose: "roadmap",
      sources: { collections: ["milestones", "phases"], projectFields: ["nextSteps"] },
    },
  ],
  closingEmphasis: ["roadmap", "next-steps", "open-decisions", "gaps"],
};
