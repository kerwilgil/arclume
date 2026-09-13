/**
 * Codex adapter tests against a FAKE `codex` executable only — never the
 * real, possibly-installed CLI. See tests/helpers/fake-cli.ts for the
 * hermetic-PATH guarantee that makes this safe in CI.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CodexReasoner,
  detectCodex,
  testCodexConnection,
} from "../../../src/analysis/reasoners/codex.js";
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

function jsonLine(event: Record<string, unknown>): string {
  return `${JSON.stringify(event)}\n`;
}

describe("detectCodex", () => {
  it("reports not-installed when `codex` is nowhere on PATH", async () => {
    process.env["PATH"] = pathWithNoCli();
    const status = await detectCodex();
    expect(status.state).toBe("not-installed");
  });

  it("reports ready with a version string when the fake CLI answers --version", async () => {
    const fake = writeFakeCli("codex", { stdout: "codex-cli 0.153.3\n", exitCode: 0 });
    process.env["PATH"] = fake.path;
    const status = await detectCodex();
    expect(status.state).toBe("ready");
    expect(status.version).toContain("0.153.3");
  });
});

describe("testCodexConnection", () => {
  it("reports ready when the fake CLI exits 0 and writes the output file", async () => {
    const fake = writeFakeCli("codex", { outFileContent: "ok", exitCode: 0 });
    process.env["PATH"] = fake.path;
    const status = await testCodexConnection();
    expect(status.state).toBe("ready");
  });

  it("reports not-authenticated when a `type: error` event matches the auth signature", async () => {
    const fake = writeFakeCli("codex", {
      stdout: jsonLine({
        type: "error",
        message: "You are not logged in with your ChatGPT account.",
      }),
      exitCode: 1,
    });
    process.env["PATH"] = fake.path;
    const status = await testCodexConnection();
    expect(status.state).toBe("not-authenticated");
  });

  it("reports a generic error for an unrelated `turn.failed` event", async () => {
    const fake = writeFakeCli("codex", {
      stdout: jsonLine({ type: "turn.failed", error: { message: "internal failure" } }),
      exitCode: 1,
    });
    process.env["PATH"] = fake.path;
    const status = await testCodexConnection();
    expect(status.state).toBe("error");
  });

  it("reports not-installed when `codex` is nowhere on PATH", async () => {
    process.env["PATH"] = pathWithNoCli();
    const status = await testCodexConnection();
    expect(status.state).toBe("not-installed");
  });
});

describe("CodexReasoner", () => {
  it("returns a validated AnalysisResult from the -o output file on success", async () => {
    const analysis = sampleAnalysisResult();
    const fake = writeFakeCli("codex", { outFileContent: JSON.stringify(analysis), exitCode: 0 });
    process.env["PATH"] = fake.path;
    const reasoner = new CodexReasoner();
    const result = await reasoner.analyze(sampleReasonerRequest());
    expect(result.analysis).toEqual(analysis);
    expect(result.reasoner).toEqual({ id: "codex", version: "0.1.0" });
  });

  it("maps a schema-invalid result to reasoner/malformed-output", async () => {
    const fake = writeFakeCli("codex", {
      outFileContent: invalidAnalysisResultJson(),
      exitCode: 0,
    });
    process.env["PATH"] = fake.path;
    const reasoner = new CodexReasoner();
    await expect(reasoner.analyze(sampleReasonerRequest())).rejects.toMatchObject({
      code: "reasoner/malformed-output",
    });
  });

  it("maps a successful exit with no output file to reasoner/provider-http-error", async () => {
    const fake = writeFakeCli("codex", { exitCode: 0 }); // no -o file written
    process.env["PATH"] = fake.path;
    const reasoner = new CodexReasoner();
    await expect(reasoner.analyze(sampleReasonerRequest())).rejects.toMatchObject({
      code: "reasoner/provider-http-error",
    });
  });

  it("maps an authentication-shaped failure event to reasoner/provider-auth-failed", async () => {
    const fake = writeFakeCli("codex", {
      stdout: jsonLine({
        type: "error",
        message: "Please sign in with your ChatGPT account to continue.",
      }),
      exitCode: 1,
    });
    process.env["PATH"] = fake.path;
    const reasoner = new CodexReasoner();
    await expect(reasoner.analyze(sampleReasonerRequest())).rejects.toMatchObject({
      code: "reasoner/provider-auth-failed",
    });
  });

  it("maps an unrelated failure event to reasoner/provider-http-error", async () => {
    const fake = writeFakeCli("codex", {
      stdout: jsonLine({ type: "turn.failed", error: { message: "usage limit reached" } }),
      exitCode: 1,
    });
    process.env["PATH"] = fake.path;
    const reasoner = new CodexReasoner();
    await expect(reasoner.analyze(sampleReasonerRequest())).rejects.toMatchObject({
      code: "reasoner/provider-http-error",
    });
  });

  it("maps a missing CLI to reasoner/provider-not-installed", async () => {
    process.env["PATH"] = pathWithNoCli();
    const reasoner = new CodexReasoner();
    await expect(reasoner.analyze(sampleReasonerRequest())).rejects.toMatchObject({
      code: "reasoner/provider-not-installed",
    });
  });

  it("maps a hung CLI to reasoner/provider-timeout and never leaves it running", async () => {
    const fake = writeFakeCli("codex", { delayMs: 5000, outFileContent: "ok", exitCode: 0 });
    process.env["PATH"] = fake.path;
    const reasoner = new CodexReasoner({ timeoutMs: 300 });
    await expect(reasoner.analyze(sampleReasonerRequest())).rejects.toMatchObject({
      code: "reasoner/provider-timeout",
    });
  }, 10_000);
});
