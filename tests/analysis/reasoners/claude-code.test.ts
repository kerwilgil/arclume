/**
 * Claude Code adapter tests against a FAKE `claude` executable only — never
 * the real, possibly-installed CLI. See tests/helpers/fake-cli.ts for the
 * hermetic-PATH guarantee that makes this safe in CI.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ClaudeCodeReasoner,
  detectClaudeCode,
  testClaudeCodeConnection,
} from "../../../src/analysis/reasoners/claude-code.js";
import { pathWithNoCli, writeFakeCli } from "../../helpers/fake-cli.js";
import {
  invalidAnalysisResultJson,
  sampleAnalysisResult,
  sampleReasonerRequest,
} from "../../helpers/reasoner-fixtures.js";

const ORIGINAL_PATH = process.env["PATH"];

beforeEach(() => {
  process.env["PATH"] = ORIGINAL_PATH;
});

afterEach(() => {
  process.env["PATH"] = ORIGINAL_PATH;
});

function envelope(body: Record<string, unknown>): string {
  return JSON.stringify(body);
}

describe("detectClaudeCode", () => {
  it("reports not-installed when `claude` is nowhere on PATH", async () => {
    process.env["PATH"] = pathWithNoCli();
    const status = await detectClaudeCode();
    expect(status.state).toBe("not-installed");
  });

  it("reports ready with a version string when the fake CLI answers --version", async () => {
    const fake = writeFakeCli("claude", { stdout: "2.1.263 (Claude Code)\n", exitCode: 0 });
    process.env["PATH"] = fake.path;
    const status = await detectClaudeCode();
    expect(status.state).toBe("ready");
    expect(status.version).toContain("2.1.263");
  });
});

describe("testClaudeCodeConnection", () => {
  it("reports ready when the fake CLI answers with is_error: false", async () => {
    const fake = writeFakeCli("claude", { stdout: envelope({ is_error: false, result: "ok" }) });
    process.env["PATH"] = fake.path;
    const status = await testClaudeCodeConnection();
    expect(status.state).toBe("ready");
  });

  it("reports not-authenticated when the fake CLI's error text matches the auth signature", async () => {
    const fake = writeFakeCli("claude", {
      stdout: envelope({ is_error: true, result: "Please sign in to continue using Claude Code." }),
    });
    process.env["PATH"] = fake.path;
    const status = await testClaudeCodeConnection();
    expect(status.state).toBe("not-authenticated");
  });

  it("reports a generic error for an unrelated failure", async () => {
    const fake = writeFakeCli("claude", {
      stdout: envelope({ is_error: true, result: "internal server error" }),
    });
    process.env["PATH"] = fake.path;
    const status = await testClaudeCodeConnection();
    expect(status.state).toBe("error");
  });

  it("reports not-installed when `claude` is nowhere on PATH", async () => {
    process.env["PATH"] = pathWithNoCli();
    const status = await testClaudeCodeConnection();
    expect(status.state).toBe("not-installed");
  });
});

describe("ClaudeCodeReasoner", () => {
  it("returns a validated AnalysisResult on a successful, authenticated run", async () => {
    const analysis = sampleAnalysisResult();
    const fake = writeFakeCli("claude", {
      stdout: envelope({ is_error: false, result: JSON.stringify(analysis) }),
    });
    process.env["PATH"] = fake.path;
    const reasoner = new ClaudeCodeReasoner();
    const result = await reasoner.analyze(sampleReasonerRequest());
    expect(result.analysis).toEqual(analysis);
    expect(result.reasoner).toEqual({ id: "claude-code", version: "0.1.0" });
  });

  it("maps a schema-invalid result to reasoner/malformed-output", async () => {
    const fake = writeFakeCli("claude", {
      stdout: envelope({ is_error: false, result: invalidAnalysisResultJson() }),
    });
    process.env["PATH"] = fake.path;
    const reasoner = new ClaudeCodeReasoner();
    await expect(reasoner.analyze(sampleReasonerRequest())).rejects.toMatchObject({
      code: "reasoner/malformed-output",
    });
  });

  it("maps unparseable stdout to reasoner/provider-malformed-response", async () => {
    const fake = writeFakeCli("claude", { stdout: "not json at all" });
    process.env["PATH"] = fake.path;
    const reasoner = new ClaudeCodeReasoner();
    await expect(reasoner.analyze(sampleReasonerRequest())).rejects.toMatchObject({
      code: "reasoner/provider-malformed-response",
    });
  });

  it("maps an authentication-shaped failure to reasoner/provider-auth-failed", async () => {
    const fake = writeFakeCli("claude", {
      stdout: envelope({ is_error: true, result: "You are not logged in. Run `claude login`." }),
    });
    process.env["PATH"] = fake.path;
    const reasoner = new ClaudeCodeReasoner();
    await expect(reasoner.analyze(sampleReasonerRequest())).rejects.toMatchObject({
      code: "reasoner/provider-auth-failed",
    });
  });

  it("maps an unrelated failure to reasoner/provider-http-error", async () => {
    const fake = writeFakeCli("claude", {
      stdout: envelope({ is_error: true, result: "internal error" }),
    });
    process.env["PATH"] = fake.path;
    const reasoner = new ClaudeCodeReasoner();
    await expect(reasoner.analyze(sampleReasonerRequest())).rejects.toMatchObject({
      code: "reasoner/provider-http-error",
    });
  });

  it("maps a missing CLI to reasoner/provider-not-installed", async () => {
    process.env["PATH"] = pathWithNoCli();
    const reasoner = new ClaudeCodeReasoner();
    await expect(reasoner.analyze(sampleReasonerRequest())).rejects.toMatchObject({
      code: "reasoner/provider-not-installed",
    });
  });

  it("maps a hung CLI to reasoner/provider-timeout and never leaves it running", async () => {
    const fake = writeFakeCli("claude", {
      delayMs: 5000,
      stdout: envelope({ is_error: false, result: "ok" }),
    });
    process.env["PATH"] = fake.path;
    const reasoner = new ClaudeCodeReasoner({ timeoutMs: 300 });
    await expect(reasoner.analyze(sampleReasonerRequest())).rejects.toMatchObject({
      code: "reasoner/provider-timeout",
    });
  }, 10_000);
});
