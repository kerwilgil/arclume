import { afterEach, describe, expect, it } from "vitest";
import { DENYLIST_DIRS, discover, ingest, isSensitiveFileName } from "../src/index.js";
import { makeTmpRepo } from "./helpers/tmp-repo.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

function reasonFor(skipped: { path: string; reason: string }[], path: string): string | undefined {
  return skipped.find((s) => s.path === path)?.reason;
}

describe("sensitive files are never ingested", () => {
  it("classifies well-known secret names", () => {
    for (const name of [".env", "id_rsa", "id_ed25519", "credentials.json", "secrets.json"]) {
      expect(isSensitiveFileName(name)).toBe(true);
    }
    expect(isSensitiveFileName("server.pem")).toBe(true);
    expect(isSensitiveFileName("tls.key")).toBe(true);
    expect(isSensitiveFileName("app.config.json")).toBe(false);
  });

  it("skips .env / id_rsa / credentials.json / secrets.json / *.pem", () => {
    const repo = makeTmpRepo();
    cleanups.push(repo.cleanup);
    repo.write(".env", "APP_SECRET=totally-fake\n");
    repo.write("id_rsa", "placeholder key-file body; Arclume never reads it\n");
    repo.write("credentials.json", '{"token":"fake"}\n');
    repo.write("secrets.json", '{"api":"fake"}\n');
    repo.write("tls/server.pem", "placeholder pem body; Arclume never reads it\n");

    const result = discover(repo.dir);
    expect(reasonFor(result.skipped, ".env")).toBe("sensitive");
    expect(reasonFor(result.skipped, "id_rsa")).toBe("sensitive");
    expect(reasonFor(result.skipped, "credentials.json")).toBe("sensitive");
    expect(reasonFor(result.skipped, "secrets.json")).toBe("sensitive");
    expect(reasonFor(result.skipped, "tls/server.pem")).toBe("sensitive");

    // and they never become documents
    const ingestion = ingest(repo.dir);
    const paths = ingestion.documents.map((d) => d.path);
    expect(paths).not.toContain(".env");
    expect(paths).not.toContain("credentials.json");
    expect(paths).not.toContain("secrets.json");
  });
});

describe("denylisted directories are pruned", () => {
  it("never descends node_modules", () => {
    const repo = makeTmpRepo();
    cleanups.push(repo.cleanup);
    repo.write("node_modules/leftpad/index.js", "module.exports = () => {}\n");
    repo.write("node_modules/leftpad/readme.md", "# leftpad\n");

    const result = discover(repo.dir);
    expect(reasonFor(result.skipped, "node_modules")).toBe("denylisted");
    expect(result.files.some((f) => f.path.startsWith("node_modules/"))).toBe(false);
  });

  it("exposes the denylist for inspection", () => {
    expect(DENYLIST_DIRS.has("node_modules")).toBe(true);
    expect(DENYLIST_DIRS.has(".git")).toBe(true);
    expect(DENYLIST_DIRS.has("dist")).toBe(true);
  });
});

describe("limits and binary handling", () => {
  it("skips a file larger than maxFileBytes without reading it", () => {
    const repo = makeTmpRepo();
    cleanups.push(repo.cleanup);
    repo.write("big.md", `# big\n${"x".repeat(500)}\n`);
    const result = discover(repo.dir, { limits: { maxFileBytes: 100 } });
    const skip = result.skipped.find((s) => s.path === "big.md");
    expect(skip?.reason).toBe("too-large");
    expect(result.files.some((f) => f.path === "big.md" && !f.included)).toBe(true);
  });

  it("skips a total-budget overflow", () => {
    const repo = makeTmpRepo();
    cleanups.push(repo.cleanup);
    const result = discover(repo.dir, { limits: { maxTotalBytes: 200 } });
    expect(result.skipped.some((s) => s.reason === "total-budget")).toBe(true);
  });

  it("detects a binary file by NUL bytes", () => {
    const repo = makeTmpRepo();
    cleanups.push(repo.cleanup);
    repo.write("logo.md", new Uint8Array([80, 78, 71, 0, 0, 0, 13, 10, 26, 10]));
    const result = discover(repo.dir);
    const skip = result.skipped.find((s) => s.path === "logo.md");
    expect(skip?.reason).toBe("binary");
    expect(result.files.some((f) => f.path === "logo.md" && f.kind === "binary")).toBe(true);
  });
});

describe("symlinks and traversal", () => {
  it("records a symlink and never follows it", () => {
    const repo = makeTmpRepo();
    cleanups.push(repo.cleanup);
    const madeFile = repo.symlink("outside-link.md", repo.dir); // link to a dir, doesn't matter
    if (!madeFile) {
      // OS refused symlink creation (e.g. Windows without privilege) — nothing to assert
      return;
    }
    const result = discover(repo.dir);
    const skip = result.skipped.find((s) => s.path === "outside-link.md");
    expect(skip?.reason).toBe("symlink");
    expect(result.files.some((f) => f.path === "outside-link.md")).toBe(false);
  });
});

describe("path style", () => {
  it("always emits POSIX paths regardless of host separator", () => {
    const repo = makeTmpRepo();
    cleanups.push(repo.cleanup);
    const result = discover(repo.dir);
    for (const f of result.files) expect(f.path.includes("\\")).toBe(false);
    for (const s of result.skipped) expect(s.path.includes("\\")).toBe(false);
  });
});
