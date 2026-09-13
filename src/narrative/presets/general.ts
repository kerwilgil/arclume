import type { AudienceProfile } from "./types.js";

/**
 * General: a balanced narrative for a non-specialist audience. Answers "what is
 * it / why does it exist / what problem / how does it work / what can it do /
 * where does it stand / what's the evidence / what comes next" — using the
 * plainest knowledge available and skipping deep technical detail.
 */
export const generalPreset: AudienceProfile = {
  name: "general",
  objectiveTemplate:
    "Explain {project} to a non-specialist audience: the problem, the solution, and where it stands.",
  detailTolerance: "medium",
  narrativeDensity: "balanced",
  evidenceVisibility: "medium",
  weights: {
    project: 5,
    capabilities: 5,
    processes: 4,
    results: 4,
    claims: 3,
    metrics: 3,
    phases: 3,
    gaps: 3,
    actors: 2,
    risks: 2,
    components: 2,
    decisions: 2,
    milestones: 2,
    technologies: 1,
    dependencies: 1,
    constraints: 1,
    requirements: 1,
    relations: 1,
  },
  sections: [
    {
      id: "what",
      title: "What is it?",
      purpose: "Say plainly what {project} is.",
      narrativePurpose: "context",
      sources: { projectFields: ["purpose", "summary"] },
    },
    {
      id: "why",
      title: "Why it exists",
      purpose: "Explain the problem that makes {project} necessary.",
      narrativePurpose: "problem",
      sources: { projectFields: ["problem"] },
    },
    {
      id: "how",
      title: "How it works",
      purpose: "Give a plain-language picture of how {project} operates.",
      narrativePurpose: "process",
      sources: { collections: ["processes"], projectFields: ["solution"] },
    },
    {
      id: "can-do",
      title: "What it can do",
      purpose: "List what {project} is able to do today.",
      narrativePurpose: "capability",
      sources: { collections: ["capabilities"] },
    },
    {
      id: "status",
      title: "Where it stands",
      purpose: "Report the current status in plain terms.",
      narrativePurpose: "status",
      sources: { collections: ["phases"], projectFields: ["status"] },
    },
    {
      id: "evidence",
      title: "Evidence and results",
      purpose: "Show what has been achieved so far.",
      narrativePurpose: "evidence",
      sources: { collections: ["results", "metrics", "claims"], claimFactTypes: ["FACT"] },
    },
    {
      id: "next",
      title: "What comes next",
      purpose: "Say what is planned next.",
      narrativePurpose: "next-steps",
      sources: { collections: ["phases", "milestones"], projectFields: ["nextSteps"] },
    },
  ],
  closingEmphasis: ["next-steps", "roadmap", "gaps", "open-decisions"],
};
