import { describe, expect, it } from "vitest";
import { isSafeRelativeLocatorPath, validateProjectKnowledge } from "../src/index.js";
import { clone, loadFixture } from "./helpers/fixtures.js";

type Doc = {
  sources: Array<{ id: string }>;
  capabilities: Array<{
    id: string;
    name: string;
    sourceRefs: Array<{ sourceId: string; locator?: unknown }>;
  }>;
};

function withCapabilityLocator(locator: unknown): unknown {
  const doc = clone(loadFixture("knowledge/valid/minimal.json")) as Doc;
  doc.capabilities = [
    {
      id: "cap-x",
      name: "X",
      sourceRefs: [{ sourceId: "readme", locator: locator as never }],
    },
  ];
  return doc;
}

describe("locator variants", () => {
  it("accepts each supported locator kind", () => {
    const kinds: unknown[] = [
      { kind: "file", path: "src/index.ts", lineStart: 1, lineEnd: 9 },
      { kind: "page", page: 3, pageEnd: 4 },
      { kind: "url", url: "https://example.invalid/doc" },
      { kind: "fragment", anchor: "Overview > Goals" },
      { kind: "text-range", charStart: 0, charEnd: 120 },
    ];
    for (const locator of kinds) {
      const result = validateProjectKnowledge(withCapabilityLocator(locator));
      expect(result.errors, JSON.stringify(locator)).toEqual([]);
    }
  });

  it("allows commit and note on any locator kind", () => {
    const result = validateProjectKnowledge(
      withCapabilityLocator({
        kind: "file",
        path: "README.md",
        commit: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
        note: "as of the tagged release",
      }),
    );
    expect(result.errors).toEqual([]);
  });

  it("rejects a locator missing its discriminant-required field", () => {
    const result = validateProjectKnowledge(withCapabilityLocator({ kind: "file" }));
    expect(result.valid).toBe(false);
  });

  it("rejects a mixed locator that satisfies no single kind", () => {
    const result = validateProjectKnowledge(
      withCapabilityLocator({ kind: "page", url: "https://example.invalid" }),
    );
    expect(result.valid).toBe(false);
  });

  it("flags an unsafe file locator path (absolute or with ..)", () => {
    const result = validateProjectKnowledge(
      withCapabilityLocator({ kind: "file", path: "../secrets/.env" }),
    );
    expect(result.errors.some((e) => e.code === "cross-ref/unsafe-locator-path")).toBe(true);
  });

  it("flags a reversed line range", () => {
    const result = validateProjectKnowledge(
      withCapabilityLocator({ kind: "file", path: "a.ts", lineStart: 40, lineEnd: 10 }),
    );
    expect(result.errors.some((e) => e.code === "cross-ref/locator-range")).toBe(true);
  });
});

describe("isSafeRelativeLocatorPath", () => {
  const unsafe = [
    "C:\\foo\\bar",
    "C:/foo/bar",
    "\\\\server\\share",
    "//server/share",
    "../foo",
    "foo/../bar",
    "foo\\..\\bar",
    "/absolute/path",
    "\\absolute\\windows",
    "foo/../secret",
    "",
    " src/index.ts",
    "src/index.ts ",
    "a//b",
    "..",
  ];
  const safe = ["src/index.ts", "docs/architecture.md", "folder/subfolder/file.ts", "README.md"];

  for (const p of unsafe) {
    it(`rejects ${JSON.stringify(p)}`, () => {
      expect(isSafeRelativeLocatorPath(p)).toBe(false);
    });
  }
  for (const p of safe) {
    it(`accepts ${JSON.stringify(p)}`, () => {
      expect(isSafeRelativeLocatorPath(p)).toBe(true);
    });
  }
});

describe("unsafe file locator paths are rejected via validation", () => {
  const unsafePaths = [
    "C:\\foo\\bar",
    "C:/foo/bar",
    "\\\\server\\share",
    "//server/share",
    "../foo",
    "foo/../bar",
    "foo\\..\\bar",
  ];

  for (const path of unsafePaths) {
    it(`rejects file locator path ${JSON.stringify(path)}`, () => {
      const result = validateProjectKnowledge(withCapabilityLocator({ kind: "file", path }));
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "cross-ref/unsafe-locator-path")).toBe(true);
    });
  }

  const safePaths = ["src/index.ts", "docs/architecture.md", "folder/subfolder/file.ts"];
  for (const path of safePaths) {
    it(`accepts file locator path ${JSON.stringify(path)}`, () => {
      const result = validateProjectKnowledge(withCapabilityLocator({ kind: "file", path }));
      expect(result.errors).toEqual([]);
    });
  }
});

describe("locator range validation (file / page / text-range)", () => {
  it("rejects file lineEnd < lineStart", () => {
    const result = validateProjectKnowledge(
      withCapabilityLocator({ kind: "file", path: "src/a.ts", lineStart: 20, lineEnd: 10 }),
    );
    expect(result.errors.some((e) => e.code === "cross-ref/locator-range")).toBe(true);
  });

  it("rejects page pageEnd < page", () => {
    const result = validateProjectKnowledge(
      withCapabilityLocator({ kind: "page", page: 10, pageEnd: 5 }),
    );
    expect(result.errors.some((e) => e.code === "cross-ref/locator-range")).toBe(true);
  });

  it("rejects text-range charEnd < charStart", () => {
    const result = validateProjectKnowledge(
      withCapabilityLocator({ kind: "text-range", charStart: 100, charEnd: 20 }),
    );
    expect(result.errors.some((e) => e.code === "cross-ref/locator-range")).toBe(true);
  });

  it("accepts equal ranges for all three kinds", () => {
    const equalRanges: unknown[] = [
      { kind: "file", path: "src/a.ts", lineStart: 7, lineEnd: 7 },
      { kind: "page", page: 3, pageEnd: 3 },
      { kind: "text-range", charStart: 42, charEnd: 42 },
    ];
    for (const locator of equalRanges) {
      const result = validateProjectKnowledge(withCapabilityLocator(locator));
      expect(result.errors, JSON.stringify(locator)).toEqual([]);
    }
  });

  it("keeps accepting a valid ascending file range", () => {
    const result = validateProjectKnowledge(
      withCapabilityLocator({ kind: "file", path: "src/a.ts", lineStart: 10, lineEnd: 20 }),
    );
    expect(result.errors).toEqual([]);
  });
});
