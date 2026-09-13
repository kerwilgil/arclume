import type { Source } from "../../src/index.js";
import type { SourceDocument } from "../../src/index.js";

const H0 = `sha256:${"0".repeat(64)}`;
const H1 = `sha256:${"1".repeat(64)}`;

export function fakeSource(id = "src-x"): Source {
  return { id, kind: "directory", title: "x", uri: "./x" };
}

export function fakeDoc(
  overrides: Partial<SourceDocument> & { id: string } = { id: "doc-x" },
): SourceDocument {
  return {
    sourceId: "src-x",
    kind: "markdown",
    path: "README.md",
    mediaType: "text/markdown",
    content: "# X\n\nline three\nline four\n",
    metadata: { byteLength: 24, lineCount: 4 },
    provenance: { sourceHash: H0, contentHash: H1 },
    outline: { kind: "markdown", sections: [], codeBlocks: [], links: [] },
    ...overrides,
  };
}

export function fakeIngestion(): { sources: Source[]; documents: SourceDocument[] } {
  return { sources: [fakeSource()], documents: [fakeDoc({ id: "doc-x" })] };
}

export const fakeRequest = { sourceDigest: "sha256:deadbeef", documents: [], files: [] };
