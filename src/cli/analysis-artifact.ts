/**
 * Phase 9 two-pass CLIs envelopes — the file shapes that carry the
 * deterministic `ReasonerRequest` out to an external agent and bring its
 * `AnalysisResult` back, bound by `sourceDigest`.
 *
 * CLI/workflow-level, NOT new core types: Core keeps `AgentReasoner` and the
 * raw `AnalysisResult` schema. The envelope only adds the digest binding that
 * stops a result prepared for request A from being consumed against request B.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AnalysisResult } from "../analysis/analysis-result.js";
import type { ReasonerRequest } from "../analysis/reasoner.js";
import { ReasonerError } from "../errors.js";
import { stableJson } from "../pipeline/artifacts.js";
import type { PreparedAnalysis } from "../pipeline/run.js";
import { CliUsageError } from "./args.js";

export const ANALYSIS_REQUEST_VERSION = "0.1.0" as const;
export const AGENT_ANALYSIS_VERSION = "0.1.0" as const;

/** What `--prepare-analysis` writes. */
export interface AnalysisRequestArtifact {
  artifact: "arclume/analysis-request";
  version: typeof ANALYSIS_REQUEST_VERSION;
  sourceDigest: string;
  request: ReasonerRequest;
}

/** What `--analysis-result` expects. */
export interface AgentAnalysisArtifact {
  artifact: "arclume/agent-analysis";
  version: typeof AGENT_ANALYSIS_VERSION;
  sourceDigest: string;
  analysis: AnalysisResult;
}

export function buildAnalysisRequestArtifact(prepared: PreparedAnalysis): AnalysisRequestArtifact {
  return {
    artifact: "arclume/analysis-request",
    version: ANALYSIS_REQUEST_VERSION,
    sourceDigest: prepared.sourceDigest,
    request: prepared.request,
  };
}

/** Serialize deterministically (the same prepared input → byte-identical out). */
export function serializeAnalysisRequest(prepared: PreparedAnalysis): string {
  return stableJson(buildAnalysisRequestArtifact(prepared));
}

function readJsonFile(path: string, cwd: string, what: string): unknown {
  const abs = resolve(cwd, path);
  if (!existsSync(abs)) throw new CliUsageError(`${what} file "${path}" does not exist`);
  try {
    return JSON.parse(readFileSync(abs, "utf8")) as unknown;
  } catch (err) {
    throw new CliUsageError(`${what} file "${path}" is not valid JSON: ${(err as Error).message}`);
  }
}

/**
 * Bind an already-parsed envelope payload to the CURRENT prepared digest.
 * A stale or foreign envelope is fatal — never silently consumed.
 * (Used by the CLI file path and by the Web API with an inline payload.)
 */
export function bindAgentAnalysisEnvelope(
  raw: unknown,
  label: string,
  prepared: PreparedAnalysis,
): AnalysisResult {
  const env = raw as Partial<AgentAnalysisArtifact>;
  if (env.artifact !== "arclume/agent-analysis") {
    throw new CliUsageError(
      `${label} is not an arclume/agent-analysis artifact`,
      `Produce the AnalysisResult from the request written by \`arclume analyze <input> --prepare-analysis <path>\`, then wrap it as { "artifact": "arclume/agent-analysis", "version": "${AGENT_ANALYSIS_VERSION}", "sourceDigest": <request.sourceDigest>, "analysis": … }.`,
    );
  }
  if (env.version !== AGENT_ANALYSIS_VERSION) {
    throw new CliUsageError(
      `${label} declares envelope version "${String(env.version)}" (expected ${AGENT_ANALYSIS_VERSION})`,
    );
  }
  if (typeof env.sourceDigest !== "string" || env.analysis === undefined) {
    throw new CliUsageError(`${label} lacks sourceDigest or analysis`);
  }
  if (env.sourceDigest !== prepared.sourceDigest) {
    throw new ReasonerError(
      `analysis result was produced for sourceDigest ${env.sourceDigest} but this input yields ${prepared.sourceDigest}`,
      {
        code: "reasoner/source-digest-mismatch",
        severity: "fatal",
        hint: "The input changed after the request was prepared. Re-run `--prepare-analysis` and produce the analysis from the fresh request.",
      },
    );
  }
  return env.analysis;
}

/**
 * Read an agent result envelope from a FILE and bind it to the CURRENT
 * prepared digest. CLI path — the file-form of `bindAgentAnalysisEnvelope`.
 */
export function readAgentAnalysisArtifact(
  path: string,
  cwd: string,
  prepared: PreparedAnalysis,
): AnalysisResult {
  const raw = readJsonFile(path, cwd, "analysis result");
  return bindAgentAnalysisEnvelope(raw, `"${path}"`, prepared);
}
