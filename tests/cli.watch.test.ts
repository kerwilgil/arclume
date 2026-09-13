/**
 * Phase 9 watch: debounce coalescing, output-dir self-trigger immunity,
 * ignore rules, last-known-good on failure, clean stop.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli/main.js";
import type { CliIo } from "../src/cli/output.js";
import { isIgnoredWatchEvent, runWatchCommand } from "../src/cli/watch.js";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arclume-watch-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeIo(): { io: CliIo; err: string[] } {
  const err: string[] = [];
  return { io: { stdout: () => undefined, stderr: (s) => err.push(s), cwd: () => dir }, err };
}

async function waitFor(pred: () => boolean, timeoutMs = 20_000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("watch ignore rules", () => {
  it("ignores the output dir, node_modules, .git and staging paths", () => {
    const root = join(dir, "root");
    const out = join(root, "arclume-output");
    expect(isIgnoredWatchEvent("arclume-output/deck.html", out, root)).toBe(true);
    expect(isIgnoredWatchEvent("arclume-output", out, root)).toBe(true);
    expect(isIgnoredWatchEvent("node_modules/x/index.js", out, root)).toBe(true);
    expect(isIgnoredWatchEvent(".git/config", out, root)).toBe(true);
    expect(isIgnoredWatchEvent(".name.staging-123/file", out, root)).toBe(true);
    expect(isIgnoredWatchEvent("README.md", out, root)).toBe(false);
    expect(isIgnoredWatchEvent("docs/a.md", out, root)).toBe(false);
  });

  it("refuses URLs", async () => {
    const { io } = makeIo();
    const code = await runCli(["watch", "https://example.com"], io);
    expect(code).toBe(1);
  });

  it("refuses a missing root", async () => {
    const { io } = makeIo();
    const code = await runCli(["watch", "does-not-exist"], io);
    expect(code).toBe(1);
  });

  it("WITHOUT --reasoner stub watch refuses to arm (usage error)", async () => {
    const root = join(dir, "proj");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "README.md"), "# x\n");
    const { io, err } = makeIo();
    const code = await runCli(["watch", root], io);
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("--reasoner stub");
  });

  it("--reasoner with any other value is refused", async () => {
    const root = join(dir, "proj");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "README.md"), "# x\n");
    const { io, err } = makeIo();
    const code = await runCli(["watch", root, "--reasoner", "agent"], io);
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("offline heuristic");
  });

  it("explicit stub arms AND prints the stub warning exactly once", async () => {
    const root = join(dir, "proj");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "README.md"), "# x\n");
    const { io, err } = makeIo();
    const pending = runCli(["watch", root, "--reasoner", "stub"], io);
    await waitFor(() => err.some((l) => l.includes("listening")));
    const warnings = err.filter((l) => l.includes("analysis/stub-reasoner"));
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("not agent-grade reasoning");
    process.emit("SIGINT");
    expect(await pending).toBe(0);
  }, 20_000);

  it("refuses out == watched root", async () => {
    const root = join(dir, "proj");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "README.md"), "# x\n");
    const { io } = makeIo();
    const code = await runCli(["watch", root, "--out", root], io);
    expect(code).toBe(1);
  });

  it("refuses an output dir that is an ANCESTOR of the root", async () => {
    const root = join(dir, "proj");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "README.md"), "# x\n");
    const { io } = makeIo();
    // out = dir, root = dir/proj → every rebuild event is a source event
    const code = await runCli(["watch", root, "--out", dir], io);
    expect(code).toBe(1);
  });

  it("allows a nested output dir (still ignored by events)", async () => {
    const root = join(dir, "proj");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "README.md"), "# x\n");
    const nestedOut = join(root, "arclume-output");
    const { io } = makeIo();
    // arm then stop immediately with SIGINT
    const pending = runCli(["watch", root, "--out", nestedOut, "--reasoner", "stub"], io);
    await new Promise((r) => setTimeout(r, 500));
    process.emit("SIGINT");
    expect(await pending).toBe(0);
  }, 20_000);
});

describe("watch loop", () => {
  it("debounces a burst into ONE rebuild and ignores output-dir changes", async () => {
    const root = join(dir, "proj");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "README.md"), "# W\n\ninitial\n");
    const out = join(dir, "out");

    const rebuilds: boolean[] = [];
    let armed = false;
    const { io, err } = makeIo();
    const pending = runWatchCommand(
      [root, "--out", out, "--preset", "general", "--reasoner", "stub", "--debounce-ms", "120"],
      io,
      {
        onArmed: () => {
          armed = true;
        },
        onRebuilt: (ok) => rebuilds.push(ok),
      },
    );

    // armed → watcher is live
    await waitFor(() => err.some((l) => l.includes("listening")));
    expect(armed).toBe(true);

    // a burst of five quick file changes → exactly ONE rebuild
    for (let i = 0; i < 5; i += 1) {
      writeFileSync(join(root, `note-${i}.md`), `# Note ${i}\n`);
      await new Promise((r) => setTimeout(r, 15));
    }
    await waitFor(() => rebuilds.length === 1);
    expect(rebuilds).toEqual([true]);
    expect(existsSync(join(out, "deck.html"))).toBe(true);

    // self-trigger immunity: writing under the OUTPUT dir must not rebuild
    const before = rebuilds.length;
    writeFileSync(join(out, "poke.txt"), "x");
    writeFileSync(join(out, "deck.html"), "modified externally");
    await new Promise((r) => setTimeout(r, 700));
    expect(rebuilds.length).toBe(before);
    // the externally-modified html is untouched by the watcher
    const html = readFileSyncSafe(join(out, "deck.html"));
    expect(html).toBe("modified externally");

    // a real change rebuilds over the modified output (replace-on-success)
    writeFileSync(join(root, "README.md"), "# W\n\nchanged content\n");
    await waitFor(() => rebuilds.length === 2);
    expect(rebuilds[1]).toBe(true);

    process.emit("SIGINT");
    const code = await pending;
    expect(code).toBe(0);
  }, 60_000);
});

import { readFileSync } from "node:fs";
function readFileSyncSafe(p: string): string {
  return readFileSync(p, "utf8");
}
