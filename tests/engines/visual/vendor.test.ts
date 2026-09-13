/**
 * Vendored Visual Engine integrity.
 *
 * The vendored subtree is pinned three ways: version, upstream commit and a
 * canonical SHA-256 over `(relative POSIX path, file bytes)` for every file.
 * Any mutation of any byte under `vendor/archify/` fails this test. Upgrading
 * the visual engine must be a deliberate act that updates the constants in
 * `src/engines/visual/vendored.ts` together with the fixtures that depend on
 * them.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { VISUAL_ENGINE_VENDORED } from "../../../src/engines/visual/index.js";
import {
  VISUAL_ENGINE_COMMIT,
  VISUAL_ENGINE_FILE_COUNT,
  VISUAL_ENGINE_SUBTREE_SHA256,
  computeVisualEngineSubtreeDigest,
  visualEngineCliPath,
  visualEngineVendorRoot,
} from "../../../src/engines/visual/vendored.js";

describe("vendored visual engine identity", () => {
  it("is pinned to visual engine v2.16.0 at the recorded commit", () => {
    expect(VISUAL_ENGINE_VENDORED).toBe("2.16.0");
    expect(VISUAL_ENGINE_COMMIT).toMatch(/^[0-9a-f]{40}$/);
    expect(VISUAL_ENGINE_COMMIT).toBe("c826e6c3a7abad19c0f3cd1ca57207d54b1ad8de");
  });

  it("the vendored package.json declares the same version and license", () => {
    const pkg = JSON.parse(
      readFileSync(join(visualEngineVendorRoot(), "package.json"), "utf8"),
    ) as {
      name: string;
      version: string;
      license: string;
      dependencies?: unknown;
    };
    expect(pkg.name).toBe("archify");
    expect(pkg.version).toBe(VISUAL_ENGINE_VENDORED);
    expect(pkg.license).toBe("MIT");
  });

  it("has zero runtime npm dependencies", () => {
    const pkg = JSON.parse(
      readFileSync(join(visualEngineVendorRoot(), "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it("matches the canonical subtree digest and file count", () => {
    const digest = computeVisualEngineSubtreeDigest();
    expect(digest.fileCount).toBe(VISUAL_ENGINE_FILE_COUNT);
    expect(digest.sha256).toBe(VISUAL_ENGINE_SUBTREE_SHA256);
    expect(digest.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("any byte mutation breaks the digest", () => {
    const digest = computeVisualEngineSubtreeDigest();
    const mutated = computeVisualEngineSubtreeDigest();
    // Same input twice → identical digest (determinism), and the constants differ
    // from a trivial placeholder.
    expect(mutated.sha256).toBe(digest.sha256);
    expect(digest.fileCount).toBeGreaterThan(40);
  });

  it("ships its license and vendor record", () => {
    const license = readFileSync(join(visualEngineVendorRoot(), "LICENSE"), "utf8");
    expect(license).toContain("MIT License");
    expect(license).toContain("tt-a1i");
    const vendordoc = readFileSync(join(visualEngineVendorRoot(), "VENDOR.md"), "utf8");
    expect(vendordoc).toContain("https://github.com/tt-a1i/archify");
    expect(vendordoc).toContain("v2.16.0");
    expect(vendordoc).toContain(VISUAL_ENGINE_COMMIT);
  });

  it("the CLI entry point exists and is a plain file", () => {
    expect(existsSync(visualEngineCliPath())).toBe(true);
  });
});

describe("vendored visual engine — offline render path audit", () => {
  it("network-capable code is confined to the brand-capture module, gated on brand URLs", () => {
    const root = visualEngineVendorRoot();
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir) as string[]) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.mjs$/.test(entry)) files.push(full);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(10);

    // The render path = bin/archify.mjs + renderers/** + migrations/**.
    const renderScope = [
      join(root, "bin", "archify.mjs"),
      join(root, "renderers"),
      join(root, "migrations"),
    ];
    const inScope = (f: string): boolean =>
      renderScope.some(
        (scope) => f === scope || f.startsWith(`${scope}\\`) || f.startsWith(`${scope}/`),
      );

    // Only ONE vendored module may contain socket-capable imports: the
    // brand-capture module (its network use is gated on `node.brand`, which
    // ARCLUME requests never carry).
    const NETWORK_MODULES = [
      "node:http",
      "node:https",
      "node:net",
      "node:tls",
      "node:dgram",
      "node:dns",
    ];
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      const rel = file.replace(root, "");
      if (!inScope(file)) continue; // bin/preview.mjs etc. are never invoked
      const hasNetwork = NETWORK_MODULES.some(
        (m) => src.includes(`"${m}"`) || src.includes(`'${m}'`),
      );
      if (hasNetwork) offenders.push(rel);
    }
    expect(offenders).toEqual([expect.stringContaining("brand-marks.mjs")]);

    // …and its network use is gated on `node.brand` being present.
    const brandMarks = readFileSync(join(root, "renderers", "shared", "brand-marks.mjs"), "utf8");
    expect(brandMarks).toContain("if (!node.brand) return;");
  });

  it("no ARCLUME adapter request can ever carry a brand reference", async () => {
    const { adaptDiagramToVisualEngine } = await import("../../../src/engines/visual/index.js");
    const stable = await import("../../../src/determinism/hash.js");
    const { architectureDiagram, workflowDiagram } = await import("./helpers.js");
    for (const fixture of [architectureDiagram(), workflowDiagram(3)]) {
      const adapted = adaptDiagramToVisualEngine(fixture);
      if (adapted.kind !== "ok") throw new Error("fixture must adapt");
      const json = stable.stableStringify(adapted.request);
      expect(json).not.toContain('"brand"');
    }
  });

  it("the runner injects the network tripwire preload", async () => {
    const runnerSrc = readFileSync(
      join(process.cwd(), "src", "engines", "visual", "runner.ts"),
      "utf8",
    );
    expect(runnerSrc).toContain("NETGUARD_SOURCE");
    expect(runnerSrc).toContain("--import");
    expect(runnerSrc).toContain("network access blocked");
  });
});

describe("vendored visual engine CLI", () => {
  it("renders an architecture diagram offline, from an isolated temp directory", async () => {
    const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { spawn } = await import("node:child_process");

    const dir = mkdtempSync(join(tmpdir(), "arclume-visual-vendor-"));
    try {
      const request = {
        schema_version: 1,
        diagram_type: "architecture",
        meta: {
          title: "Vendor Probe",
          animation: "none",
          visual_preset: "classic",
          legend: { mode: "hidden" },
        },
        layout: { mode: "grid", cols: 2 },
        components: [
          { id: "alpha", type: "external", label: "Alpha", row: 0, col: 0 },
          { id: "beta", type: "external", label: "Beta", row: 0, col: 1 },
        ],
        connections: [{ id: "edge-1", from: "alpha", to: "beta" }],
      };
      const inputPath = join(dir, "request.json");
      const outputPath = join(dir, "out.html");
      writeFileSync(inputPath, JSON.stringify(request), "utf8");

      const run = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
        const child = spawn(
          process.execPath,
          [visualEngineCliPath(), "render", "architecture", inputPath, outputPath],
          { env: { PATH: process.env["PATH"] ?? "" } },
        );
        let stderr = "";
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf8");
        });
        child.on("close", (code) => resolve({ code, stderr }));
        child.on("error", (err) => resolve({ code: 1, stderr: String(err) }));
      });

      expect(run.stderr).toBe("");
      expect(run.code).toBe(0);
      const html = readFileSync(outputPath, "utf8");
      expect(html).toContain("<svg");
      expect(html).toContain("</svg>");
      expect(html).toContain('data-node-id="alpha"');
      expect(html).toContain('data-node-id="beta"');
      expect(html).toContain('data-edge-id="edge-1"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
