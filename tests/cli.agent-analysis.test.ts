/**
 * Phase 9 final closure — the productive agent workflow:
 *   analyze --prepare-analysis → agent produces AnalysisResult →
 *   analyze --analysis-result (digest-bound) → ProjectKnowledge.
 * Stub mode stays explicit. Plain `analyze` without a mode is refused.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AnalysisResult } from "../src/analysis/analysis-result.js";
import { StubReasoner } from "../src/analysis/reasoners/stub.js";
import { runCli } from "../src/cli/main.js";
import type { CliIo } from "../src/cli/output.js";
import { analyzePrepared, prepareAnalysis } from "../src/pipeline/run.js";
import { buildTextPdf } from "./helpers/fixture-builders.js";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arclume-agent-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeIo(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (s) => out.push(s), stderr: (s) => err.push(s), cwd: () => dir },
    out,
    err,
  };
}

function makeProject(): string {
  const proj = join(dir, "proj");
  mkdirSync(proj, { recursive: true });
  writeFileSync(
    join(proj, "README.md"),
    "# Report Project\n\nA demo project.\n\n## Status\n\n- Stable\n",
  );
  return proj;
}

async function produceAnalysisFor(projPath: string): Promise<{
  digest: string;
  analysis: AnalysisResult;
}> {
  const prepared = await prepareAnalysis([{ kind: "path", path: projPath }]);
  const analyzed = await analyzePrepared(prepared, new StubReasoner());
  return { digest: prepared.sourceDigest, analysis: analyzed.analysis };
}

describe("agent analyze workflow", () => {
  it("plain analyze without an explicit mode is a usage error (never silent stub)", async () => {
    const proj = makeProject();
    const { io, err } = makeIo();
    const code = await runCli(["analyze", proj, "--out", "kn.json"], io);
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("prepare-analysis");
    expect(err.join("\n")).toContain("--reasoner stub");
    expect(existsSync(join(dir, "kn.json"))).toBe(false);
  });

  it("--reasoner stub is explicit, deterministic and labeled", async () => {
    const proj = makeProject();
    const { io, out, err } = makeIo();
    const a = await runCli(
      ["analyze", proj, "--reasoner", "stub", "--out", "kn.json", "--json"],
      io,
    );
    expect(a).toBe(0);
    const payload = JSON.parse(out[0] as string) as {
      mode: string;
      reasonerId: string;
      sourceDigest: string;
      knowledgeHash: string;
    };
    expect(payload.mode).toBe("stub");
    expect(payload.reasonerId).toBe("stub");
    expect(payload.knowledgeHash).toMatch(/^sha256:/);
    expect(err.some((l) => l.includes("analysis/stub-reasoner"))).toBe(true);

    // determinism: same input → same knowledge
    rmSync(join(dir, "kn.json"));
    const { io: io2, out: out2 } = makeIo();
    await runCli(["analyze", proj, "--reasoner", "stub", "--out", "kn2.json", "--json"], io2);
    const payload2 = JSON.parse(out2[0] as string) as { knowledgeHash: string };
    expect(payload2.knowledgeHash).toBe(payload.knowledgeHash);
  });

  it("prepare → consume: agent envelope with matching digest produces ProjectKnowledge", async () => {
    const proj = makeProject();
    const { io, out } = makeIo();
    expect(await runCli(["analyze", proj, "--prepare-analysis", "request.json"], io)).toBe(0);
    const request = JSON.parse(readFileSync(join(dir, "request.json"), "utf8")) as {
      artifact: string;
      version: string;
      sourceDigest: string;
      request: { documents: Array<{ id: string }> };
    };
    expect(request.artifact).toBe("arclume/analysis-request");
    expect(request.request.documents.length).toBeGreaterThan(0);

    // the "agent" produces a result bound to this request
    const { digest, analysis } = await produceAnalysisFor(proj);
    expect(digest).toBe(request.sourceDigest);
    const envelope = {
      artifact: "arclume/agent-analysis",
      version: "0.1.0",
      sourceDigest: digest,
      analysis,
    };
    writeFileSync(join(dir, "result.json"), JSON.stringify(envelope));

    const { io: io2, out: out2 } = makeIo();
    const code = await runCli(
      ["analyze", proj, "--analysis-result", "result.json", "--out", "kn.json", "--json"],
      io2,
    );
    expect(code).toBe(0);
    const payload = JSON.parse(out2[0] as string) as { mode: string; reasonerId: string };
    expect(payload.mode).toBe("agent");
    expect(payload.reasonerId).toBe("agent");

    const kn = JSON.parse(readFileSync(join(dir, "kn.json"), "utf8")) as {
      knowledgeVersion: string;
      project: { id: string };
    };
    expect(kn.knowledgeVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(typeof kn.project.id).toBe("string");
  });

  it("stale envelope: source changed after prepare → source-digest-mismatch, no output", async () => {
    const proj = makeProject();
    const { digest, analysis } = await produceAnalysisFor(proj);
    writeFileSync(
      join(dir, "result.json"),
      JSON.stringify({
        artifact: "arclume/agent-analysis",
        version: "0.1.0",
        sourceDigest: digest,
        analysis,
      }),
    );
    // input drifts after the request was prepared
    writeFileSync(join(proj, "README.md"), "# Report Project\n\nCHANGED content now.\n");

    const { io, err } = makeIo();
    const code = await runCli(
      ["analyze", proj, "--analysis-result", "result.json", "--out", "kn.json", "--json"],
      io,
    );
    expect(code).toBe(2);
    expect(err.length === 0 || typeof err[0] === "string").toBe(true);
    expect(existsSync(join(dir, "kn.json"))).toBe(false);
    const { io: io3, out: out3 } = makeIo();
    const code2 = await runCli(
      ["analyze", proj, "--analysis-result", "result.json", "--out", "kn.json", "--json"],
      io3,
    );
    expect(code2).toBe(2);
    const payload = JSON.parse(out3[0] as string) as { ok: boolean; code: string };
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe("reasoner/source-digest-mismatch");
  });

  it("PDF input through the full prepare→agent→knowledge flow keeps Phase 8 provenance", async () => {
    writeFileSync(
      join(dir, "report.pdf"),
      buildTextPdf([["Quarterly report", "Revenue grew by 12 percent"]]),
    );
    const { io, out } = makeIo();
    expect(
      await runCli(["analyze", join(dir, "report.pdf"), "--prepare-analysis", "request.json"], io),
    ).toBe(0);
    const request = JSON.parse(readFileSync(join(dir, "request.json"), "utf8")) as {
      sourceDigest: string;
      request: {
        documents: Array<{ id: string; kind: string; outline: { kind: string; pages?: number } }>;
      };
    };
    // Phase 8 provenance: the request carries the PDF document with pdf outline
    const pdfDoc = request.request.documents.find((d) => d.kind === "pdf");
    expect(pdfDoc).toBeDefined();
    expect(pdfDoc?.outline.kind).toBe("pdf");
    expect(pdfDoc?.outline.pages).toBe(1);

    const { digest, analysis } = await produceAnalysisFor(join(dir, "report.pdf"));
    expect(digest).toBe(request.sourceDigest);
    writeFileSync(
      join(dir, "result.json"),
      JSON.stringify({
        artifact: "arclume/agent-analysis",
        version: "0.1.0",
        sourceDigest: digest,
        analysis,
      }),
    );
    const { io: io2 } = makeIo();
    const code = await runCli(
      ["analyze", join(dir, "report.pdf"), "--analysis-result", "result.json", "--out", "kn.json"],
      io2,
    );
    expect(code).toBe(0);
    const kn = JSON.parse(readFileSync(join(dir, "kn.json"), "utf8")) as {
      sources: Array<{ kind: string }>;
    };
    expect(kn.sources.some((s) => s.kind === "pdf")).toBe(true);
  });
});
