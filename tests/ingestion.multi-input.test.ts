import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StubReasoner, ingest, runAnalyze, sourceDigest } from "../src/index.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

/** A directory with a fixed basename (so two of them collide on `Source.id`). */
function namedDir(name: string, files: Record<string, string>): string {
  const parent = mkdtempSync(join(tmpdir(), "arclume-mi-"));
  cleanups.push(() => rmSync(parent, { recursive: true, force: true }));
  const dir = join(parent, name);
  mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe("multi-input file identity", () => {
  it("keeps a same-named file from every input root", async () => {
    const a = namedDir("proj", { "README.md": "# A\n\nAlpha project.\n" });
    const b = namedDir("proj", { "README.md": "# B\n\nBeta project.\n" });

    const analyzed = await runAnalyze([a, b], new StubReasoner());

    const readmeFiles = analyzed.request.files.filter((f) => f.path === "README.md");
    expect(readmeFiles.length).toBe(2);
    expect(new Set(readmeFiles.map((f) => f.sourceId)).size).toBe(2);

    const readmeDocs = analyzed.request.documents.filter((d) => d.path === "README.md");
    expect(readmeDocs.length).toBe(2);
    expect(new Set(readmeDocs.map((d) => d.sourceId)).size).toBe(2);
  });
});

describe("source-id collision disambiguation is order-independent", () => {
  it("produces the same sourceDigest regardless of input order (distinct content)", () => {
    const a = namedDir("proj", { "README.md": "# A\n\nAlpha.\n" });
    const b = namedDir("proj", { "README.md": "# B\n\nBeta.\n" });

    const forward = sourceDigest(ingest([a, b]).documents);
    const reversed = sourceDigest(ingest([b, a]).documents);
    expect(forward).toBe(reversed);
  });

  it("produces the same sourceDigest regardless of input order (identical content)", () => {
    const a = namedDir("proj", { "README.md": "# Same\n\nIdentical body.\n" });
    const b = namedDir("proj", { "README.md": "# Same\n\nIdentical body.\n" });

    expect(sourceDigest(ingest([a, b]).documents)).toBe(sourceDigest(ingest([b, a]).documents));

    const res = ingest([a, b]);
    expect(res.sources.length).toBe(2);
    expect(new Set(res.sources.map((s) => s.id)).size).toBe(2); // no duplicate id
  });
});
