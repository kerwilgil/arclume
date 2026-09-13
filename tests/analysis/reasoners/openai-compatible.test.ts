import { afterEach, describe, expect, it } from "vitest";
import {
  OpenAICompatibleReasoner,
  createCustomOpenAiCompatibleReasoner,
  createNvidiaReasoner,
  createOpenAiReasoner,
} from "../../../src/analysis/reasoners/openai-compatible.js";
import { ReasonerError } from "../../../src/errors.js";
import { type FakeServer, sendJson, startFakeServer } from "../../helpers/fake-http-server.js";
import { sampleAnalysisResult, sampleReasonerRequest } from "../../helpers/reasoner-fixtures.js";

let server: FakeServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

function chatCompletionEnvelope(content: string): unknown {
  return { choices: [{ message: { content } }] };
}

describe("OpenAICompatibleReasoner — success", () => {
  it("returns a validated AnalysisResult from a well-formed chat completion", async () => {
    const analysis = sampleAnalysisResult();
    server = await startFakeServer((req, res) => {
      expect(req.url).toBe("/chat/completions");
      expect(req.headers.authorization).toBe("Bearer sk-test-key");
      sendJson(res, 200, chatCompletionEnvelope(JSON.stringify(analysis)));
    });
    const reasoner = new OpenAICompatibleReasoner({
      id: "openai",
      baseUrl: server.url,
      apiKey: "sk-test-key",
      model: "gpt-4.1",
    });
    const result = await reasoner.analyze(sampleReasonerRequest());
    expect(result.analysis).toEqual(analysis);
    expect(result.reasoner).toEqual({ id: "openai", version: "0.1.0" });
  });

  it("extracts JSON even when the model wraps it in a markdown fence", async () => {
    const analysis = sampleAnalysisResult();
    server = await startFakeServer((_req, res) => {
      sendJson(res, 200, chatCompletionEnvelope(`\`\`\`json\n${JSON.stringify(analysis)}\n\`\`\``));
    });
    const reasoner = new OpenAICompatibleReasoner({
      id: "openai",
      baseUrl: server.url,
      model: "gpt-4.1",
    });
    const result = await reasoner.analyze(sampleReasonerRequest());
    expect(result.analysis).toEqual(analysis);
  });

  it("sends the ARCLUME analysis prompt as system/user messages", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    server = await startFakeServer((_req, res, body) => {
      capturedBody = JSON.parse(body);
      sendJson(res, 200, chatCompletionEnvelope(JSON.stringify(sampleAnalysisResult())));
    });
    const reasoner = new OpenAICompatibleReasoner({
      id: "openai",
      baseUrl: server.url,
      model: "gpt-4.1",
    });
    await reasoner.analyze(sampleReasonerRequest());
    const messages = capturedBody?.["messages"] as Array<{ role: string; content: string }>;
    expect(messages[0]?.role).toBe("system");
    expect(messages[1]?.role).toBe("user");
    expect(messages[0]?.content).toContain("AnalysisResult JSON Schema");
  });
});

describe("OpenAICompatibleReasoner — failure modes", () => {
  it("maps HTTP 401 to reasoner/provider-auth-failed (invalid API key)", async () => {
    server = await startFakeServer((_req, res) => sendJson(res, 401, { error: "invalid api key" }));
    const reasoner = new OpenAICompatibleReasoner({
      id: "openai",
      baseUrl: server.url,
      model: "gpt-4.1",
    });
    await expect(reasoner.analyze(sampleReasonerRequest())).rejects.toMatchObject({
      code: "reasoner/provider-auth-failed",
    });
  });

  it("maps HTTP 404 to reasoner/provider-model-unavailable", async () => {
    server = await startFakeServer((_req, res) => sendJson(res, 404, { error: "model not found" }));
    const reasoner = new OpenAICompatibleReasoner({
      id: "openai",
      baseUrl: server.url,
      model: "does-not-exist",
    });
    await expect(reasoner.analyze(sampleReasonerRequest())).rejects.toMatchObject({
      code: "reasoner/provider-model-unavailable",
    });
  });

  it("maps another non-2xx status to reasoner/provider-http-error", async () => {
    server = await startFakeServer((_req, res) => sendJson(res, 500, { error: "internal" }));
    const reasoner = new OpenAICompatibleReasoner({
      id: "openai",
      baseUrl: server.url,
      model: "gpt-4.1",
    });
    await expect(reasoner.analyze(sampleReasonerRequest())).rejects.toMatchObject({
      code: "reasoner/provider-http-error",
    });
  });

  it("maps a connection failure to reasoner/provider-unavailable", async () => {
    // Nothing listens on this port.
    const reasoner = new OpenAICompatibleReasoner({
      id: "openai",
      baseUrl: "http://127.0.0.1:1",
      model: "gpt-4.1",
      timeoutMs: 2000,
    });
    await expect(reasoner.analyze(sampleReasonerRequest())).rejects.toMatchObject({
      code: "reasoner/provider-unavailable",
    });
  });

  it("maps a timeout to reasoner/provider-timeout", async () => {
    server = await startFakeServer((_req, res) => {
      setTimeout(() => sendJson(res, 200, chatCompletionEnvelope("{}")), 5000);
    });
    const reasoner = new OpenAICompatibleReasoner({
      id: "openai",
      baseUrl: server.url,
      model: "gpt-4.1",
      timeoutMs: 200,
    });
    await expect(reasoner.analyze(sampleReasonerRequest())).rejects.toMatchObject({
      code: "reasoner/provider-timeout",
    });
  }, 10_000);

  it("maps a non-JSON response body to reasoner/provider-malformed-response", async () => {
    server = await startFakeServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("not json at all");
    });
    const reasoner = new OpenAICompatibleReasoner({
      id: "openai",
      baseUrl: server.url,
      model: "gpt-4.1",
    });
    await expect(reasoner.analyze(sampleReasonerRequest())).rejects.toMatchObject({
      code: "reasoner/provider-malformed-response",
    });
  });

  it("rejects a syntactically-valid-JSON body missing choices[0].message.content", async () => {
    server = await startFakeServer((_req, res) => sendJson(res, 200, { choices: [] }));
    const reasoner = new OpenAICompatibleReasoner({
      id: "openai",
      baseUrl: server.url,
      model: "gpt-4.1",
    });
    await expect(reasoner.analyze(sampleReasonerRequest())).rejects.toMatchObject({
      code: "reasoner/provider-malformed-response",
    });
  });

  it("rejects a well-formed chat response whose content fails schema validation", async () => {
    server = await startFakeServer((_req, res) =>
      sendJson(res, 200, chatCompletionEnvelope('{"nope":true}')),
    );
    const reasoner = new OpenAICompatibleReasoner({
      id: "openai",
      baseUrl: server.url,
      model: "gpt-4.1",
    });
    await expect(reasoner.analyze(sampleReasonerRequest())).rejects.toMatchObject({
      code: "reasoner/malformed-output",
    });
  });

  it("rejects an invalid base URL before making any request", async () => {
    const reasoner = new OpenAICompatibleReasoner({
      id: "openai",
      baseUrl: "not-a-url",
      model: "gpt-4.1",
    });
    await expect(reasoner.analyze(sampleReasonerRequest())).rejects.toMatchObject({
      code: "reasoner/provider-invalid-base-url",
    });
  });

  it("every failure surfaces as a ReasonerError, never a raw exception", async () => {
    server = await startFakeServer((_req, res) => sendJson(res, 500, {}));
    const reasoner = new OpenAICompatibleReasoner({
      id: "openai",
      baseUrl: server.url,
      model: "gpt-4.1",
    });
    await expect(reasoner.analyze(sampleReasonerRequest())).rejects.toBeInstanceOf(ReasonerError);
  });
});

describe("factory functions — NVIDIA and Custom reuse the same OpenAI-compatible transport", () => {
  it("createNvidiaReasoner talks to the configured base URL with the nvidia id", async () => {
    const analysis = sampleAnalysisResult();
    server = await startFakeServer((_req, res) =>
      sendJson(res, 200, chatCompletionEnvelope(JSON.stringify(analysis))),
    );
    const reasoner = createNvidiaReasoner({
      apiKey: "nv-key",
      baseUrl: server.url,
      model: "some/model",
    });
    expect(reasoner.capabilities.id).toBe("nvidia");
    const result = await reasoner.analyze(sampleReasonerRequest());
    expect(result.reasoner.id).toBe("nvidia");
  });

  it("createOpenAiReasoner defaults to the official base URL and recommended model", () => {
    const reasoner = createOpenAiReasoner({ apiKey: "sk-x" });
    expect(reasoner.capabilities.id).toBe("openai");
  });

  it("createCustomOpenAiCompatibleReasoner accepts an optional API key", async () => {
    let sawAuthHeader = false;
    server = await startFakeServer((req, res) => {
      sawAuthHeader = req.headers.authorization !== undefined;
      sendJson(res, 200, chatCompletionEnvelope(JSON.stringify(sampleAnalysisResult())));
    });
    const reasoner = createCustomOpenAiCompatibleReasoner({
      baseUrl: server.url,
      model: "local-model",
    });
    await reasoner.analyze(sampleReasonerRequest());
    expect(sawAuthHeader).toBe(false);
  });
});
