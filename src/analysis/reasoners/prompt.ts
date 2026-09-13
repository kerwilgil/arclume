/**
 * Shared Reasoner prompt contract.
 *
 * Every provider adapter (Anthropic, OpenAI, NVIDIA, a custom
 * OpenAI-compatible endpoint, Ollama, Claude Code, Codex) builds its request
 * from these two functions instead of duplicating ARCLUME's reasoning
 * instructions inside each adapter. This is the one place that changes when
 * the analysis contract changes, and the one place a test can check the
 * instructions actually reach a call — no business logic hides inside a
 * provider-specific string.
 *
 * The schema text is read verbatim from `schemas/analysis-result.schema.json`
 * — the same file `validateAnalysisResult` validates against — so the prompt
 * can never drift from what will actually be accepted.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { schemasDir } from "../../schema/paths.js";
import type { AnalysisResult } from "../analysis-result.js";
import type { ReasonerRequest } from "../reasoner.js";

/** Bumped when the instructions or the expected output contract change in a
 * way a provider integration should care about. */
export const REASONER_PROMPT_VERSION = "0.1.0";

export interface ChatPrompt {
  system: string;
  user: string;
}

let cachedSchemaText: string | undefined;

/** Lazily read and cache `analysis-result.schema.json` as text. */
export function analysisResultSchemaText(): string {
  if (cachedSchemaText === undefined) {
    cachedSchemaText = readFileSync(join(schemasDir(), "analysis-result.schema.json"), "utf8");
  }
  return cachedSchemaText;
}

const ANALYSIS_INSTRUCTIONS = `You are the ARCLUME analysis Reasoner. You are given the discovered files and parsed documents of a project, product, or piece of writing, and you must produce a single "AnalysisResult" JSON object describing it: the project itself, its entities (capabilities, components, actors, dependencies, processes, phases, milestones, metrics, risks, decisions, requirements, technologies, results, constraints), the relations between them, claims about the project, and gaps (open questions).

This is evidence-first analysis, not summarization:
- Every "evidence" entry MUST cite a real "documentId" from the "documents" array you were given below - never invent one.
- A claim or entity may only be classified "FACT" when it is directly supported by evidence you can cite verbatim from a document. If you cannot point at real evidence, classify it as "INFERENCE" (a reasonable conclusion, not directly stated), "UNKNOWN" (as a gap - something you could not determine), or "RECOMMENDATION" (a suggestion, never a fact about the current state).
- Do not upgrade an inference to a fact because you are confident about it. Confidence is not evidence.
- Prefer citing a "quote" (short, verbatim, from the document) alongside "lineStart"/"lineEnd" when you can identify them; a documentId alone is acceptable when a precise location is not available.
- Keep the analysis grounded in what the documents actually say. Do not fabricate project history, people, dates, or outcomes that are not present in the source material.

Output contract:
- Respond with ONLY a single JSON object that validates against the schema below.
- No prose before or after the JSON. No markdown code fences. No explanation.
- Every field not present in the schema is forbidden ("additionalProperties": false) - do not add extra keys.`;

const REVIEWER_INSTRUCTIONS = `You are the ARCLUME Verified-mode reviewer. You are given the same source documents that were given to another reasoner, plus the CANDIDATE "AnalysisResult" JSON that reasoner produced. Your job is to check the candidate and correct it, checking specifically for:

- unsupported claims: anything classified "FACT" that is not actually backed by real, resolvable evidence in the supplied documents (downgrade it to "INFERENCE", "UNKNOWN", or "RECOMMENDATION" as appropriate)
- missing evidence: a claim or entity that should cite evidence but does not
- weak inferences: a conclusion stated with more confidence than the source material supports
- contradictions: claims, entities, or relations that conflict with each other or with the documents
- claim classification errors: something that is actually a recommendation or an open question mislabeled as a fact or a settled claim

Return a complete, corrected "AnalysisResult" JSON object - the whole document, not a diff or a list of comments - matching the same schema as the candidate. If the candidate needed no corrections, return it unchanged. Do not invent new evidence, new entities, or new claims that were not already present in some form in the candidate or directly supported by the documents.

Output contract:
- Respond with ONLY a single corrected JSON object that validates against the schema below.
- No prose before or after the JSON. No markdown code fences. No explanation.`;

/** Builds the primary analysis prompt for any Reasoner provider adapter. */
export function buildAnalysisPrompt(request: ReasonerRequest): ChatPrompt {
  const system = [
    ANALYSIS_INSTRUCTIONS,
    "AnalysisResult JSON Schema (your output MUST validate against this):",
    analysisResultSchemaText(),
  ].join("\n\n");

  const user = JSON.stringify({
    sourceDigest: request.sourceDigest,
    hints: request.hints ?? null,
    documents: request.documents,
    files: request.files,
  });

  return { system, user };
}

/** Builds the Verified-mode reviewer prompt: same documents + the primary
 * reasoner's candidate result, asking for a corrected AnalysisResult. */
export function buildReviewerPrompt(
  request: ReasonerRequest,
  candidate: AnalysisResult,
): ChatPrompt {
  const system = [
    REVIEWER_INSTRUCTIONS,
    "AnalysisResult JSON Schema (your output MUST validate against this):",
    analysisResultSchemaText(),
  ].join("\n\n");

  const user = JSON.stringify({
    sourceDigest: request.sourceDigest,
    documents: request.documents,
    files: request.files,
    candidate,
  });

  return { system, user };
}
