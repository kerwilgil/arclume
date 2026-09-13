import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyBudget } from "../src/index.js";
import type { PlannedSlide } from "../src/index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const SCAN_DIRS = ["src", "tests", "schemas", "docs", "vendor"];
const TEXT_EXT = new Set([
  ".ts",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".yaml",
  ".yml",
  ".css",
  ".html",
]);

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (TEXT_EXT.has(extname(entry))) out.push(full);
  }
}

describe("repository hygiene — no physical NUL bytes in source", () => {
  it("every scanned text file is free of 0x00", () => {
    const files: string[] = [];
    for (const d of SCAN_DIRS) walk(join(repoRoot, d), files);
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.filter((f) => readFileSync(f).includes(0));
    expect(offenders.map((f) => f.replace(repoRoot, ""))).toEqual([]);
  });

  it("the planner budget separator is a textual escape, not a NUL byte", () => {
    const src = readFileSync(join(repoRoot, "src/planning/budget.ts"), "utf8");
    expect(src.includes(String.fromCharCode(0))).toBe(false); // no literal NUL char
    expect(src).toContain("\\u0000"); // the escape sequence, spelled out
  });
});

describe("repository hygiene — budget split-marker grouping is unchanged", () => {
  const slide = (over: Partial<PlannedSlide> & Pick<PlannedSlide, "id" | "title">): PlannedSlide =>
    ({
      index: 0,
      sectionId: "sec-a",
      kind: "content",
      keyMessage: "k",
      narrativePurpose: "evidence",
      knowledgeRefs: [],
      claimRefs: [],
      sourceRefs: [],
      contentIntent: "content",
      visualIntent: "none",
      density: "low",
      priority: 5,
      ...over,
    }) as PlannedSlide;

  it("keys split groups by (sectionId, base, total) — a working separator keeps them apart", () => {
    const cover = slide({ id: "s-cover", title: "Cover", kind: "cover" });
    const closing = slide({ id: "s-close", title: "Close", kind: "closing" });
    // sec-a carries part 1 of 2; sec-b carries part 2 of 2. With a real
    // separator these are two *incomplete* groups → both are repaired. If the
    // separator collapsed, they would look like one complete {1,2} group and
    // nothing would be repaired.
    const a1 = slide({ id: "s-a1", title: "Plan (1/2)", sectionId: "sec-a" });
    const b2 = slide({ id: "s-b2", title: "Plan (2/2)", sectionId: "sec-b" });

    const decisions: Parameters<typeof applyBudget>[2] = [];
    const notes: Parameters<typeof applyBudget>[3] = [];
    const budget = { minSlides: 1, targetSlides: 10, maxSlides: 12 };
    applyBudget([cover, a1, b2, closing], budget, decisions, notes);

    const repaired = decisions.filter((d) => d.code === "split-marker-repaired");
    expect(repaired.map((d) => d.slideId).sort()).toEqual(["s-a1", "s-b2"]);
  });
});
