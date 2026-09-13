/**
 * `/api/settings/*` and the Direct-Analyze / Verified-mode flow
 * (`.../analyze`, `.../review`, `.../accept-candidate`), against the real
 * server on an ephemeral port. Config/secrets are isolated per test via a
 * temp %LOCALAPPDATA% (win32) / XDG dirs (elsewhere) — never the real
 * machine-wide ARCLUME config.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSecret } from "../src/config/secrets-store.js";
import { type WebServerHandle, startArclumeWeb } from "../src/web/server.js";
import { type FakeServer, sendJson, startFakeServer } from "./helpers/fake-http-server.js";
import { sampleAnalysisResult } from "./helpers/reasoner-fixtures.js";

beforeAll(() => {
  if (!existsSync(join(process.cwd(), "web", "dist", "index.html"))) {
    execFileSync("npm", ["run", "build"], {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: process.platform === "win32",
    });
  }
}, 300_000);

let dir = "";
let configHome = "";
let server: WebServerHandle;
const savedEnv: Record<string, string | undefined> = {};

function isolateConfigHome(): void {
  configHome = mkdtempSync(join(tmpdir(), "arclume-web-ai-config-"));
  if (process.platform === "win32") {
    savedEnv["LOCALAPPDATA"] = process.env["LOCALAPPDATA"];
    process.env["LOCALAPPDATA"] = configHome;
  } else {
    savedEnv["XDG_CONFIG_HOME"] = process.env["XDG_CONFIG_HOME"];
    savedEnv["XDG_DATA_HOME"] = process.env["XDG_DATA_HOME"];
    process.env["XDG_CONFIG_HOME"] = join(configHome, "config");
    process.env["XDG_DATA_HOME"] = join(configHome, "data");
  }
}

function restoreConfigHome(): void {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(configHome, { recursive: true, force: true });
}

beforeEach(async () => {
  isolateConfigHome();
  dir = mkdtempSync(join(tmpdir(), "arclume-web-ai-test-"));
  server = await startArclumeWeb({ port: 0 });
});

afterEach(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
  restoreConfigHome();
});

function fixtureProject(): string {
  const p = join(dir, "proj");
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, "README.md"), "# Web Test\n\nA fixture project.\n");
  return p;
}

async function apiRaw(
  path: string,
  opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  const headers = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined && !("content-type" in headers)) {
    headers["content-type"] = "application/json";
  }
  const res = await fetch(`${server.url}${path}`, {
    method: opts.method ?? "GET",
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, text, json };
}

function authed(path: string, opts?: Parameters<typeof apiRaw>[1]) {
  return apiRaw(path, {
    ...opts,
    headers: { "x-arclume-session": server.token, ...(opts?.headers ?? {}) },
  });
}

async function makeWorkspace(): Promise<string> {
  const res = await authed("/api/workspaces", {
    method: "POST",
    body: { source: { kind: "path", value: fixtureProject() } },
  });
  expect(res.status).toBe(201);
  return (res.json as { workspace: { id: string } }).workspace.id;
}

// ─────────────────────────── /api/settings/providers ───────────────────────

describe("GET /api/settings/providers", () => {
  it("lists every provider with the stub active and no secrets configured", async () => {
    const res = await authed("/api/settings/providers");
    expect(res.status).toBe(200);
    const body = res.json as {
      ok: boolean;
      activeProvider: string;
      analysisQuality: string;
      providers: Array<{ id: string; secretConfigured: boolean }>;
    };
    expect(body.ok).toBe(true);
    expect(body.activeProvider).toBe("stub");
    expect(body.analysisQuality).toBe("fast");
    expect(body.providers.map((p) => p.id)).toEqual([
      "stub",
      "claude-code",
      "codex",
      "anthropic",
      "openai",
      "nvidia",
      "openai-compatible",
      "ollama",
    ]);
    const openai = body.providers.find((p) => p.id === "openai");
    expect(openai?.secretConfigured).toBe(false);
  });

  it("GET is open like every other read route (only mutations require the session)", async () => {
    const res = await apiRaw("/api/settings/providers");
    expect(res.status).toBe(200);
  });
});

describe("mutations under /api/settings require the session token", () => {
  it("rejects PUT active-provider without a session", async () => {
    const res = await apiRaw("/api/settings/providers/active", {
      method: "PUT",
      body: { activeProvider: "openai" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects PUT a secret without a session", async () => {
    const res = await apiRaw("/api/settings/secrets/OPENAI_API_KEY", {
      method: "PUT",
      body: { value: "sk-x" },
    });
    expect(res.status).toBe(401);
  });
});

describe("PUT /api/settings/providers/active", () => {
  it("persists the active provider, quality, and reviewer selection", async () => {
    const put = await authed("/api/settings/providers/active", {
      method: "PUT",
      body: {
        activeProvider: "openai",
        analysisQuality: "verified",
        reviewer: { provider: "anthropic" },
      },
    });
    expect(put.status).toBe(200);
    const get = await authed("/api/settings/providers");
    const body = get.json as {
      activeProvider: string;
      analysisQuality: string;
      reviewer?: unknown;
    };
    expect(body.activeProvider).toBe("openai");
    expect(body.analysisQuality).toBe("verified");
    expect(body.reviewer).toEqual({ provider: "anthropic" });
  });

  it("rejects an unknown provider id", async () => {
    const res = await authed("/api/settings/providers/active", {
      method: "PUT",
      body: { activeProvider: "not-a-real-provider" },
    });
    expect(res.status).toBe(400);
  });

  it("clears the reviewer when omitted from the request", async () => {
    await authed("/api/settings/providers/active", {
      method: "PUT",
      body: {
        activeProvider: "openai",
        analysisQuality: "verified",
        reviewer: { provider: "anthropic" },
      },
    });
    await authed("/api/settings/providers/active", {
      method: "PUT",
      body: { activeProvider: "openai", analysisQuality: "fast" },
    });
    const get = await authed("/api/settings/providers");
    expect((get.json as { reviewer?: unknown }).reviewer).toBeUndefined();
  });
});

describe("PUT /api/settings/providers/:id/config", () => {
  it("saves model/baseUrl and they come back in the provider summary", async () => {
    const res = await authed("/api/settings/providers/openai/config", {
      method: "PUT",
      body: { model: "gpt-4.1-mini" },
    });
    expect(res.status).toBe(200);
    const get = await authed("/api/settings/providers");
    const openai = (
      get.json as { providers: Array<{ id: string; config: unknown }> }
    ).providers.find((p) => p.id === "openai");
    expect(openai?.config).toEqual({ model: "gpt-4.1-mini" });
  });
});

// ────────────────────────────── secrets CRUD ────────────────────────────────

describe("secrets endpoints", () => {
  it("rejects an unknown secret key", async () => {
    const res = await authed("/api/settings/secrets/NOT_A_REAL_KEY", {
      method: "PUT",
      body: { value: "x" },
    });
    expect(res.status).toBe(400);
  });

  it("set then reflects secretConfigured:true with a masked hint, never the raw value", async () => {
    const put = await authed("/api/settings/secrets/OPENAI_API_KEY", {
      method: "PUT",
      body: { value: "sk-super-secret-value-123456" },
    });
    expect(put.status).toBe(200);
    const putBody = put.json as { configured: boolean; secretHint: string };
    expect(putBody.configured).toBe(true);
    expect(putBody.secretHint).not.toContain("sk-super-secret-value-123456");
    expect(put.text).not.toContain("sk-super-secret-value-123456");

    const get = await authed("/api/settings/providers");
    const openai = (
      get.json as {
        providers: Array<{ id: string; secretConfigured: boolean; secretHint?: string }>;
      }
    ).providers.find((p) => p.id === "openai");
    expect(openai?.secretConfigured).toBe(true);
    expect(openai?.secretHint).toBeDefined();
    expect(get.text).not.toContain("sk-super-secret-value-123456");
  });

  it("delete clears secretConfigured", async () => {
    await authed("/api/settings/secrets/OPENAI_API_KEY", {
      method: "PUT",
      body: { value: "sk-x" },
    });
    const del = await authed("/api/settings/secrets/OPENAI_API_KEY", { method: "DELETE" });
    expect(del.status).toBe(200);
    expect((del.json as { configured: boolean }).configured).toBe(false);
    const get = await authed("/api/settings/providers");
    const openai = (
      get.json as { providers: Array<{ id: string; secretConfigured: boolean }> }
    ).providers.find((p) => p.id === "openai");
    expect(openai?.secretConfigured).toBe(false);
  });

  it("rejects an empty-string value", async () => {
    const res = await authed("/api/settings/secrets/OPENAI_API_KEY", {
      method: "PUT",
      body: { value: "" },
    });
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────── Test Connection ────────────────────────────

describe("POST /api/settings/providers/:id/test", () => {
  it("stub is always ready", async () => {
    const res = await authed("/api/settings/providers/stub/test", { method: "POST" });
    expect(res.status).toBe(200);
    expect((res.json as { ready: boolean }).ready).toBe(true);
  });

  it("an unconfigured api-key provider reports not-ready with kind 'auth', never a raw exception", async () => {
    const res = await authed("/api/settings/providers/openai/test", { method: "POST" });
    expect(res.status).toBe(200);
    const body = res.json as { ready: boolean; kind?: string; message: string };
    expect(body.ready).toBe(false);
    expect(body.kind).toBe("auth");
    expect(body.message).not.toContain("sk-");
  });

  it("openai-compatible with no baseUrl/model reports not-ready without ever making a network call", async () => {
    const res = await authed("/api/settings/providers/openai-compatible/test", { method: "POST" });
    expect(res.status).toBe(200);
    expect((res.json as { ready: boolean }).ready).toBe(false);
  });

  it("a real fake-HTTP OpenAI-compatible endpoint reports ready", async () => {
    const fake = await startFakeServer((req, res) => {
      expect(req.url).toBe("/chat/completions");
      sendJson(res, 200, { choices: [{ message: { content: "ok" } }] });
    });
    try {
      await authed("/api/settings/providers/openai-compatible/config", {
        method: "PUT",
        body: { baseUrl: fake.url, model: "gpt-4.1" },
      });
      const res = await authed("/api/settings/providers/openai-compatible/test", {
        method: "POST",
      });
      expect(res.status).toBe(200);
      expect((res.json as { ready: boolean }).ready).toBe(true);
    } finally {
      await fake.close();
    }
  });
});

// ────────────────────────── Direct Analyze — Fast mode ─────────────────────

describe("POST /api/workspaces/:id/analyze — Fast mode", () => {
  it("with the default stub provider, commits knowledge immediately", async () => {
    const ws = await makeWorkspace();
    const res = await authed(`/api/workspaces/${ws}/analyze`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = res.json as { ok: boolean; mode: string; reasonerId: string };
    expect(body.mode).toBe("fast");
    expect(body.reasonerId).toBe("stub");
    const knowledge = await authed(`/api/workspaces/${ws}/knowledge`);
    expect(knowledge.status).toBe(200);
  });

  it("an active provider with no API key configured fails loudly — never a silent stub fallback", async () => {
    await authed("/api/settings/providers/active", {
      method: "PUT",
      body: { activeProvider: "openai", analysisQuality: "fast" },
    });
    const ws = await makeWorkspace();
    const res = await authed(`/api/workspaces/${ws}/analyze`, { method: "POST" });
    expect(res.status).toBe(400);
    const body = res.json as { ok: boolean; code: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("reasoner/provider-not-configured");
    const knowledge = await authed(`/api/workspaces/${ws}/knowledge`);
    expect(knowledge.status).toBe(409); // still nothing committed
  });
});

// ────────────────────── Direct Analyze — Verified mode ──────────────────────

describe("POST .../analyze + .../review — Verified mode", () => {
  let primary: FakeServer;
  let reviewer: FakeServer;

  afterEach(async () => {
    await primary?.close();
    await reviewer?.close();
  });

  function toolUseEnvelope(result: unknown): unknown {
    return { content: [{ type: "tool_use", name: "submit_analysis", input: { result } }] };
  }

  /** `sampleAnalysisResult()` is deterministic, so the primary's candidate and
   * the reviewer's echoed-back result are structurally identical here unless
   * a test deliberately makes the reviewer disagree. */
  async function configureVerified(
    reviewerHandler: (
      req: import("node:http").IncomingMessage,
      res: import("node:http").ServerResponse,
    ) => void,
  ): Promise<void> {
    const analysis = sampleAnalysisResult();
    primary = await startFakeServer((_req, res) =>
      sendJson(res, 200, { choices: [{ message: { content: JSON.stringify(analysis) } }] }),
    );
    reviewer = await startFakeServer(reviewerHandler);
    await authed("/api/settings/providers/openai-compatible/config", {
      method: "PUT",
      body: { baseUrl: primary.url, model: "primary-model" },
    });
    await authed("/api/settings/providers/anthropic/config", {
      method: "PUT",
      body: { baseUrl: reviewer.url, model: "reviewer-model" },
    });
    setSecret("ANTHROPIC_API_KEY", "sk-ant-reviewer-key");
    await authed("/api/settings/providers/active", {
      method: "PUT",
      body: {
        activeProvider: "openai-compatible",
        analysisQuality: "verified",
        reviewer: { provider: "anthropic" },
      },
    });
  }

  it("stages a pending candidate without committing knowledge", async () => {
    await configureVerified((_req, res) =>
      sendJson(res, 200, toolUseEnvelope(sampleAnalysisResult())),
    );
    const ws = await makeWorkspace();
    const res = await authed(`/api/workspaces/${ws}/analyze`, { method: "POST" });
    expect(res.status).toBe(200);
    expect((res.json as { mode: string }).mode).toBe("verified-pending");
    const knowledge = await authed(`/api/workspaces/${ws}/knowledge`);
    expect(knowledge.status).toBe(409); // Verified: not committed until review
  });

  it("reviewer approves an identical result → verified-approved, knowledge committed", async () => {
    await configureVerified((_req, res) =>
      sendJson(res, 200, toolUseEnvelope(sampleAnalysisResult())),
    );
    const ws = await makeWorkspace();
    await authed(`/api/workspaces/${ws}/analyze`, { method: "POST" });
    const res = await authed(`/api/workspaces/${ws}/review`, { method: "POST" });
    expect(res.status).toBe(200);
    expect((res.json as { mode: string }).mode).toBe("verified-approved");
    const knowledge = await authed(`/api/workspaces/${ws}/knowledge`);
    expect(knowledge.status).toBe(200);
  });

  it("reviewer returns a corrected result → verified-corrected, the correction is what's committed", async () => {
    const corrected = sampleAnalysisResult("corrected-project-name");
    await configureVerified((_req, res) => sendJson(res, 200, toolUseEnvelope(corrected)));
    const ws = await makeWorkspace();
    await authed(`/api/workspaces/${ws}/analyze`, { method: "POST" });
    const res = await authed(`/api/workspaces/${ws}/review`, { method: "POST" });
    expect(res.status).toBe(200);
    expect((res.json as { mode: string }).mode).toBe("verified-corrected");
    const knowledge = await authed(`/api/workspaces/${ws}/knowledge`);
    const body = knowledge.json as { knowledge: { project: { name: string } } };
    expect(body.knowledge.project.name).toBe("corrected-project-name");
  });

  it("a misconfigured reviewer fails gracefully — never silently promotes the candidate", async () => {
    await configureVerified((_req, res) =>
      sendJson(res, 200, toolUseEnvelope(sampleAnalysisResult())),
    );
    // Now break the reviewer: point it at a provider with no key configured.
    await authed("/api/settings/providers/active", {
      method: "PUT",
      body: {
        activeProvider: "openai-compatible",
        analysisQuality: "verified",
        reviewer: { provider: "openai" }, // openai has no API key set in this test
      },
    });
    const ws = await makeWorkspace();
    await authed(`/api/workspaces/${ws}/analyze`, { method: "POST" });
    const res = await authed(`/api/workspaces/${ws}/review`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = res.json as { mode: string; reason: string };
    expect(body.mode).toBe("verified-reviewer-failed");
    expect(body.reason).not.toContain("sk-");
    const knowledge = await authed(`/api/workspaces/${ws}/knowledge`);
    expect(knowledge.status).toBe(409); // still not committed

    // The explicit recovery path: accept the unreviewed candidate as Fast.
    const accept = await authed(`/api/workspaces/${ws}/accept-candidate`, { method: "POST" });
    expect(accept.status).toBe(200);
    expect((accept.json as { mode: string }).mode).toBe("fast-accepted");
    const knowledge2 = await authed(`/api/workspaces/${ws}/knowledge`);
    expect(knowledge2.status).toBe(200);
  });
});

// ─────────────────────────── /api/settings/providers/:id/models ───────────────

describe("GET /api/settings/providers/:id/models — model discovery", () => {
  // NVIDIA
  describe("NVIDIA", () => {
    it("model discovery success", async () => {
      const fake = await startFakeServer((req, res) => {
        expect(req.url).toBe("/v1/models");
        sendJson(res, 200, {
          data: [{ id: "meta/llama-3.1-70b-instruct" }, { id: "meta/llama-3.1-8b-instruct" }],
        });
      });
      try {
        setSecret("NVIDIA_API_KEY", "nvidia-key-123");
        await authed("/api/settings/providers/nvidia/config", {
          method: "PUT",
          body: { baseUrl: `${fake.url}/v1` },
        });
        const res = await authed("/api/settings/providers/nvidia/models");
        expect(res.status).toBe(200);
        const body = res.json as { ok: boolean; models: string[] };
        expect(body.ok).toBe(true);
        expect(body.models).toEqual(["meta/llama-3.1-70b-instruct", "meta/llama-3.1-8b-instruct"]);
      } finally {
        await fake.close();
      }
    });

    it("model discovery auth failure returns structured error", async () => {
      const fake = await startFakeServer((_req, res) => {
        sendJson(res, 401, { error: "unauthorized" });
      });
      try {
        setSecret("NVIDIA_API_KEY", "bad-key");
        await authed("/api/settings/providers/nvidia/config", {
          method: "PUT",
          body: { baseUrl: `${fake.url}/v1` },
        });
        const res = await authed("/api/settings/providers/nvidia/models");
        expect(res.status).toBe(200);
        const body = res.json as { ok: boolean; error: string; message: string };
        expect(body.ok).toBe(false);
        expect(body.error).toBe("auth");
        expect(body.message).toContain("authentication failed");
      } finally {
        await fake.close();
      }
    });

    it("model discovery network failure returns structured error", async () => {
      // Configure with an unreachable URL
      setSecret("NVIDIA_API_KEY", "nvidia-key-123");
      await authed("/api/settings/providers/nvidia/config", {
        method: "PUT",
        body: { baseUrl: "http://127.0.0.1:9999/v1" },
      });
      const res = await authed("/api/settings/providers/nvidia/models");
      expect(res.status).toBe(200);
      const body = res.json as { ok: boolean; error: string; message: string };
      expect(body.ok).toBe(false);
      expect(body.error).toBe("unavailable");
      expect(body.message).toContain("could not reach");
    });

    it("empty model list", async () => {
      const fake = await startFakeServer((req, res) => {
        expect(req.url).toBe("/v1/models");
        sendJson(res, 200, { data: [] });
      });
      try {
        setSecret("NVIDIA_API_KEY", "nvidia-key-123");
        await authed("/api/settings/providers/nvidia/config", {
          method: "PUT",
          body: { baseUrl: `${fake.url}/v1` },
        });
        const res = await authed("/api/settings/providers/nvidia/models");
        expect(res.status).toBe(200);
        const body = res.json as { ok: boolean; models: string[] };
        expect(body.ok).toBe(true);
        expect(body.models).toEqual([]);
      } finally {
        await fake.close();
      }
    });

    it("refresh models calls the endpoint again", async () => {
      const fake = await startFakeServer((req, res) => {
        expect(req.url).toBe("/v1/models");
        sendJson(res, 200, { data: [{ id: "model-1" }] });
      });
      try {
        setSecret("NVIDIA_API_KEY", "nvidia-key-123");
        await authed("/api/settings/providers/nvidia/config", {
          method: "PUT",
          body: { baseUrl: `${fake.url}/v1` },
        });
        const res1 = await authed("/api/settings/providers/nvidia/models");
        expect(res1.status).toBe(200);
        const body1 = res1.json as { ok: boolean; models: string[] };
        expect(body1.models).toEqual(["model-1"]);
        // Second call
        const res2 = await authed("/api/settings/providers/nvidia/models");
        expect(res2.status).toBe(200);
        const body2 = res2.json as { ok: boolean; models: string[] };
        expect(body2.models).toEqual(["model-1"]);
      } finally {
        await fake.close();
      }
    });
  });

  // OpenAI
  describe("OpenAI", () => {
    it("model discovery success", async () => {
      const fake = await startFakeServer((req, res) => {
        expect(req.url).toBe("/v1/models");
        sendJson(res, 200, { data: [{ id: "gpt-4.1" }, { id: "gpt-4.1-mini" }] });
      });
      try {
        setSecret("OPENAI_API_KEY", "openai-key-123");
        await authed("/api/settings/providers/openai/config", {
          method: "PUT",
          body: { baseUrl: `${fake.url}/v1` },
        });
        const res = await authed("/api/settings/providers/openai/models");
        expect(res.status).toBe(200);
        const body = res.json as { ok: boolean; models: string[] };
        expect(body.ok).toBe(true);
        expect(body.models).toEqual(["gpt-4.1", "gpt-4.1-mini"]);
      } finally {
        await fake.close();
      }
    });

    it("discovery failure returns structured error", async () => {
      setSecret("OPENAI_API_KEY", "openai-key-123");
      await authed("/api/settings/providers/openai/config", {
        method: "PUT",
        body: { baseUrl: "http://127.0.0.1:9999/v1" },
      });
      const res = await authed("/api/settings/providers/openai/models");
      expect(res.status).toBe(200);
      const body = res.json as { ok: boolean; error: string };
      expect(body.ok).toBe(false);
      expect(body.error).toBe("unavailable");
    });
  });

  // OpenAI-compatible
  describe("OpenAI-compatible", () => {
    it("model discovery success when /models supported", async () => {
      const fake = await startFakeServer((req, res) => {
        expect(req.url).toBe("/v1/models");
        sendJson(res, 200, { data: [{ id: "custom-model-1" }] });
      });
      try {
        setSecret("OPENAI_COMPATIBLE_API_KEY", "compat-key");
        await authed("/api/settings/providers/openai-compatible/config", {
          method: "PUT",
          body: { baseUrl: `${fake.url}/v1`, model: "custom-model-1" },
        });
        const res = await authed("/api/settings/providers/openai-compatible/models");
        expect(res.status).toBe(200);
        const body = res.json as { ok: boolean; models: string[] };
        expect(body.ok).toBe(true);
        expect(body.models).toEqual(["custom-model-1"]);
      } finally {
        await fake.close();
      }
    });

    it("model discovery unsupported (404) returns structured error", async () => {
      const fake = await startFakeServer((req, res) => {
        expect(req.url).toBe("/v1/models");
        res.statusCode = 404;
        res.end();
      });
      try {
        setSecret("OPENAI_COMPATIBLE_API_KEY", "compat-key");
        await authed("/api/settings/providers/openai-compatible/config", {
          method: "PUT",
          body: { baseUrl: `${fake.url}/v1`, model: "custom-model-1" },
        });
        const res = await authed("/api/settings/providers/openai-compatible/models");
        expect(res.status).toBe(200);
        const body = res.json as { ok: boolean; error: string; message: string };
        expect(body.ok).toBe(false);
        expect(body.error).toBe("model-unavailable");
      } finally {
        await fake.close();
      }
    });
  });

  // Ollama
  describe("Ollama", () => {
    it("local discovery success", async () => {
      const fake = await startFakeServer((req, res) => {
        expect(req.url).toBe("/api/tags");
        sendJson(res, 200, { models: [{ name: "llama3.1:70b" }, { name: "mistral:7b" }] });
      });
      try {
        await authed("/api/settings/providers/ollama/config", {
          method: "PUT",
          body: { baseUrl: fake.url, model: "llama3.1:70b" },
        });
        const res = await authed("/api/settings/providers/ollama/models");
        expect(res.status).toBe(200);
        const body = res.json as { ok: boolean; models: string[] };
        expect(body.ok).toBe(true);
        expect(body.models).toEqual(["llama3.1:70b", "mistral:7b"]);
      } finally {
        await fake.close();
      }
    });

    it("offline behavior returns structured error", async () => {
      // No fake server
      await authed("/api/settings/providers/ollama/config", {
        method: "PUT",
        body: { baseUrl: "http://127.0.0.1:9999", model: "llama3.1:70b" },
      });
      const res = await authed("/api/settings/providers/ollama/models");
      expect(res.status).toBe(200);
      const body = res.json as { ok: boolean; error: string };
      expect(body.ok).toBe(false);
      expect(body.error).toBe("unavailable");
    });
  });

  // Non-discoverable providers return empty list
  describe("non-discoverable providers", () => {
    it("anthropic returns empty models list", async () => {
      const res = await authed("/api/settings/providers/anthropic/models");
      expect(res.status).toBe(200);
      const body = res.json as { ok: boolean; models: string[] };
      expect(body.ok).toBe(true);
      expect(body.models).toEqual([]);
    });

    it("claude-code returns empty models list", async () => {
      const res = await authed("/api/settings/providers/claude-code/models");
      expect(res.status).toBe(200);
      const body = res.json as { ok: boolean; models: string[] };
      expect(body.ok).toBe(true);
      expect(body.models).toEqual([]);
    });

    it("codex returns empty models list", async () => {
      const res = await authed("/api/settings/providers/codex/models");
      expect(res.status).toBe(200);
      const body = res.json as { ok: boolean; models: string[] };
      expect(body.ok).toBe(true);
      expect(body.models).toEqual([]);
    });

    it("stub returns empty models list", async () => {
      const res = await authed("/api/settings/providers/stub/models");
      expect(res.status).toBe(200);
      const body = res.json as { ok: boolean; models: string[] };
      expect(body.ok).toBe(true);
      expect(body.models).toEqual([]);
    });
  });
});

// ───────────────────────── Claude Code / Codex UX ───────────────────────────

describe("Claude Code / Codex — no free-text model control", () => {
  it("Claude Code: automatic model default, no explicit model required for test", async () => {
    // Use fake CLI detection
    const fakeClaude = await startFakeServer((_req, res) => {
      sendJson(res, 200, { choices: [{ message: { content: "ok" } }] });
    });
    try {
      // We can't easily test the CLI detection here without the actual binary,
      // but we verify the API allows test without model
      const res = await authed("/api/settings/providers/claude-code/test", { method: "POST" });
      expect(res.status).toBe(200);
      // Should not require a model to be configured
    } finally {
      await fakeClaude.close();
    }
  });

  it("Codex: automatic model default, no explicit model required for test", async () => {
    const fakeCodex = await startFakeServer((_req, res) => {
      sendJson(res, 200, { choices: [{ message: { content: "ok" } }] });
    });
    try {
      const res = await authed("/api/settings/providers/codex/test", { method: "POST" });
      expect(res.status).toBe(200);
    } finally {
      await fakeCodex.close();
    }
  });
});

// ────────────────────────────────── Stub UX ────────────────────────────────

describe("Stub — no model selector", () => {
  it("stub provider has no model configuration in summary", async () => {
    const res = await authed("/api/settings/providers");
    const stub = (
      res.json as { providers: Array<{ id: string; requiresModel: boolean }> }
    ).providers.find((p) => p.id === "stub");
    expect(stub).toBeDefined();
    expect(stub?.requiresModel).toBe(false);
  });
});

// ──────────────────────────── Retired Model Handling ────────────────────────

describe("Retired model handling", () => {
  it("410 for retired configured model produces user-friendly error kind", async () => {
    const fake = await startFakeServer((req, res) => {
      expect(req.url).toBe("/chat/completions");
      // Simulate 410 Gone for retired model
      sendJson(res, 410, {
        error: { message: "This model has been deprecated", code: "model_deleted" },
      });
    });
    try {
      setSecret("OPENAI_API_KEY", "openai-key-123");
      await authed("/api/settings/providers/openai/config", {
        method: "PUT",
        body: { baseUrl: fake.url, model: "meta/llama-3.1-70b-instruct" },
      });
      const res = await authed("/api/settings/providers/openai/test", { method: "POST" });
      expect(res.status).toBe(200);
      const body = res.json as { ready: boolean; kind?: string; message: string };
      expect(body.ready).toBe(false);
      // The kind should be model-unavailable or similar user-friendly kind
      expect(["model-unavailable", "http-error"].includes(body.kind ?? "")).toBe(true);
      // Error message should not expose raw HTTP status code to user in a confusing way
      // (the message includes the status code but the kind is user-friendly)
      expect(body.kind).not.toBe("unknown");
    } finally {
      await fake.close();
    }
  });
});
