/**
 * Phase 9 CLI — in-process command tests (runCli with an in-memory io).
 * Subprocess coverage (bin / dist / exit codes over the wire) lives in
 * tests/cli.subprocess.test.ts; Chromium-dependent export coverage lives in
 * tests/visual/.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliDeps, runCli } from "../src/cli/main.js";
import type { UrlTransport } from "../src/ingestion/url-transport.js";
import { buildDocx, buildTextPdf } from "./helpers/fixture-builders.js";

interface Captured {
  out: string[];
  err: string[];
  cwd: string;
}

function makeIo(cwd: string): { io: import("../src/cli/output.js").CliIo; captured: Captured } {
  const captured: Captured = { out: [], err: [], cwd };
  return {
    captured,
    io: {
      stdout: (s) => captured.out.push(s),
      stderr: (s) => captured.err.push(s),
      cwd: () => captured.cwd,
    },
  };
}

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arclume-cli-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const SAMPLE_MD = "# Smoke Project\n\nA sample project for CLI tests.\n\n## Status\n\n- Ready\n";

function makeProject(): string {
  const p = join(dir, "proj único"); // unicode + space path components
  mkdirSync(join(p, "docs"), { recursive: true });
  writeFileSync(join(p, "README.md"), SAMPLE_MD);
  writeFileSync(join(p, "docs", "notes.md"), "## Details\n\nMore detail here.\n");
  return p;
}

describe("cli: help/version/presets", () => {
  it("--help prints usage and exits 0", async () => {
    const { io, captured } = makeIo(dir);
    const code = await runCli(["--help"], io);
    expect(code).toBe(0);
    expect(captured.out.join("\n")).toContain("arclume analyze");
    expect(captured.out.join("\n")).toContain("--format html,pdf,pptx");
  });

  it("--version reads the package version (no hardcoded copy)", async () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      version: string;
    };
    const { io, captured } = makeIo(dir);
    const code = await runCli(["--version"], io);
    expect(code).toBe(0);
    expect(captured.out).toEqual([pkg.version]);
  });

  it("presets lists the three presets with explicit mappings", async () => {
    const { io, captured } = makeIo(dir);
    const code = await runCli(["presets"], io);
    expect(code).toBe(0);
    const text = captured.out.join("\n");
    expect(text).toContain("executive");
    expect(text).toContain("technical");
    expect(text).toContain("general");
  });

  it("presets --json is pure machine-readable stdout", async () => {
    const { io, captured } = makeIo(dir);
    const code = await runCli(["presets", "--json"], io);
    expect(code).toBe(0);
    expect(captured.err).toEqual([]);
    const payload = JSON.parse(captured.out[0] as string) as {
      ok: boolean;
      presets: Array<{ id: string; audience: string; theme: string }>;
    };
    expect(payload.ok).toBe(true);
    expect(payload.presets.map((p) => p.id)).toEqual(["executive", "technical", "general"]);
    expect(payload.presets.find((p) => p.id === "executive")).toMatchObject({
      audience: "executive",
      theme: "executive",
    });
  });

  it("unknown command exits 1 with a hint", async () => {
    const { io, captured } = makeIo(dir);
    const code = await runCli(["frobnicate"], io);
    expect(code).toBe(1);
    expect(captured.err.join("\n")).toContain('unknown command "frobnicate"');
  });
});

describe("cli: analyze", () => {
  it("analyzes a directory (unicode+space path) to ProjectKnowledge", async () => {
    const proj = makeProject();
    const { io, captured } = makeIo(dir);
    const code = await runCli(["analyze", proj, "--reasoner", "stub", "--out", "kn.json"], io);
    expect(code).toBe(0);
    const kn = join(dir, "kn.json");
    expect(existsSync(kn)).toBe(true);
    const knowledge = JSON.parse(readFileSync(kn, "utf8")) as { knowledgeVersion: string };
    expect(knowledge.knowledgeVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("refuses to overwrite an existing knowledge output (exit 1)", async () => {
    const proj = makeProject();
    writeFileSync(join(dir, "kn.json"), "existing");
    const { io, captured } = makeIo(dir);
    const code = await runCli(["analyze", proj, "--reasoner", "stub", "--out", "kn.json"], io);
    expect(code).toBe(1);
    expect(captured.err.join("\n")).toContain("already exists");
    expect(readFileSync(join(dir, "kn.json"), "utf8")).toBe("existing");
  });

  it("missing input is a usage error (exit 1)", async () => {
    const { io, captured } = makeIo(dir);
    const code = await runCli(["analyze", "does-not-exist-anywhere", "--reasoner", "stub"], io);
    expect(code).toBe(1);
    expect(captured.err.join("\n")).toContain("does not exist");
  });

  it("analyzes a PDF file input", async () => {
    const pdfPath = join(dir, "report.pdf");
    writeFileSync(pdfPath, buildTextPdf([["Quarterly results", "Revenue grew 12%"]]));
    const { io } = makeIo(dir);
    const code = await runCli(["analyze", pdfPath, "--reasoner", "stub", "--out", "kn.json"], io);
    expect(code).toBe(0);
    expect(existsSync(join(dir, "kn.json"))).toBe(true);
  });

  it("analyzes a DOCX file input", async () => {
    const docxPath = join(dir, "brief.docx");
    writeFileSync(docxPath, buildDocx([{ text: "Top findings" }, { text: "A detail" }]));
    const { io } = makeIo(dir);
    const code = await runCli(["analyze", docxPath, "--reasoner", "stub", "--out", "kn.json"], io);
    expect(code).toBe(0);
    expect(existsSync(join(dir, "kn.json"))).toBe(true);
  });

  it("analyzes a URL through the Phase 8 transport (deterministic injected fake)", async () => {
    const fake: UrlTransport = {
      async resolve(host) {
        expect(host).toBe("example.com");
        return ["93.184.216.34"]; // public placeholder address
      },
      async request({ url }) {
        expect(url.hostname).toBe("example.com");
        const html =
          "<!doctype html><html><body><h1>Example Product</h1><p>Growth moved 10%.</p></body></html>";
        async function* body(): AsyncIterable<Uint8Array> {
          yield new TextEncoder().encode(html);
        }
        return {
          status: 200,
          headers: { "content-type": "text/html" },
          body: body(),
        };
      },
    };
    const deps: CliDeps = { urlTransport: fake };
    const { io, captured } = makeIo(dir);
    const code = await runCli(
      ["analyze", "https://example.com/page", "--reasoner", "stub", "--out", "kn.json"],
      io,
      deps,
    );
    expect(code).toBe(0);
    expect(captured.out.join("\n")).toContain("kn.json");
    const knowledge = JSON.parse(readFileSync(join(dir, "kn.json"), "utf8")) as {
      sources: Array<{ kind: string }>;
    };
    expect(knowledge.sources.some((s) => s.kind === "url")).toBe(true);
  });

  it("analyze --json: stdout is one pure JSON object, issues are structured", async () => {
    const pdfPath = join(dir, "empty.pdf");
    writeFileSync(pdfPath, buildTextPdf([[]])); // pages without text → pdf-no-text gap
    const { io, captured } = makeIo(dir);
    const code = await runCli(
      ["analyze", pdfPath, "--reasoner", "stub", "--out", "kn.json", "--json"],
      io,
    );
    expect(code).toBe(0);
    expect(captured.out.length).toBe(1);
    const payload = JSON.parse(captured.out[0] as string) as {
      ok: boolean;
      command: string;
      issues: Array<{ code: string }>;
    };
    expect(payload.ok).toBe(true);
    expect(payload.command).toBe("analyze");
    expect(payload.issues.some((i) => i.code === "ingestion/pdf-no-text")).toBe(true);
  });
});

describe("cli: build", () => {
  async function prepareKnowledge(): Promise<string> {
    const proj = makeProject();
    const { io } = makeIo(dir);
    await runCli(["analyze", proj, "--reasoner", "stub", "--out", "kn.json"], io);
    return join(dir, "kn.json");
  }

  it("builds HTML (default format) into arclume-output", async () => {
    const kn = await prepareKnowledge();
    const { io, captured } = makeIo(dir);
    const code = await runCli(["build", kn], io);
    expect(code).toBe(0);
    expect(captured.out.join("\n")).toContain("deck.html");
    const html = readFileSync(join(dir, "arclume-output", "deck.html"), "utf8");
    expect(html).toContain("arclume");
  });

  it("builds PPTX as an export bundle with receipt (no Chromium needed)", async () => {
    const kn = await prepareKnowledge();
    const { io, captured } = makeIo(dir);
    const code = await runCli(["build", kn, "--format", "pptx", "--preset", "technical"], io);
    expect(code).toBe(0);
    const text = captured.out.join("\n");
    expect(text).toContain("PPTX bundle:");
    expect(text).toContain("exportId");
    const bundle = join(dir, "arclume-output", "deck.pptx-export");
    expect(existsSync(join(bundle, "deck.pptx"))).toBe(true);
    expect(existsSync(join(bundle, "export-receipt.json"))).toBe(true);
  });

  it("--format html,pptx builds both in one run", async () => {
    const kn = await prepareKnowledge();
    const { io } = makeIo(dir);
    const code = await runCli(["build", kn, "--format", "html,pptx"], io);
    expect(code).toBe(0);
    expect(existsSync(join(dir, "arclume-output", "deck.html"))).toBe(true);
    expect(existsSync(join(dir, "arclume-output", "deck.pptx-export", "deck.pptx"))).toBe(true);
  });

  it("existing pptx bundle destination is a usage error (exit 1)", async () => {
    const kn = await prepareKnowledge();
    const { io } = makeIo(dir);
    expect(await runCli(["build", kn, "--format", "pptx"], io)).toBe(0);
    const code = await runCli(["build", kn, "--format", "pptx"], io);
    expect(code).toBe(1);
  });

  it("unknown audience / preset / format are usage errors (exit 1)", async () => {
    const kn = await prepareKnowledge();
    for (const args of [
      ["build", kn, "--audience", "board"],
      ["build", kn, "--preset", "investor"],
      ["build", kn, "--format", "png"],
    ]) {
      const { io } = makeIo(dir);
      const code = await runCli(args, io);
      expect(code).toBe(1);
    }
  });

  it("build --json returns absolute output paths", async () => {
    const kn = await prepareKnowledge();
    const { io, captured } = makeIo(dir);
    const code = await runCli(["build", kn, "--json"], io);
    expect(code).toBe(0);
    const payload = JSON.parse(captured.out[0] as string) as {
      ok: boolean;
      html?: string;
      outputDir: string;
    };
    expect(payload.ok).toBe(true);
    expect(payload.outputDir).toMatch(/^[A-Za-z]:[\\/]|^\//); // absolute
    expect(payload.html ?? "").toContain("deck.html");
  });
});

describe("cli: validate", () => {
  it("validates a built PPTX export bundle", async () => {
    const proj = makeProject();
    const { io } = makeIo(dir);
    await runCli(["analyze", proj, "--reasoner", "stub", "--out", "kn.json"], io);
    await runCli(["build", join(dir, "kn.json"), "--format", "pptx"], io);
    const code = await runCli(["validate", join(dir, "arclume-output", "deck.pptx-export")], io);
    expect(code).toBe(0);
  });

  it("a tampered artifact (bytes replaced) fails validation with exit 2", async () => {
    const proj = makeProject();
    const { io } = makeIo(dir);
    await runCli(["analyze", proj, "--reasoner", "stub", "--out", "kn.json"], io);
    await runCli(["build", join(dir, "kn.json"), "--format", "pptx"], io);
    const bundle = join(dir, "arclume-output", "deck.pptx-export");
    writeFileSync(join(bundle, "deck.pptx"), Buffer.from([1, 2, 3, 4, 5]));
    const code = await runCli(["validate", bundle], io);
    expect(code).toBe(2);
  });

  it("rejects a bare .pptx without its receipt (usage error)", async () => {
    const proj = makeProject();
    const { io } = makeIo(dir);
    await runCli(["analyze", proj, "--reasoner", "stub", "--out", "kn.json"], io);
    await runCli(["build", join(dir, "kn.json"), "--format", "pptx"], io);
    const code = await runCli(
      ["validate", join(dir, "arclume-output", "deck.pptx-export", "deck.pptx")],
      io,
    );
    expect(code).toBe(1);
  });

  it("validates a knowledge JSON file", async () => {
    const proj = makeProject();
    const { io } = makeIo(dir);
    await runCli(["analyze", proj, "--reasoner", "stub", "--out", "kn.json"], io);
    expect(await runCli(["validate", join(dir, "kn.json")], io)).toBe(0);
    writeFileSync(join(dir, "kn.json"), '{"nope": true}');
    expect(await runCli(["validate", join(dir, "kn.json")], io)).toBe(2);
  });
});
