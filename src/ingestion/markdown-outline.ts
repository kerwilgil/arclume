/**
 * A small, deterministic Markdown structure extractor.
 *
 * It does NOT render Markdown. It finds headings (ATX + setext), fenced code
 * block ranges, and inline links, with 1-based line numbers so downstream
 * evidence can cite exact ranges. No dependencies, no execution.
 */

import type { MarkdownCodeBlock, MarkdownLink, MarkdownOutline, MarkdownSection } from "./types.js";

const ATX_RE = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+\s*)?$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)/;
const SETEXT_UNDERLINE_RE = /^ {0,3}(=+|-+)\s*$/;
const LINK_RE = /\[([^\]]+)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
const MAX_LINKS = 200;

interface RawHeading {
  depth: number;
  text: string;
  line: number; // 1-based
}

/** Build a {@link MarkdownOutline} from normalized (LF) Markdown text. */
export function extractMarkdownOutline(content: string): MarkdownOutline {
  const lines = content.split("\n");
  const headings: RawHeading[] = [];
  const codeBlocks: MarkdownCodeBlock[] = [];
  const links: MarkdownLink[] = [];

  let inFence = false;
  let fenceMarker = "";
  let fenceStartLine = 0;
  let fenceLang: string | undefined;

  // optional YAML front matter: `---` on line 1 until the next `---`
  let bodyStart = 0;
  if (lines[0]?.trim() === "---") {
    for (let i = 1; i < lines.length; i += 1) {
      if (lines[i]?.trim() === "---") {
        bodyStart = i + 1;
        break;
      }
    }
  }

  for (let i = bodyStart; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const lineNo = i + 1;

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[1] as string;
      if (!inFence) {
        inFence = true;
        fenceMarker = marker[0] as string;
        fenceStartLine = lineNo;
        fenceLang = fence[2] ? fence[2] : undefined;
        continue;
      }
      if (marker[0] === fenceMarker && marker.length >= 3) {
        const block: MarkdownCodeBlock = { line: fenceStartLine, endLine: lineNo };
        if (fenceLang !== undefined) block.lang = fenceLang;
        codeBlocks.push(block);
        inFence = false;
        fenceMarker = "";
        fenceLang = undefined;
        continue;
      }
    }
    if (inFence) continue;

    const atx = ATX_RE.exec(line);
    if (atx) {
      headings.push({
        depth: (atx[1] as string).length,
        text: (atx[2] as string).trim(),
        line: lineNo,
      });
      continue;
    }

    const underline = SETEXT_UNDERLINE_RE.exec(line);
    if (underline && i > bodyStart) {
      const prev = (lines[i - 1] ?? "").trim();
      const prevIsPlain =
        prev.length > 0 && !prev.startsWith("#") && !prev.startsWith("-") && !prev.startsWith(">");
      if (prevIsPlain) {
        headings.push({
          depth: (underline[1] as string).startsWith("=") ? 1 : 2,
          text: prev,
          line: lineNo - 1,
        });
        continue;
      }
    }

    if (links.length < MAX_LINKS) {
      LINK_RE.lastIndex = 0;
      let m: RegExpExecArray | null = LINK_RE.exec(line);
      while (m !== null && links.length < MAX_LINKS) {
        links.push({ text: (m[1] as string).trim(), url: m[2] as string, line: lineNo });
        m = LINK_RE.exec(line);
      }
    }
  }

  if (inFence) {
    // unterminated fence: close it at EOF so the range is still usable
    const block: MarkdownCodeBlock = { line: fenceStartLine, endLine: lines.length };
    if (fenceLang !== undefined) block.lang = fenceLang;
    codeBlocks.push(block);
  }

  const sections: MarkdownSection[] = headings.map((h, idx) => {
    let endLine = lines.length;
    for (let j = idx + 1; j < headings.length; j += 1) {
      const next = headings[j] as RawHeading;
      if (next.depth <= h.depth) {
        endLine = next.line - 1;
        break;
      }
    }
    return { heading: h.text, depth: h.depth, line: h.line, endLine };
  });

  const outline: MarkdownOutline = {
    kind: "markdown",
    sections,
    codeBlocks,
    links,
  };
  const title = headings.find((h) => h.depth === 1)?.text;
  if (title !== undefined) outline.title = title;
  return outline;
}
