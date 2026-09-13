/**
 * Provenance chain: Source → Knowledge → Visual (+ verification)
 * (Visual Intelligence, Slice 2B §9).
 *
 * A knowledge entity's `SourceRef` survives into the diagram model, into the
 * `DiagramIR` artifact, and stays individually verifiable against the Git
 * repository it points at. Nodes / edges keep their `entityId` / `relationId`
 * back-references. This is the contract + metadata a future Evidence Inspector
 * (Slice 3) consumes — no inspector UI is built here.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_VISUAL_LIMITS,
  type ProjectKnowledge,
  type SourceRef,
  attachEvidence,
  buildDataflowModel,
  buildKnowledgeView,
  buildLifecycleModel,
  modelKnowledgeRefs,
  nativeDiagramAdapter,
  verifySourceRefEvidence,
} from "../src/index.js";

const L = DEFAULT_VISUAL_LIMITS;

const EMPTY = {
  capabilities: [],
  components: [],
  actors: [],
  dependencies: [],
  processes: [],
  phases: [],
  milestones: [],
  metrics: [],
  risks: [],
  decisions: [],
  requirements: [],
  technologies: [],
  results: [],
  constraints: [],
  relations: [],
  claims: [],
  gaps: [],
};

function knowledge(over: Partial<ProjectKnowledge>): ProjectKnowledge {
  return {
    knowledgeVersion: "0.1.0",
    project: { id: "proj", name: "Demo", sourceRefs: [] },
    sources: [{ id: "repo", kind: "repo", title: "The repo" }],
    ...EMPTY,
    ...over,
  } as ProjectKnowledge;
}

/* ---- a throw-away Git repo the source refs point at ---- */

const created: string[] = [];
afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

function git(dir: string, args: string[]): string {
  const r = spawnSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"],
      SystemRoot: process.env["SystemRoot"],
      PATHEXT: process.env["PATHEXT"],
      HOME: dir,
      USERPROFILE: dir,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: join(dir, "no-global"),
      GIT_AUTHOR_NAME: "T",
      GIT_AUTHOR_EMAIL: "t@t.invalid",
      GIT_COMMITTER_NAME: "T",
      GIT_COMMITTER_EMAIL: "t@t.invalid",
    },
  });
  return (r.stdout ?? "").trim();
}

/** Repo with `src/importer.ts` (6 lines) and `src/lifecycle.ts` (4 lines). */
function makeRepo(): { dir: string; head: string } {
  const dir = mkdtempSync(join(tmpdir(), "arclume-prov-"));
  created.push(dir);
  git(dir, ["-c", "init.defaultBranch=main", "init", "-q"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "importer.ts"), "a\nb\nc\nd\ne\nf\n");
  writeFileSync(join(dir, "src", "lifecycle.ts"), "one\ntwo\nthree\nfour\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "init"]);
  return { dir, head: git(dir, ["rev-parse", "HEAD"]) };
}

const repo = makeRepo();

const fileRef = (path: string, lineStart: number, lineEnd: number): SourceRef => ({
  sourceId: "repo",
  locator: { kind: "file", path, lineStart, lineEnd, commit: repo.head },
});

/* ------------------------------------------------------------------ */

describe("dataflow provenance: Source → Knowledge → Visual", () => {
  const k = knowledge({
    components: [
      {
        id: "cmp-i",
        name: "Importer",
        kind: "service",
        sourceRefs: [fileRef("src/importer.ts", 1, 6)],
      },
      { id: "cmp-s", name: "Store", kind: "store", sourceRefs: [fileRef("src/importer.ts", 3, 4)] },
    ],
    relations: [
      {
        id: "rel-p",
        from: "cmp-i",
        to: "cmp-s",
        type: "PRODUCES",
        sourceRefs: [fileRef("src/importer.ts", 2, 2)],
      },
    ],
  });
  const ids = ["cmp-i", "cmp-s", "rel-p"];
  const model = buildDataflowModel(buildKnowledgeView(k), ids, L);

  it("the knowledge SourceRefs survive into the diagram model", () => {
    if (model?.kind !== "dataflow") throw new Error("expected dataflow");
    const paths = model.sourceRefs
      .map((r) => (r.locator?.kind === "file" ? r.locator.path : undefined))
      .filter(Boolean);
    expect(paths).toContain("src/importer.ts");
    expect(model.sourceRefs.length).toBeGreaterThanOrEqual(1);
  });

  it("nodes keep entityId and edges keep relationId back-references", () => {
    if (model?.kind !== "dataflow") throw new Error("expected dataflow");
    expect(model.nodes.map((n) => n.entityId).sort()).toEqual(["cmp-i", "cmp-s"]);
    expect(model.flows.map((f) => f.relationId)).toEqual(["rel-p"]);
    expect(modelKnowledgeRefs(model).sort()).toEqual(["cmp-i", "cmp-s", "rel-p"]);
  });

  it("the DiagramIR artifact carries the same SourceRefs (Visual → Artifact)", () => {
    if (!model) throw new Error("expected model");
    const ir = nativeDiagramAdapter.toDiagramIR(model, "dgm-df", "Ingest");
    expect(ir.sourceRefs).toEqual(model.sourceRefs);
  });

  it("each model SourceRef stays independently verifiable against the repo", () => {
    if (!model) throw new Error("expected model");
    for (const ref of model.sourceRefs) {
      const v = verifySourceRefEvidence(ref, { repoRoot: repo.dir });
      expect(v.verdict).toBe("VERIFIED");
    }
  });

  it("attachEvidence packages the ref + its verdict (Slice 3 envelope)", () => {
    if (!model) throw new Error("expected model");
    const env = attachEvidence(model.sourceRefs[0] as SourceRef, { repoRoot: repo.dir });
    expect(env.ref).toBe(model.sourceRefs[0]);
    expect(env.verification?.verdict).toBe("VERIFIED");
  });
});

describe("lifecycle provenance: Source → Knowledge → Visual", () => {
  const k = knowledge({
    phases: [
      {
        id: "ph-1",
        name: "Build",
        status: "done",
        sourceRefs: [fileRef("src/lifecycle.ts", 1, 2)],
      },
      {
        id: "ph-2",
        name: "Ship",
        status: "active",
        sourceRefs: [fileRef("src/lifecycle.ts", 3, 4)],
      },
    ],
    relations: [
      {
        id: "rel-a",
        from: "ph-1",
        to: "ph-2",
        type: "PRECEDES",
        sourceRefs: [fileRef("src/lifecycle.ts", 2, 3)],
      },
    ],
  });
  const model = buildLifecycleModel(buildKnowledgeView(k), ["ph-1", "ph-2", "rel-a"], L);

  it("phase / transition refs survive and stay verifiable", () => {
    if (model?.kind !== "lifecycle") throw new Error("expected lifecycle");
    expect(model.states.map((s) => s.ref).sort()).toEqual(["ph-1", "ph-2"]);
    expect(model.transitions.map((t) => t.relationId)).toEqual(["rel-a"]);
    expect(model.sourceRefs.length).toBeGreaterThanOrEqual(1);
    for (const ref of model.sourceRefs) {
      expect(verifySourceRefEvidence(ref, { repoRoot: repo.dir }).verdict).toBe("VERIFIED");
    }
  });

  it("a stale line range on an otherwise real ref is UNVERIFIED, not invented away", () => {
    const stale: SourceRef = {
      sourceId: "repo",
      locator: {
        kind: "file",
        path: "src/lifecycle.ts",
        lineStart: 3,
        lineEnd: 99,
        commit: repo.head,
      },
    };
    const v = verifySourceRefEvidence(stale, { repoRoot: repo.dir });
    expect(v.verdict).toBe("UNVERIFIED");
    expect(v.reasonCode).toBe("line-range-out-of-bounds");
  });
});
