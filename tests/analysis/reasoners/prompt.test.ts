import { describe, expect, it } from "vitest";
import {
  analysisResultSchemaText,
  buildAnalysisPrompt,
  buildReviewerPrompt,
} from "../../../src/analysis/reasoners/prompt.js";
import { sampleAnalysisResult, sampleReasonerRequest } from "../../helpers/reasoner-fixtures.js";

describe("buildAnalysisPrompt", () => {
  it("embeds the real analysis-result schema verbatim", () => {
    const prompt = buildAnalysisPrompt(sampleReasonerRequest());
    expect(prompt.system).toContain(analysisResultSchemaText());
  });

  it("never asks for prose/markdown wrapping", () => {
    const prompt = buildAnalysisPrompt(sampleReasonerRequest());
    expect(prompt.system.toLowerCase()).toContain("only");
    expect(prompt.system.toLowerCase()).toContain("json");
  });

  it("states the evidence-first rule (FACT requires real evidence)", () => {
    const prompt = buildAnalysisPrompt(sampleReasonerRequest());
    expect(prompt.system).toMatch(/FACT/);
    expect(prompt.system.toLowerCase()).toContain("evidence");
  });

  it("includes every document and file from the request in the user payload", () => {
    const request = sampleReasonerRequest();
    const prompt = buildAnalysisPrompt(request);
    const parsed = JSON.parse(prompt.user);
    expect(parsed.sourceDigest).toBe(request.sourceDigest);
    expect(parsed.documents).toHaveLength(request.documents.length);
    expect(parsed.documents[0].id).toBe("doc-readme");
    expect(parsed.files).toHaveLength(request.files.length);
  });

  it("folds hints into the user payload when present", () => {
    const request = {
      ...sampleReasonerRequest(),
      hints: { audience: "executive", focus: ["risk"] },
    };
    const prompt = buildAnalysisPrompt(request);
    const parsed = JSON.parse(prompt.user);
    expect(parsed.hints).toEqual({ audience: "executive", focus: ["risk"] });
  });

  it("uses null (not undefined/absent) for hints when none are given", () => {
    const prompt = buildAnalysisPrompt(sampleReasonerRequest());
    const parsed = JSON.parse(prompt.user);
    expect(parsed.hints).toBeNull();
  });
});

describe("buildReviewerPrompt", () => {
  it("embeds the schema and the candidate to review", () => {
    const request = sampleReasonerRequest();
    const candidate = sampleAnalysisResult();
    const prompt = buildReviewerPrompt(request, candidate);
    expect(prompt.system).toContain(analysisResultSchemaText());
    const parsed = JSON.parse(prompt.user);
    expect(parsed.candidate).toEqual(candidate);
    expect(parsed.documents).toHaveLength(request.documents.length);
  });

  it("instructs the reviewer to check for unsupported claims and corrections", () => {
    const prompt = buildReviewerPrompt(sampleReasonerRequest(), sampleAnalysisResult());
    const lower = prompt.system.toLowerCase();
    expect(lower).toContain("unsupported");
    expect(lower).toContain("contradiction");
    expect(lower).toContain("classification");
  });

  it("asks for a full corrected document, not a diff", () => {
    const prompt = buildReviewerPrompt(sampleReasonerRequest(), sampleAnalysisResult());
    expect(prompt.system.toLowerCase()).toContain("not a diff");
  });

  it("uses a different system prompt than the primary analysis prompt", () => {
    const request = sampleReasonerRequest();
    const analysisPrompt = buildAnalysisPrompt(request);
    const reviewPrompt = buildReviewerPrompt(request, sampleAnalysisResult());
    expect(reviewPrompt.system).not.toBe(analysisPrompt.system);
  });
});
