import type { AudienceProfile } from "./types.js";

/**
 * Internal Review: the preset with the highest visibility of uncertainty.
 * Findings, inconsistencies, UNKNOWNs, inferences, risks, debt and evidence all
 * carry weight; marketing framing carries none. Gaps are surfaced (never
 * hidden) and inferences are shown as inferences, not dressed up as fact.
 */
export const internalReviewPreset: AudienceProfile = {
  name: "internal-review",
  objectiveTemplate:
    "Give reviewers the honest picture of {project}: findings, uncertainty, risks, debt and the evidence.",
  detailTolerance: "high",
  narrativeDensity: "dense",
  evidenceVisibility: "high",
  weights: {
    project: 4,
    gaps: 5,
    risks: 5,
    claims: 4,
    constraints: 4,
    requirements: 4,
    components: 4,
    processes: 4,
    relations: 3,
    dependencies: 3,
    technologies: 3,
    decisions: 3,
    phases: 3,
    milestones: 3,
    metrics: 2,
    results: 2,
    capabilities: 1,
    actors: 1,
  },
  sections: [
    {
      id: "findings",
      title: "Key findings",
      purpose: "Surface the findings, claims and inferences the review must weigh.",
      narrativePurpose: "context",
      sources: { collections: ["claims", "results"] },
    },
    {
      id: "uncertainty",
      title: "Uncertainty",
      purpose: "List the open questions that limit confidence.",
      narrativePurpose: "status",
      sources: { collections: ["gaps"] },
    },
    {
      id: "risks",
      title: "Risks",
      purpose: "State the tracked risks with likelihood and impact.",
      narrativePurpose: "risk",
      sources: { collections: ["risks"] },
    },
    {
      id: "architecture",
      title: "Architecture under review",
      purpose: "Describe the structure and dependencies under review.",
      narrativePurpose: "architecture",
      sources: { collections: ["components", "relations", "dependencies"], minRefs: 2 },
    },
    {
      id: "processes",
      title: "Key processes",
      purpose: "Trace the runtime flows being reviewed.",
      narrativePurpose: "process",
      sources: { collections: ["processes"] },
    },
    {
      id: "debt",
      title: "Debt and constraints",
      purpose: "Surface constraints and requirements that shape the design.",
      narrativePurpose: "context",
      sources: { collections: ["constraints", "requirements"] },
    },
    {
      id: "decisions",
      title: "Decisions",
      purpose: "Record the decisions worth revisiting.",
      narrativePurpose: "status",
      sources: { collections: ["decisions"] },
    },
    {
      id: "evidence",
      title: "Evidence",
      purpose: "Expose the evidence backing the findings.",
      narrativePurpose: "evidence",
      sources: { collections: ["claims", "results"], claimFactTypes: ["FACT"] },
    },
  ],
  closingEmphasis: ["gaps", "open-decisions", "next-steps", "roadmap"],
};
