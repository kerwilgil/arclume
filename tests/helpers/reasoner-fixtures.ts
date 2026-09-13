/**
 * Minimal, hand-built `ReasonerRequest`/`AnalysisResult` fixtures for the AI
 * provider adapter tests. No ingestion, no filesystem — just the exact
 * shapes the Reasoner boundary trades in.
 */

import type { AnalysisResult } from "../../src/analysis/analysis-result.js";
import type { ReasonerRequest } from "../../src/analysis/reasoner.js";

export function sampleReasonerRequest(): ReasonerRequest {
  return {
    sourceDigest: `sha256:${"a".repeat(64)}`,
    documents: [
      {
        id: "doc-readme",
        sourceId: "src-1",
        path: "README.md",
        kind: "markdown",
        content: "# Sample\n\nThis project does a thing.\n",
        outline: undefined,
      },
    ],
    files: [
      { sourceId: "src-1", path: "README.md", kind: "markdown", included: true, byteLength: 40 },
    ],
  };
}

export function sampleAnalysisResult(projectName = "sample-project"): AnalysisResult {
  return {
    analysisVersion: "0.1.0",
    project: {
      name: projectName,
      summary: "A sample project used for reasoner adapter tests.",
      evidence: [{ documentId: "doc-readme" }],
    },
    entities: [],
    relations: [],
    claims: [
      {
        statement: "The project does a thing.",
        factType: "FACT",
        evidence: [{ documentId: "doc-readme", quote: "This project does a thing." }],
      },
    ],
    gaps: [],
  };
}

/** A syntactically valid JSON object that is NOT a valid AnalysisResult
 * (missing required fields) — for malformed-output test cases. */
export function invalidAnalysisResultJson(): string {
  return JSON.stringify({ hello: "world" });
}
