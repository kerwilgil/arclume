/**
 * Secret-leakage tests for the AI provider settings/analyze surface: an API
 * key must never appear in an HTTP response body, in the on-disk non-secret
 * config (`providers.json`), or in a thrown error's message/hint — no matter
 * which code path produces the error. CI never calls a real provider; every
 * scenario here runs against a fake loopback HTTP server or a fake CLI.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AnthropicReasoner } from "../src/analysis/reasoners/anthropic.js";
import { OpenAICompatibleReasoner } from "../src/analysis/reasoners/openai-compatible.js";
import { pingAnthropic, pingOpenAiCompatible } from "../src/analysis/reasoners/test-connection.js";
import { providersConfigPath, secretsFilePath } from "../src/config/paths.js";
import { setSecret } from "../src/config/secrets-store.js";
import { type WebServerHandle, startArclumeWeb } from "../src/web/server.js";
import { type FakeServer, sendJson, startFakeServer } from "./helpers/fake-http-server.js";
import { sampleReasonerRequest } from "./helpers/reasoner-fixtures.js";

const SECRET = "sk-THIS-VALUE-MUST-NEVER-LEAK-abcdef123456";

beforeAll(() => {
  if (!existsSync(join(process.cwd(), "web", "dist", "index.html"))) {
    execFileSync("npm", ["run", "build"], {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: process.platform === "win32",
    });
  }
}, 300_000);

describe("adapter-level: a failing call never leaks the API key in its error", () => {
  let server: FakeServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("OpenAICompatibleReasoner: a 401 (invalid key) error never contains the key", async () => {
    server = await startFakeServer((req, res) => {
      // Sanity: the secret DOES leave the process on the wire, as it must —
      // this test's job is to prove it never comes back in an error message.
      expect(req.headers.authorization).toBe(`Bearer ${SECRET}`);
      sendJson(res, 401, { error: "invalid api key" });
    });
    const reasoner = new OpenAICompatibleReasoner({
      id: "openai",
      baseUrl: server.url,
      apiKey: SECRET,
      model: "gpt-4.1",
    });
    try {
      await reasoner.analyze(sampleReasonerRequest());
      expect.unreachable();
    } catch (err) {
      const text = JSON.stringify(err, Object.getOwnPropertyNames(err));
      expect(text).not.toContain(SECRET);
      expect((err as Error).message).not.toContain(SECRET);
    }
  });

  it("AnthropicReasoner: a 401 error never contains the key", async () => {
    server = await startFakeServer((req, res) => {
      expect(req.headers["x-api-key"]).toBe(SECRET);
      sendJson(res, 401, { error: "bad key" });
    });
    const reasoner = new AnthropicReasoner({
      apiKey: SECRET,
      baseUrl: server.url,
      model: "claude-sonnet-5",
    });
    try {
      await reasoner.analyze(sampleReasonerRequest());
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain(SECRET);
    }
  });

  it("pingOpenAiCompatible (Test Connection): failure message never contains the key", async () => {
    server = await startFakeServer((_req, res) => sendJson(res, 401, { error: "invalid" }));
    const result = await pingOpenAiCompatible({
      providerId: "openai",
      baseUrl: server.url,
      apiKey: SECRET,
      model: "gpt-4.1",
    });
    expect(result.ready).toBe(false);
    expect(result.message).not.toContain(SECRET);
  });

  it("pingAnthropic (Test Connection): failure message never contains the key", async () => {
    server = await startFakeServer((_req, res) => sendJson(res, 401, { error: "invalid" }));
    const result = await pingAnthropic({
      apiKey: SECRET,
      baseUrl: server.url,
      model: "claude-sonnet-5",
    });
    expect(result.ready).toBe(false);
    expect(result.message).not.toContain(SECRET);
  });

  it("a connection-refused failure never contains the key (nothing to echo back, but check anyway)", async () => {
    const reasoner = new OpenAICompatibleReasoner({
      id: "openai",
      baseUrl: "http://127.0.0.1:1",
      apiKey: SECRET,
      model: "gpt-4.1",
      timeoutMs: 1000,
    });
    try {
      await reasoner.analyze(sampleReasonerRequest());
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain(SECRET);
    }
  });
});

describe("Web API: the configured secret never appears in any response body", () => {
  let dir = "";
  let configHome = "";
  let server: WebServerHandle;
  let fake: FakeServer | undefined;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    configHome = mkdtempSync(join(tmpdir(), "arclume-secleak-config-"));
    if (process.platform === "win32") {
      savedEnv["LOCALAPPDATA"] = process.env["LOCALAPPDATA"];
      process.env["LOCALAPPDATA"] = configHome;
    } else {
      savedEnv["XDG_CONFIG_HOME"] = process.env["XDG_CONFIG_HOME"];
      savedEnv["XDG_DATA_HOME"] = process.env["XDG_DATA_HOME"];
      process.env["XDG_CONFIG_HOME"] = join(configHome, "config");
      process.env["XDG_DATA_HOME"] = join(configHome, "data");
    }
    dir = mkdtempSync(join(tmpdir(), "arclume-secleak-test-"));
    server = await startArclumeWeb({ port: 0 });
  });

  afterEach(async () => {
    await server.close();
    await fake?.close();
    fake = undefined;
    rmSync(dir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(configHome, { recursive: true, force: true });
  });

  function authed(path: string, opts?: { method?: string; body?: unknown }) {
    const headers: Record<string, string> = { "x-arclume-session": server.token };
    if (opts?.body !== undefined) headers["content-type"] = "application/json";
    return fetch(`${server.url}${path}`, {
      method: opts?.method ?? "GET",
      headers,
      ...(opts?.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
  }

  it("PUT secret response, GET providers, and a failing Test Connection all omit the raw key", async () => {
    const putRes = await authed("/api/settings/secrets/OPENAI_API_KEY", {
      method: "PUT",
      body: { value: SECRET },
    });
    expect(await putRes.text()).not.toContain(SECRET);

    const getRes = await authed("/api/settings/providers");
    expect(await getRes.text()).not.toContain(SECRET);

    fake = await startFakeServer((_req, res) => sendJson(res, 401, { error: "invalid" }));
    await authed("/api/settings/providers/openai/config", {
      method: "PUT",
      body: { model: "gpt-4.1" },
    });
    // point at the fake server via a custom base URL isn't directly settable
    // for "openai" (fixed default base URL), so exercise the same failure
    // path through openai-compatible instead, which does allow it.
    await authed("/api/settings/providers/openai-compatible/config", {
      method: "PUT",
      body: { baseUrl: fake.url, model: "x" },
    });
    await authed("/api/settings/secrets/OPENAI_COMPATIBLE_API_KEY", {
      method: "PUT",
      body: { value: SECRET },
    });
    const testRes = await authed("/api/settings/providers/openai-compatible/test", {
      method: "POST",
    });
    const testText = await testRes.text();
    expect(testText).not.toContain(SECRET);
    expect((JSON.parse(testText) as { ready: boolean }).ready).toBe(false);
  });

  it("a Direct Analyze failure through a misconfigured/invalid-key provider never leaks the key", async () => {
    const fakeServer = await startFakeServer((_req, res) =>
      sendJson(res, 401, { error: "invalid" }),
    );
    fake = fakeServer;
    const wsRes = await authed("/api/workspaces", {
      method: "POST",
      body: { source: { kind: "path", value: dir } },
    });
    const ws = (await wsRes.json()) as { workspace: { id: string } };
    await authed("/api/settings/providers/openai-compatible/config", {
      method: "PUT",
      body: { baseUrl: fakeServer.url, model: "x" },
    });
    await authed("/api/settings/secrets/OPENAI_COMPATIBLE_API_KEY", {
      method: "PUT",
      body: { value: SECRET },
    });
    await authed("/api/settings/providers/active", {
      method: "PUT",
      body: { activeProvider: "openai-compatible", analysisQuality: "fast" },
    });
    const analyzeRes = await authed(`/api/workspaces/${ws.workspace.id}/analyze`, {
      method: "POST",
    });
    const text = await analyzeRes.text();
    expect(text).not.toContain(SECRET);
  });

  it("providers.json on disk never contains the secret value — it belongs only in secrets/.env", async () => {
    await authed("/api/settings/secrets/OPENAI_API_KEY", {
      method: "PUT",
      body: { value: SECRET },
    });
    await authed("/api/settings/providers/openai/config", {
      method: "PUT",
      body: { model: "gpt-4.1" },
    });

    const configPath = providersConfigPath();
    if (existsSync(configPath)) {
      expect(readFileSync(configPath, "utf8")).not.toContain(SECRET);
    }
    const secretsPath = secretsFilePath();
    expect(existsSync(secretsPath)).toBe(true);
    expect(readFileSync(secretsPath, "utf8")).toContain(SECRET); // it MUST be here — that's the file's one job
  });
});

describe("setSecret never logs the value (console is silent)", () => {
  it("no console method is called while setting a secret", async () => {
    const dir = mkdtempSync(join(tmpdir(), "arclume-secleak-nolog-"));
    const dirs = {
      configDir: join(dir, "config"),
      secretsDir: join(dir, "secrets"),
      logsDir: join(dir, "logs"),
    };
    const calls: string[] = [];
    const methods = ["log", "info", "warn", "error", "debug"] as const;
    const originals = methods.map((m) => console[m]);
    for (const m of methods) {
      // biome-ignore lint/suspicious/noExplicitAny: intercepting console for a test spy
      (console as any)[m] = (...args: unknown[]) => {
        calls.push(args.map(String).join(" "));
      };
    }
    try {
      setSecret("OPENAI_API_KEY", SECRET, dirs);
    } finally {
      methods.forEach((m, i) => {
        // biome-ignore lint/suspicious/noExplicitAny: restoring console after the spy
        (console as any)[m] = originals[i];
      });
      rmSync(dir, { recursive: true, force: true });
    }
    for (const call of calls) {
      expect(call).not.toContain(SECRET);
    }
  });
});
