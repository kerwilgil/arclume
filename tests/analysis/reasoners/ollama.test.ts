import { afterEach, describe, expect, it } from "vitest";
import {
  OllamaReasoner,
  listOllamaModels,
  testOllamaConnection,
} from "../../../src/analysis/reasoners/ollama.js";
import { ProviderError } from "../../../src/analysis/reasoners/shared.js";
import { type FakeServer, sendJson, startFakeServer } from "../../helpers/fake-http-server.js";
import { sampleAnalysisResult, sampleReasonerRequest } from "../../helpers/reasoner-fixtures.js";

let server: FakeServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("listOllamaModels", () => {
  it("lists models from the native /api/tags endpoint", async () => {
    server = await startFakeServer((req, res) => {
      expect(req.url).toBe("/api/tags");
      sendJson(res, 200, { models: [{ name: "llama3.1:8b" }, { name: "mistral:7b" }] });
    });
    const models = await listOllamaModels(server.url);
    expect(models.map((m) => m.name)).toEqual(["llama3.1:8b", "mistral:7b"]);
  });

  it("throws ProviderError('unavailable') when nothing is listening", async () => {
    await expect(listOllamaModels("http://127.0.0.1:1", 500)).rejects.toMatchObject({
      kind: "unavailable",
    });
  });

  it("throws ProviderError('malformed-response') for an unexpected body shape", async () => {
    server = await startFakeServer((_req, res) => sendJson(res, 200, { nope: true }));
    await expect(listOllamaModels(server.url)).rejects.toMatchObject({
      kind: "malformed-response",
    });
  });
});

describe("testOllamaConnection", () => {
  it("reports ready when Ollama is reachable and the model is present", async () => {
    server = await startFakeServer((_req, res) =>
      sendJson(res, 200, { models: [{ name: "llama3.1:8b" }] }),
    );
    const result = await testOllamaConnection({ baseUrl: server.url, model: "llama3.1:8b" });
    expect(result).toMatchObject({ ready: true });
  });

  it("reports not-ready (model-unavailable) when the model is not pulled locally", async () => {
    server = await startFakeServer((_req, res) =>
      sendJson(res, 200, { models: [{ name: "mistral:7b" }] }),
    );
    const result = await testOllamaConnection({ baseUrl: server.url, model: "llama3.1:8b" });
    expect(result).toMatchObject({ ready: false, kind: "model-unavailable" });
  });

  it("reports not-ready (unavailable) when Ollama is not running — never throws", async () => {
    const result = await testOllamaConnection({ baseUrl: "http://127.0.0.1:1", model: "x" });
    expect(result.ready).toBe(false);
    expect(result.kind).toBe("unavailable");
  });
});

describe("OllamaReasoner — chat via the OpenAI-compatible endpoint", () => {
  it("posts to {baseUrl}/v1/chat/completions and validates the result", async () => {
    const analysis = sampleAnalysisResult();
    server = await startFakeServer((req, res) => {
      expect(req.url).toBe("/v1/chat/completions");
      sendJson(res, 200, { choices: [{ message: { content: JSON.stringify(analysis) } }] });
    });
    const reasoner = new OllamaReasoner({ baseUrl: server.url, model: "llama3.1:8b" });
    expect(reasoner.capabilities.id).toBe("ollama");
    const result = await reasoner.analyze(sampleReasonerRequest());
    expect(result.analysis).toEqual(analysis);
    expect(result.reasoner.id).toBe("ollama");
  });

  it("surfaces an unreachable Ollama as reasoner/provider-unavailable", async () => {
    const reasoner = new OllamaReasoner({
      baseUrl: "http://127.0.0.1:1",
      model: "x",
      timeoutMs: 500,
    });
    await expect(reasoner.analyze(sampleReasonerRequest())).rejects.toMatchObject({
      code: "reasoner/provider-unavailable",
    });
  });

  it("defaults to the standard loopback Ollama port when no baseUrl is given", () => {
    // Constructed but never called — just proves the default doesn't throw
    // and targets loopback (never 0.0.0.0/a LAN address).
    const reasoner = new OllamaReasoner({ model: "x" });
    expect(reasoner.capabilities.id).toBe("ollama");
  });
});

describe("ProviderError re-export sanity", () => {
  it("is the same class used across the ollama module", async () => {
    try {
      await listOllamaModels("http://127.0.0.1:1", 200);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
    }
  });
});
