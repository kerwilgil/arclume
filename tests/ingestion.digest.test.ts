import { afterEach, describe, expect, it } from "vitest";
import { analysisDigest, ingest, sourceDigest } from "../src/index.js";
import { makeTmpRepo, sampleRepoPath } from "./helpers/tmp-repo.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

describe("sourceDigest", () => {
  it("is stable across repeated ingests of the same tree", () => {
    const a = sourceDigest(ingest(sampleRepoPath()).documents);
    const b = sourceDigest(ingest(sampleRepoPath()).documents);
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("does not depend on document array order", () => {
    const docs = ingest(sampleRepoPath()).documents;
    const forward = sourceDigest(docs);
    const reversed = sourceDigest([...docs].reverse());
    expect(reversed).toBe(forward);
  });

  it("changes when a file's content changes", () => {
    const before = sourceDigest(ingest(sampleRepoPath()).documents);
    const repo = makeTmpRepo();
    cleanups.push(repo.cleanup);
    repo.write("README.md", "# TaskFlow\n\nCompletely different content.\n");
    const after = sourceDigest(ingest(repo.dir).documents);
    expect(after).not.toBe(before);
  });

  it("changes when a file is added", () => {
    const repo = makeTmpRepo();
    cleanups.push(repo.cleanup);
    const before = sourceDigest(ingest(repo.dir).documents);
    repo.write("docs/extra.md", "# Extra\n\nMore docs.\n");
    const after = sourceDigest(ingest(repo.dir).documents);
    expect(after).not.toBe(before);
  });
});

describe("analysisDigest", () => {
  it("folds in the reasoner identity", () => {
    const sd = `sha256:${"0".repeat(64)}`;
    const a = analysisDigest({ sourceDigest: sd, reasoner: { id: "stub", version: "0.1.0" } });
    const b = analysisDigest({ sourceDigest: sd, reasoner: { id: "stub", version: "0.2.0" } });
    const c = analysisDigest({ sourceDigest: sd, reasoner: { id: "agent", version: "0.1.0" } });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});
