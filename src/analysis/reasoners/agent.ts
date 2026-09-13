/**
 * `AgentReasoner` — the "an external agent produced the analysis" path.
 *
 * Claude Code, Codex, or any other agent writes an `AnalysisResult` (as a JSON
 * file, an in-memory object, or via a callback). This reasoner loads it,
 * validates it against the schema, and hands it to the pipeline. The Core stays
 * free of any model SDK.
 */

import { readFileSync } from "node:fs";
import { ReasonerError } from "../../errors.js";
import { formatValidationReport, validateAnalysisResult } from "../../validation/validator.js";
import type { AnalysisResult } from "../analysis-result.js";
import type {
  Reasoner,
  ReasonerCapabilities,
  ReasonerRequest,
  ReasonerResult,
} from "../reasoner.js";

export type AgentReasonerSource =
  | { readonly result: unknown }
  | { readonly resultPath: string }
  | { readonly load: () => unknown | Promise<unknown> };

const CAPABILITIES: ReasonerCapabilities = {
  id: "agent",
  version: "0.1.0",
  deterministic: true,
  network: false,
};

export class AgentReasoner implements Reasoner {
  readonly capabilities = CAPABILITIES;
  #source: AgentReasonerSource;

  constructor(source: AgentReasonerSource) {
    this.#source = source;
  }

  async analyze(_request: ReasonerRequest): Promise<ReasonerResult> {
    const raw = await this.#obtain();
    const validation = validateAnalysisResult(raw);
    if (!validation.valid) {
      throw new ReasonerError("the supplied AnalysisResult is not valid", {
        code: "reasoner/malformed-output",
        severity: "fatal",
        hint: firstLines(formatValidationReport(validation), 6),
      });
    }
    return {
      analysis: raw as AnalysisResult,
      reasoner: { id: this.capabilities.id, version: this.capabilities.version },
    };
  }

  async #obtain(): Promise<unknown> {
    const source = this.#source;
    if ("result" in source) return source.result;
    if ("load" in source) {
      try {
        return await source.load();
      } catch (cause) {
        throw new ReasonerError("the analysis loader threw", {
          code: "reasoner/loader-failed",
          severity: "fatal",
          cause,
        });
      }
    }
    let text: string;
    try {
      text = readFileSync(source.resultPath, "utf8");
    } catch (cause) {
      throw new ReasonerError(`cannot read analysis file: ${source.resultPath}`, {
        code: "reasoner/analysis-file-unreadable",
        path: source.resultPath,
        severity: "fatal",
        cause,
      });
    }
    try {
      return JSON.parse(text);
    } catch (cause) {
      throw new ReasonerError(`analysis file is not valid JSON: ${source.resultPath}`, {
        code: "reasoner/analysis-file-invalid-json",
        path: source.resultPath,
        severity: "fatal",
        cause,
      });
    }
  }
}

function firstLines(text: string, n: number): string {
  return text.split("\n").slice(0, n).join("\n");
}
