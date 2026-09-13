import { afterEach, describe, expect, it } from "vitest";
import { DiscoveryError, discover } from "../src/index.js";
import { makeEmptyDir, makeTmpRepo, sampleRepoPath } from "./helpers/tmp-repo.js";

describe("discover — the sample repo", () => {
  it("classifies files and honours the fixture .gitignore", () => {
    const result = discover(sampleRepoPath());

    expect(result.source.kind).toBe("directory");
    const included = result.files.filter((f) => f.included).map((f) => f.path);
    expect(included).toEqual([
      "README.md",
      "config/default.yaml",
      "config/limits.json",
      "docs/architecture.md",
      "docs/notes.txt",
      "package.json",
      "tsconfig.json",
    ]);

    const skipped = new Map(result.skipped.map((s) => [s.path, s.reason]));
    expect(skipped.get("notes.local.md")).toBe("ignored");
    expect(skipped.get("src/index.ts")).toBe("unsupported");
    expect(skipped.get(".gitignore")).toBe("unsupported");

    // unsupported source files still appear in the inventory for structural reasoning
    const tsFiles = result.files.filter((f) => f.path.endsWith(".ts"));
    expect(tsFiles.length).toBe(4);
    expect(tsFiles.every((f) => !f.included && f.kind === "unsupported")).toBe(true);
  });

  it("produces POSIX-style, root-relative paths", () => {
    const result = discover(sampleRepoPath());
    for (const f of result.files) {
      expect(f.path).not.toContain("\\");
      expect(f.path.startsWith("/")).toBe(false);
    }
  });

  it("is deterministic and independent of a path with .. segments", () => {
    const a = discover(sampleRepoPath());
    const b = discover(`${sampleRepoPath()}/../sample-repo`);
    expect(JSON.stringify(a.files)).toBe(JSON.stringify(b.files));
    expect(JSON.stringify(a.skipped)).toBe(JSON.stringify(b.skipped));
  });

  it("can ignore the .gitignore when asked", () => {
    const withGI = discover(sampleRepoPath());
    const withoutGI = discover(sampleRepoPath(), { respectGitignore: false });
    expect(withGI.skipped.some((s) => s.path === "notes.local.md" && s.reason === "ignored")).toBe(
      true,
    );
    expect(withoutGI.files.some((f) => f.path === "notes.local.md" && f.included)).toBe(true);
  });
});

describe("discover — edges", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const c of cleanups.splice(0)) c();
  });

  it("throws a fatal DiscoveryError for a missing root", () => {
    try {
      discover("this/path/does/not/exist");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(DiscoveryError);
      expect((err as DiscoveryError).code).toBe("discovery/root-not-found");
      expect((err as DiscoveryError).severity).toBe("fatal");
    }
  });

  it("returns an empty result for an empty directory", () => {
    const { dir, cleanup } = makeEmptyDir();
    cleanups.push(cleanup);
    const result = discover(dir);
    expect(result.files).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.source.kind).toBe("directory");
  });

  it("bounds file count with maxFiles", () => {
    const repo = makeTmpRepo();
    cleanups.push(repo.cleanup);
    const result = discover(repo.dir, { limits: { maxFiles: 2 } });
    expect(result.files.filter((f) => f.included).length).toBe(2);
    expect(result.skipped.some((s) => s.reason === "too-many")).toBe(true);
  });

  it("bounds depth with maxDepth", () => {
    const repo = makeTmpRepo();
    cleanups.push(repo.cleanup);
    const result = discover(repo.dir, { limits: { maxDepth: 1 } });
    expect(result.skipped.some((s) => s.reason === "too-deep")).toBe(true);
    // src/index.ts sits at depth 1 and is still found; src/ingest/ is pruned
    expect(result.files.some((f) => f.path === "src/index.ts")).toBe(true);
    expect(result.files.some((f) => f.path === "src/ingest/webhook.ts")).toBe(false);
  });
});
