/**
 * Phase 9 CLI — PDF build through the compiled pipeline with real Chromium.
 * Lives in the visual suite so unit tests stay browser-free.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/main.js";
import type { CliIo } from "../../src/cli/output.js";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arclume-cli-pdf-"));
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

describe("cli build --format pdf (real Chromium)", () => {
  it("analyze → build html,pdf,pptx → validate both bundles", async () => {
    const proj = join(dir, "proyecto");
    mkdirSync(proj, { recursive: true });
    writeFileSync(
      join(proj, "README.md"),
      "# Demo\n\nProyecto de demo del CLI.\n\n## Estado\n\n- Listo\n",
    );

    const { io, out, err } = makeIo();
    expect(await runCli(["analyze", proj, "--reasoner", "stub", "--out", "kn.json"], io)).toBe(0);
    expect(await runCli(["build", "kn.json", "--format", "html,pdf,pptx"], io)).toBe(0);
    expect(existsSync(join(dir, "arclume-output", "deck.html"))).toBe(true);
    expect(existsSync(join(dir, "arclume-output", "deck.pdf-export", "deck.pdf"))).toBe(true);
    expect(existsSync(join(dir, "arclume-output", "deck.pptx-export", "deck.pptx"))).toBe(true);

    // receipts are surfaced with exportId
    const printed = out.join("\n");
    expect(printed).toContain("PDF bundle:");
    expect(printed).toContain("PPTX bundle:");
    expect(printed).toContain("exportId");

    // both bundles validate
    expect(await runCli(["validate", join(dir, "arclume-output", "deck.pdf-export")], io)).toBe(0);
    expect(await runCli(["validate", join(dir, "arclume-output", "deck.pptx-export")], io)).toBe(0);

    // stderr carries no stray noise (no stacks, no debug junk)
    expect(err.filter((l) => l.includes("Error"))).toEqual([]);
  }, 180_000);
});
