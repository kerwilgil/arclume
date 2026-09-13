/**
 * `arclume analyze <input> [more inputs…]` — project/file/URL → ProjectKnowledge.
 *
 * THREE explicit modes — the plain default NEVER pretends to be agent-grade:
 *
 *  - `--prepare-analysis <path>`  → ingest + deterministic ReasonerRequest file. STOP.
 *  - `--analysis-result <path>`   → consume an agent's AnalysisResult envelope
 *                                   (digest-bound), build ProjectKnowledge.
 *  - `--reasoner stub`            → offline heuristic StubReasoner, loudly
 *                                   marked as such (`reasoner: "stub"`).
 *
 * URL arguments become `{ kind: "url", url }` explicitly and flow through the
 * Phase 8 secure ingestion. No bypass flags, no model SDKs.
 */

import { existsSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AgentReasoner } from "../analysis/reasoners/agent.js";
import { StubReasoner } from "../analysis/reasoners/stub.js";
import { contentHash } from "../determinism/hash.js";
import type { IngestionInput } from "../ingestion/types.js";
import type { UrlTransport } from "../ingestion/url-transport.js";
import { stableJson } from "../pipeline/artifacts.js";
import { analyzePrepared, buildKnowledge, prepareAnalysis } from "../pipeline/run.js";
import { readAgentAnalysisArtifact, serializeAnalysisRequest } from "./analysis-artifact.js";
import { CliUsageError, type ParsedArgs, parseArgs, singleValue } from "./args.js";
import type { CliIo } from "./output.js";
import { warnAll } from "./output.js";

export const ANALYZE_FLAGS = {
  valueFlags: ["out", "prepare-analysis", "analysis-result", "reasoner"],
  booleanFlags: ["json", "quiet", "verbose"],
} as const;

export interface AnalyzeCommandResult {
  kind: "analyze";
  mode: "prepare" | "agent" | "stub";
  reasonerId?: string;
  sourceDigest: string;
  output?: string;
  requestPath?: string;
  sources: number;
  documents: number;
  skipped: number;
  issues: Array<{ code: string; severity: string; message: string }>;
  knowledgeHash?: string;
}

export function toIngestionInput(raw: string, cwd: string): IngestionInput {
  if (/^https?:\/\//i.test(raw)) {
    return { kind: "url", url: raw };
  }
  return { kind: "path", path: resolve(cwd, raw) };
}

export async function runAnalyzeCommand(
  argv: readonly string[],
  io: CliIo,
  deps?: { urlTransport?: UrlTransport },
): Promise<AnalyzeCommandResult> {
  return analyzeWith(parseArgs(argv, ANALYZE_FLAGS), io, deps);
}

function resolveInputs(parsed: ParsedArgs, io: CliIo): IngestionInput[] {
  if (parsed.positionals.length === 0) {
    throw new CliUsageError(
      "analyze requires at least one input (directory, file, PDF, DOCX, or https:// URL)",
      "Example: arclume analyze ./project --reasoner stub --out knowledge.json",
    );
  }
  const cwd = io.cwd();
  const inputs = parsed.positionals.map((p) => toIngestionInput(p, cwd));
  for (const i of inputs) {
    if (typeof i === "string" || i.kind !== "path") continue;
    if (!existsSync(i.path)) {
      throw new CliUsageError(`input "${i.path}" does not exist`);
    }
    if (!(statSync(i.path).isDirectory() || statSync(i.path).isFile())) {
      throw new CliUsageError(`input "${i.path}" is neither a file nor a directory`);
    }
  }
  return inputs;
}

export async function analyzeWith(
  parsed: ParsedArgs,
  io: CliIo,
  deps?: { urlTransport?: UrlTransport },
): Promise<AnalyzeCommandResult> {
  const jsonMode = parsed.booleans.has("json");
  const preparePath = singleValue(parsed, "prepare-analysis");
  const resultPath = singleValue(parsed, "analysis-result");
  const reasonerFlag = singleValue(parsed, "reasoner");

  const modes = [
    preparePath !== undefined,
    resultPath !== undefined,
    reasonerFlag !== undefined,
  ].filter(Boolean).length;
  if (modes === 0) {
    throw new CliUsageError(
      "analyze requires an explicit reasoning mode",
      [
        "Agent workflow: arclume analyze <input> --prepare-analysis request.json, produce an AnalysisResult from that request, then: arclume analyze <input> --analysis-result result.json --out knowledge.json",
        "Offline/heuristic: arclume analyze <input> --reasoner stub --out knowledge.json",
      ].join("\n"),
    );
  }
  if (modes > 1) {
    throw new CliUsageError(
      "--prepare-analysis, --analysis-result and --reasoner are mutually exclusive",
    );
  }

  const inputs = resolveInputs(parsed, io);
  const ingestionOptions =
    deps?.urlTransport !== undefined ? { url: { transport: deps.urlTransport } } : undefined;
  const prepared = await prepareAnalysis(
    inputs,
    ingestionOptions !== undefined ? { ingestion: ingestionOptions } : {},
  );

  const issues = prepared.ingestion.issues.map((i) => ({
    code: i.code,
    severity: i.severity,
    message: i.message,
  }));

  if (preparePath !== undefined) {
    const requestPath = resolve(io.cwd(), preparePath);
    if (existsSync(requestPath)) {
      throw new CliUsageError(
        `request output "${requestPath}" already exists`,
        "Arclume never overwrites: choose a fresh path.",
      );
    }
    writeFileSync(requestPath, serializeAnalysisRequest(prepared));
    const result: AnalyzeCommandResult = {
      kind: "analyze",
      mode: "prepare",
      sourceDigest: prepared.sourceDigest,
      requestPath,
      sources: prepared.ingestion.sources.length,
      documents: prepared.ingestion.documents.length,
      skipped: prepared.ingestion.skipped.length,
      issues,
    };
    if (jsonMode) {
      io.stdout(JSON.stringify({ ok: true, command: "analyze", ...result }));
    } else if (!parsed.booleans.has("quiet")) {
      io.stdout(`Analysis request: ${requestPath}`);
      io.stdout(`sourceDigest: ${prepared.sourceDigest}`);
      io.stdout(`documents: ${result.documents} · files: ${prepared.request.files.length}`);
    }
    return result;
  }

  // knowledge-producing modes: agent envelope or explicit stub
  let reasoner: StubReasoner | AgentReasoner;
  let outPath: string;
  if (resultPath !== undefined) {
    const analysis = readAgentAnalysisArtifact(resultPath, io.cwd(), prepared);
    reasoner = new AgentReasoner({ result: analysis });
    outPath = resolve(io.cwd(), singleValue(parsed, "out") ?? "project-knowledge.json");
  } else {
    if (reasonerFlag !== "stub") {
      throw new CliUsageError(
        `unknown reasoner "${reasonerFlag ?? ""}"`,
        "Only `--reasoner stub` is available offline; for real analysis use --prepare-analysis / --analysis-result.",
      );
    }
    io.stderr(
      "warning: analysis/stub-reasoner — heuristic offline analysis, not agent-grade reasoning",
    );
    reasoner = new StubReasoner();
    outPath = resolve(io.cwd(), singleValue(parsed, "out") ?? "project-knowledge.json");
  }

  if (existsSync(outPath)) {
    throw new CliUsageError(
      `output "${outPath}" already exists`,
      "Arclume never overwrites an existing analysis: choose a fresh --out path or remove the file.",
    );
  }

  const analyzed = await analyzePrepared(prepared, reasoner);
  const built = buildKnowledge(analyzed);
  writeFileSync(outPath, stableJson(built.knowledge));

  warnAll(
    io,
    issues.filter((i) => i.severity !== "fatal").map((i) => `${i.code}: ${i.message}`),
  );

  const result: AnalyzeCommandResult = {
    kind: "analyze",
    mode: resultPath !== undefined ? "agent" : "stub",
    reasonerId: analyzed.reasoner.id,
    sourceDigest: prepared.sourceDigest,
    output: outPath,
    sources: prepared.ingestion.sources.length,
    documents: prepared.ingestion.documents.length,
    skipped: prepared.ingestion.skipped.length,
    issues,
    knowledgeHash: contentHash(built.knowledge),
  };
  if (jsonMode) {
    io.stdout(JSON.stringify({ ok: true, command: "analyze", ...result }));
  } else if (!parsed.booleans.has("quiet")) {
    io.stdout(`ProjectKnowledge (${result.reasonerId}): ${result.output}`);
    io.stdout(
      `sources: ${result.sources} · documents: ${result.documents} · skipped: ${result.skipped} · issues: ${result.issues.length}`,
    );
  }
  return result;
}
