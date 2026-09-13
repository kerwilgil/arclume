import { describe, expect, it } from "vitest";
import { ParserError, extractMarkdownOutline, parseDocument } from "../src/index.js";

describe("markdown outline", () => {
  const md = [
    "# TaskFlow", // 1
    "", // 2
    "Intro paragraph with a [link](https://example.invalid/docs).", // 3
    "", // 4
    "## Setup", // 5
    "underline heading", // 6
    "-----------------", // 7  (setext H2 for line 6)
    "", // 8
    "```ts", // 9
    "const heading = '# not a heading';", // 10
    "```", // 11
    "", // 12
    "## Done", // 13
  ].join("\n");

  it("finds ATX and setext headings with line numbers", () => {
    const outline = extractMarkdownOutline(md);
    expect(outline.title).toBe("TaskFlow");
    const headings = outline.sections.map((s) => `${s.depth}:${s.heading}@${s.line}`);
    expect(headings).toContain("1:TaskFlow@1");
    expect(headings).toContain("2:Setup@5");
    expect(headings).toContain("2:underline heading@6");
    expect(headings).toContain("2:Done@13");
  });

  it("records fenced code block ranges and ignores headings inside them", () => {
    const outline = extractMarkdownOutline(md);
    expect(outline.codeBlocks).toEqual([{ lang: "ts", line: 9, endLine: 11 }]);
    expect(outline.sections.some((s) => s.heading.includes("not a heading"))).toBe(false);
  });

  it("captures inline links with their line", () => {
    const outline = extractMarkdownOutline(md);
    expect(outline.links).toEqual([{ text: "link", url: "https://example.invalid/docs", line: 3 }]);
  });

  it("gives each section an endLine up to the next same-or-higher heading", () => {
    const outline = extractMarkdownOutline(md);
    const setup = outline.sections.find((s) => s.heading === "Setup");
    // next heading of depth <= 2 is the setext H2 on line 6
    expect(setup?.endLine).toBe(5);
    const done = outline.sections.find((s) => s.heading === "Done");
    expect(done?.endLine).toBe(13);
  });
});

describe("parseDocument", () => {
  it("parses valid JSON and lists key paths", () => {
    const parsed = parseDocument("json", '{"a":{"b":1},"c":[{"d":2}]}', "x.json");
    expect(parsed.outline.kind).toBe("json");
    if (parsed.outline.kind === "json") {
      expect(parsed.outline.rootIsObject).toBe(true);
      expect(parsed.outline.keyPaths).toContain("a.b");
      expect(parsed.outline.keyPaths).toContain("c[]");
    }
  });

  it("throws a recoverable ParserError on invalid JSON", () => {
    try {
      parseDocument("json", "{ not json", "bad.json");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ParserError);
      expect((err as ParserError).code).toBe("parser/invalid-json");
      expect((err as ParserError).severity).toBe("recoverable");
    }
  });

  it("parses YAML with the safe core schema (no booleans from yes/no, no exec)", () => {
    const parsed = parseDocument("yaml", "server:\n  port: 8080\nflag: yes\n", "c.yaml");
    expect(parsed.outline.kind).toBe("yaml");
    if (parsed.outline.kind === "yaml") {
      expect(parsed.outline.keyPaths).toContain("server.port");
      expect(parsed.outline.rootIsObject).toBe(true);
    }
  });

  it("throws a recoverable ParserError on invalid YAML", () => {
    try {
      parseDocument("yaml", "a: [1, 2\nb: {", "bad.yaml");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ParserError);
      expect((err as ParserError).code).toBe("parser/invalid-yaml");
    }
  });

  it("normalizes plain text and counts lines", () => {
    const parsed = parseDocument("text", "one\ntwo\nthree", "n.txt");
    expect(parsed.outline).toEqual({ kind: "text", lineCount: 3 });
  });
});
