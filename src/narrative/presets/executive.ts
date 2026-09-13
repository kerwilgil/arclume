import type { AudienceProfile } from "./types.js";

/**
 * Executive: fast, evidence-backed, decision-oriented. Leads with context,
 * problem, solution and impact; keeps architecture simplified; ends on what
 * happens next. Never manufactures an empty "Risks" slide — the section drops
 * itself when the knowledge has no risks or risk-shaped gaps.
 */
export const executivePreset: AudienceProfile = {
  name: "executive",
  objectiveTemplate:
    "Give decision-makers a fast, evidence-backed view of {project}: what it does, the impact, and what comes next.",
  detailTolerance: "low",
  narrativeDensity: "lean",
  evidenceVisibility: "low",
  weights: {
    project: 5,
    results: 5,
    metrics: 5,
    capabilities: 4,
    risks: 4,
    claims: 4,
    gaps: 3,
    phases: 3,
    milestones: 3,
    decisions: 3,
    constraints: 2,
    components: 2,
    processes: 2,
    technologies: 1,
    dependencies: 1,
    actors: 1,
    requirements: 1,
    relations: 1,
  },
  sections: [
    {
      id: "context",
      title: "Context",
      purpose: "Establish what {project} is and why it exists.",
      narrativePurpose: "context",
      sources: { projectFields: ["purpose", "summary"] },
    },
    {
      id: "problem",
      title: "The problem",
      purpose: "Frame the problem {project} addresses.",
      narrativePurpose: "problem",
      sources: { projectFields: ["problem"] },
    },
    {
      id: "solution",
      title: "The approach",
      purpose: "Explain {project}'s approach at a high level.",
      narrativePurpose: "solution",
      sources: { projectFields: ["solution"] },
    },
    {
      id: "impact",
      title: "Impact",
      purpose: "Show the measurable difference so far.",
      narrativePurpose: "impact",
      sources: { collections: ["results", "metrics"] },
    },
    {
      id: "capabilities",
      title: "Capabilities",
      purpose: "Summarize what {project} can do.",
      narrativePurpose: "capability",
      sources: { collections: ["capabilities"] },
    },
    {
      id: "architecture",
      title: "How it fits together",
      purpose: "Give a simplified structural picture.",
      narrativePurpose: "architecture",
      sources: { collections: ["components", "relations"], minRefs: 2 },
    },
    {
      id: "evidence",
      title: "Evidence",
      purpose: "Back the impact with verifiable results.",
      narrativePurpose: "evidence",
      sources: { collections: ["claims", "results"], claimFactTypes: ["FACT"] },
    },
    {
      id: "risks",
      title: "Risks",
      purpose: "State the main risks and how they are handled.",
      narrativePurpose: "risk",
      sources: { collections: ["risks", "gaps"] },
    },
    {
      id: "status",
      title: "Where it stands",
      purpose: "Report current status and progress.",
      narrativePurpose: "status",
      sources: { collections: ["phases", "milestones"], projectFields: ["status"] },
    },
    {
      id: "next-steps",
      title: "Next steps",
      purpose: "Say what happens next.",
      narrativePurpose: "next-steps",
      sources: { collections: ["decisions"], projectFields: ["nextSteps"] },
    },
  ],
  closingEmphasis: ["next-steps", "roadmap", "open-decisions", "gaps"],
};
