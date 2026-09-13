import { afterEach, describe, expect, it } from "vitest";
import { AnthropicReasoner } from "../../../src/analysis/reasoners/anthropic.js";
import { ReasonerError } from "../../../src/errors.js";
import { type FakeServer, sendJson, startFakeServer } from "../../helpers/fake-http-server.js";
import { sampleAnalysisResult, sampleReasonerRequest } from "../../helpers/reasoner-fixtures.js";

let server: FakeServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

function toolUseEnvelope(result: unknown): unknown {
  return {
    content: [{ type: "tool_use", name: "submit_analysis", input: { result } }],
  };
}

describe("AnthropicReasoner — success", () => {
  it("returns a validated AnalysisResult from the submit_analysis tool_use block", async () => {
    const analysis = sampleAnalysisResult();
    server = await startFakeServer((req, res, body) => {
      expect(req.url).toBe("/v1/messages");
      expect(req.headers["x-api-key"]).toBe("sk-ant-test");
      expect(req.headers["anthropic-version"]).toBeDefined();
      const parsed = JSON.parse(body);
      expect(parsed.tool_choice).toEqual({ type: "tool", name: "submit_analysis" });
      sendJson(res, 200, toolUseEnvelope(analysis));
    });
    const reasoner = new AnthropicReasoner({
      apiKey: "sk-ant-test",
      baseUrl: server.url,
      model: "claude-sonnet-5",
    });
    const result = await reasoner.analyze(sampleReasonerRequest());
    expect(result.analysis).toEqual(analysis);
    expect(result.reasoner).toEqual({ id: "anthropic", version: "0.1.0" });
  });

  it("forces tool use rather than trusting free-text JSON obedience", async () => {
    let sawTools = false;
    server = await startFakeServer((_req, res, body) => {
      const parsed = JSON.parse(body);
      sawTools = Array.isArray(parsed.tools) && parsed.tools.length === 1;
      sendJson(res, 200, toolUseEnvelope(sampleAnalysisResult()));
    });
    const reasoner = new AnthropicReasoner({
      apiKey: "k",
      baseUrl: server.url,
      model: "claude-sonnet-5",
    });
    await reasoner.analyze(sampleReasonerRequest());
    expect(sawTools).toBe(true);
  });
});

describe("AnthropicReasoner — failure modes", () => {
  it("maps HTTP 401 to reasoner/provider-auth-failed", async () => {
    server = await startFakeServer((_req, res) => sendJson(res, 401, { error: "bad key" }));
    const reasoner = new AnthropicReasoner({
      apiKey: "bad",
      baseUrl: server.url,
      model: "claude-sonnet-5",
    });
    await expect(reasoner.analyze(sampleReasonerRequest())).rejects.toMatchObject({
      code: "reasoner/provider-auth-failed",
    });
  });

  it("maps HTTP 404 (unknown model) to reasoner/provider-model-unavailable", async () => {
    server = await startFakeServer((_req, res) => sendJson(res, 404, { error: "no such model" }));
    const reasoner = new AnthropicReasoner({
      apiKey: "k",
      baseUrl: server.url,
      model: "nonexistent",
    });
    await expect(reasoner.analyze(sampleReasonerRequest())).rejects.toMatchObject({
      code: "reasoner/provider-model-unavailable",
    });
  });

  it("maps a timeout to reasoner/provider-timeout", async () => {
    server = await startFakeServer((_req, res) => {
      setTimeout(() => sendJson(res, 200, toolUseEnvelope(sampleAnalysisResult())), 5000);
    });
    const reasoner = new AnthropicReasoner({
      apiKey: "k",
      baseUrl: server.url,
      model: "claude-sonnet-5",
      timeoutMs: 200,
    });
    await expect(reasoner.analyze(sampleReasonerRequest())).rejects.toMatchObject({
      code: "reasoner/provider-timeout",
    });
  }, 10_000);

  it("rejects a response with no tool_use block", async () => {
    server = await startFakeServer((_req, res) =>
      sendJson(res, 200, { content: [{ type: "text", text: "hi" }] }),
    );
    const reasoner = new AnthropicReasoner({
      apiKey: "k",
      baseUrl: server.url,
      model: "claude-sonnet-5",
    });
    await expect(reasoner.analyze(sampleReasonerRequest())).rejects.toMatchObject({
      code: "reasoner/provider-malformed-response",
    });
  });

  it("rejects a tool_use result that fails ARCLUME's own schema validation", async () => {
    server = await startFakeServer((_req, res) =>
      sendJson(res, 200, toolUseEnvelope({ nope: true })),
    );
    const reasoner = new AnthropicReasoner({
      apiKey: "k",
      baseUrl: server.url,
      model: "claude-sonnet-5",
    });
    await expect(reasoner.analyze(sampleReasonerRequest())).rejects.toMatchObject({
      code: "reasoner/malformed-output",
    });
  });

  it("every failure surfaces as a ReasonerError", async () => {
    server = await startFakeServer((_req, res) => sendJson(res, 500, {}));
    const reasoner = new AnthropicReasoner({
      apiKey: "k",
      baseUrl: server.url,
      model: "claude-sonnet-5",
    });
    await expect(reasoner.analyze(sampleReasonerRequest())).rejects.toBeInstanceOf(ReasonerError);
  });
});
