import type { AudienceProfile } from "./types.js";

/**
 * Product: the problem, the users, what the product can do, its flows and
 * tradeoffs, and where it is going. Not a purely technical deck — architecture
 * stays summarized, implementation detail is avoided, and the outcome for real
 * users leads.
 */
export const productPreset: AudienceProfile = {
  name: "product",
  objectiveTemplate:
    "Show {project} as a product: the problem it solves, who it serves, what it can do, and its direction.",
  detailTolerance: "medium",
  narrativeDensity: "balanced",
  evidenceVisibility: "medium",
  weights: {
    project: 5,
    capabilities: 5,
    results: 4,
    processes: 4,
    actors: 4,
    claims: 3,
    metrics: 3,
    risks: 3,
    phases: 3,
    milestones: 3,
    requirements: 3,
    gaps: 3,
    decisions: 2,
    components: 2,
    constraints: 2,
    technologies: 1,
    dependencies: 1,
    relations: 1,
  },
  sections: [
    {
      id: "problem",
      title: "The problem",
      purpose: "Frame the problem {project} solves for its users.",
      narrativePurpose: "problem",
      sources: { projectFields: ["problem"] },
    },
    {
      id: "users",
      title: "Who it serves",
      purpose: "Identify the people and systems {project} is built for.",
      narrativePurpose: "context",
      sources: { collections: ["actors"], projectFields: ["purpose"] },
    },
    {
      id: "capabilities",
      title: "Capabilities",
      purpose: "Describe what {project} can do today.",
      narrativePurpose: "capability",
      sources: { collections: ["capabilities"] },
    },
    {
      id: "flows",
      title: "Key flows",
      purpose: "Walk through the main product flows.",
      narrativePurpose: "process",
      sources: { collections: ["processes"] },
    },
    {
      id: "outcomes",
      title: "Outcomes",
      purpose: "Show the measurable difference so far.",
      narrativePurpose: "impact",
      sources: { collections: ["results", "metrics"] },
    },
    {
      id: "architecture",
      title: "How it is built",
      purpose: "Give a summarized structural picture.",
      narrativePurpose: "architecture",
      sources: { collections: ["components", "relations"], minRefs: 2 },
    },
    {
      id: "risks",
      title: "Product risks",
      purpose: "State the product risks and open questions.",
      narrativePurpose: "risk",
      sources: { collections: ["risks", "gaps"] },
    },
    {
      id: "roadmap",
      title: "Roadmap",
      purpose: "Show the direction and planned phases.",
      narrativePurpose: "roadmap",
      sources: { collections: ["phases", "milestones"], projectFields: ["nextSteps"] },
    },
  ],
  closingEmphasis: ["roadmap", "next-steps", "open-decisions", "gaps"],
};
