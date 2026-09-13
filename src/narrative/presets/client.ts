import type { AudienceProfile } from "./types.js";

/**
 * Client: clarity over internal plumbing. What the product does, the benefits,
 * current status, the proposal/deliverables and the roadmap. Unnecessary
 * internals are suppressed — implementation detail, dependencies and low-level
 * processes carry no weight.
 */
export const clientPreset: AudienceProfile = {
  name: "client",
  objectiveTemplate:
    "Explain {project} clearly to a client: its capabilities, benefits, current state and next deliverables.",
  detailTolerance: "low",
  narrativeDensity: "lean",
  evidenceVisibility: "low",
  weights: {
    project: 5,
    capabilities: 5,
    results: 5,
    metrics: 4,
    processes: 3,
    phases: 3,
    milestones: 3,
    decisions: 2,
    risks: 2,
    claims: 2,
    constraints: 1,
    requirements: 1,
    actors: 1,
    components: 1,
    technologies: 0,
    dependencies: 0,
    relations: 0,
    gaps: 0,
  },
  sections: [
    {
      id: "overview",
      title: "Overview",
      purpose: "Say plainly what {project} is.",
      narrativePurpose: "context",
      sources: { projectFields: ["purpose", "summary"] },
    },
    {
      id: "capabilities",
      title: "What it does",
      purpose: "Describe the capabilities available.",
      narrativePurpose: "capability",
      sources: { collections: ["capabilities"] },
    },
    {
      id: "benefits",
      title: "Benefits",
      purpose: "State the benefit and measurable results.",
      narrativePurpose: "impact",
      sources: { collections: ["results", "metrics"] },
    },
    {
      id: "status",
      title: "Current status",
      purpose: "Report where things stand.",
      narrativePurpose: "status",
      sources: { collections: ["phases", "milestones"], projectFields: ["status"] },
    },
    {
      id: "risks",
      title: "Things to watch",
      purpose: "Surface any flagged risks, plainly.",
      narrativePurpose: "risk",
      sources: { collections: ["risks"] },
    },
    {
      id: "roadmap",
      title: "What is next",
      purpose: "Show the roadmap and deliverables ahead.",
      narrativePurpose: "roadmap",
      sources: { collections: ["phases", "milestones"], projectFields: ["nextSteps"] },
    },
  ],
  closingEmphasis: ["next-steps", "roadmap", "open-decisions", "gaps"],
};
