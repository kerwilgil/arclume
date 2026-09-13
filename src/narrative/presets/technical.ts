import type { AudienceProfile } from "./types.js";

/**
 * Technical: an accurate picture of how the system is built, the constraints it
 * works within, and its open risks and gaps. Architecture, components,
 * dependencies, processes and technologies carry the weight; impact and
 * marketing framing are deprioritized. Architecture only becomes a structural
 * section when components + relations actually support it.
 */
export const technicalPreset: AudienceProfile = {
  name: "technical",
  objectiveTemplate:
    "Give engineers an accurate picture of how {project} is built, the constraints it works within, and its open risks.",
  detailTolerance: "high",
  narrativeDensity: "dense",
  evidenceVisibility: "high",
  weights: {
    project: 3,
    components: 5,
    processes: 5,
    constraints: 5,
    relations: 4,
    dependencies: 4,
    technologies: 4,
    requirements: 4,
    risks: 4,
    gaps: 4,
    claims: 3,
    phases: 3,
    decisions: 3,
    milestones: 2,
    metrics: 2,
    results: 2,
    capabilities: 2,
    actors: 2,
  },
  sections: [
    {
      id: "purpose",
      title: "Purpose",
      purpose: "State what {project} is for.",
      narrativePurpose: "context",
      sources: { projectFields: ["purpose", "summary"] },
    },
    {
      id: "constraints",
      title: "Constraints",
      purpose: "List the hard constraints the design works within.",
      narrativePurpose: "context",
      sources: { collections: ["constraints", "requirements"] },
    },
    {
      id: "architecture",
      title: "Architecture",
      purpose: "Describe the structure: components and how they connect.",
      narrativePurpose: "architecture",
      sources: { collections: ["components", "relations", "dependencies"], minRefs: 2 },
    },
    {
      id: "components",
      title: "Components",
      purpose: "Walk through the components and their responsibilities.",
      narrativePurpose: "architecture",
      sources: { collections: ["components"] },
    },
    {
      id: "processes",
      title: "Key processes",
      purpose: "Trace the main runtime flows.",
      narrativePurpose: "process",
      sources: { collections: ["processes"] },
    },
    {
      id: "technologies",
      title: "Technology stack",
      purpose: "List the technologies in use.",
      narrativePurpose: "summary",
      sources: { collections: ["technologies", "dependencies"] },
    },
    {
      id: "security",
      title: "Security-related knowledge",
      purpose: "Surface security, auth and hardening concerns already documented.",
      narrativePurpose: "risk",
      sources: {
        collections: ["requirements", "constraints", "risks", "claims", "gaps"],
        keyword: "secur|auth|encrypt|credential|permission|vulnerab|threat|hardening|token|secret",
      },
    },
    {
      id: "risks",
      title: "Risks",
      purpose: "State the tracked risks with likelihood and impact.",
      narrativePurpose: "risk",
      sources: { collections: ["risks"] },
    },
    {
      id: "status",
      title: "Current status",
      purpose: "Report where the work stands.",
      narrativePurpose: "status",
      sources: { collections: ["phases", "milestones"], projectFields: ["status"] },
    },
    {
      id: "gaps",
      title: "Known gaps",
      purpose: "List the open questions that limit confidence.",
      narrativePurpose: "status",
      sources: { collections: ["gaps"] },
    },
    {
      id: "roadmap",
      title: "Roadmap",
      purpose: "Show the sequence of phases still ahead.",
      narrativePurpose: "roadmap",
      sources: { collections: ["phases", "milestones"], projectFields: ["nextSteps"] },
    },
  ],
  closingEmphasis: ["roadmap", "next-steps", "open-decisions", "gaps"],
};
