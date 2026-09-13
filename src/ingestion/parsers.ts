/**
 * Per-kind parsers. Each takes normalized (LF, no BOM) text and returns the
 * content plus a structured outline. Nothing here executes values or resolves
 * external references.
 */

import { parse as parseYaml } from "yaml";
import { ParserError } from "../errors.js";
import { countLines } from "./binary.js";
import { extractMarkdownOutline } from "./markdown-outline.js";
import type {
  DocumentOutline,
  SourceDocumentKind,
  SourceDocumentMetadata,
  StructuredOutline,
} from "./types.js";

export interface ParsedDocument {
  content: string;
  metadata: Omit<SourceDocumentMetadata, "byteLength" | "lineCount">;
  outline: DocumentOutline;
}

const MAX_KEY_PATHS = 300;
const MAX_KEY_DEPTH = 8;

function collectKeyPaths(value: unknown): { keyPaths: string[]; rootIsObject: boolean } {
  const out = new Set<string>();
  const rootIsObject = value !== null && typeof value === "object" && !Array.isArray(value);

  const visit = (node: unknown, prefix: string, depth: number): void => {
    if (out.size >= MAX_KEY_PATHS || depth > MAX_KEY_DEPTH) return;
    if (Array.isArray(node)) {
      if (prefix) out.add(`${prefix}[]`);
      for (const item of node) visit(item, `${prefix}[]`, depth + 1);
      return;
    }
    if (node !== null && typeof node === "object") {
      for (const key of Object.keys(node as Record<string, unknown>).sort()) {
        const path = prefix ? `${prefix}.${key}` : key;
        out.add(path);
        visit((node as Record<string, unknown>)[key], path, depth + 1);
        if (out.size >= MAX_KEY_PATHS) return;
      }
    }
  };

  visit(value, "", 0);
  return { keyPaths: [...out].sort(), rootIsObject };
}

function parseMarkdown(content: string): ParsedDocument {
  const outline = extractMarkdownOutline(content);
  const metadata: ParsedDocument["metadata"] = {
    headings: outline.sections.map((s) => s.heading),
  };
  if (outline.title !== undefined) metadata.title = outline.title;
  return { content, metadata, outline };
}

function parsePlainText(content: string): ParsedDocument {
  return {
    content,
    metadata: {},
    outline: { kind: "text", lineCount: countLines(content) },
  };
}

function parseJsonDoc(content: string, path: string): ParsedDocument {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (cause) {
    throw new ParserError("invalid JSON", {
      code: "parser/invalid-json",
      path,
      severity: "recoverable",
      cause,
    });
  }
  const { keyPaths, rootIsObject } = collectKeyPaths(value);
  const outline: StructuredOutline = { kind: "json", keyPaths, rootIsObject };
  return { content, metadata: {}, outline };
}

function parseYamlDoc(content: string, path: string): ParsedDocument {
  let value: unknown;
  try {
    // core schema only: no custom tags, no merge keys, no executable constructs
    value = parseYaml(content, { schema: "core", merge: false, uniqueKeys: true });
  } catch (cause) {
    throw new ParserError("invalid YAML", {
      code: "parser/invalid-yaml",
      path,
      severity: "recoverable",
      cause,
    });
  }
  const { keyPaths, rootIsObject } = collectKeyPaths(value);
  const outline: StructuredOutline = { kind: "yaml", keyPaths, rootIsObject };
  return { content, metadata: {}, outline };
}

/** Parse `content` according to `kind`. Throws {@link ParserError} on bad input. */
export function parseDocument(
  kind: SourceDocumentKind,
  content: string,
  path: string,
): ParsedDocument {
  switch (kind) {
    case "markdown":
      return parseMarkdown(content);
    case "text":
      return parsePlainText(content);
    case "json":
      return parseJsonDoc(content, path);
    case "yaml":
      return parseYamlDoc(content, path);
    default:
      // Phase 8 parsers (PDF/DOCX/URL) are binary/network stages, not text.
      throw new ParserError("this kind is not parsed from a text buffer", {
        code: "ingestion/unsupported-media-type",
      });
  }
}
