/** Visual Engine subprocess runner. */

import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stableStringify } from "../../../src/determinism/hash.js";
import { runVisualEngine } from "../../../src/engines/visual/index.js";

const smallArchitecture = {
  schema_version: 1,
  diagram_type: "architecture",
  meta: {
    title: "Runner Probe",
    animation: "none",
    visual_preset: "classic",
    legend: { mode: "hidden" },
  },
  layout: { mode: "grid", cols: 2 },
  components: [
    { id: "a", type: "external", label: "A", row: 0, col: 0 },
    { id: "b", type: "external", label: "B", row: 0, col: 1 },
  ],
  connections: [{ id: "e1", from: "a", to: "b" }],
};

describe("Visual Engine runner", () => {
  it("renders a valid request and returns the HTML", async () => {
    const { html } = await runVisualEngine(
      "architecture",
      stableStringify(smallArchitecture),
      "d-runner",
    );
    expect(html).toContain("<svg");
    expect(html).toContain('data-node-id="a"');
    expect(html).toContain('data-edge-id="e1"');
  });

  it("is deterministic: the same request yields the same output", async () => {
    const json = stableStringify(smallArchitecture);
    const a = await runVisualEngine("architecture", json, "d-runner");
    const b = await runVisualEngine("architecture", json, "d-runner");
    expect(a.html).toBe(b.html);
  });

  it("cleans its scratch directory up", async () => {
    const prefix = "arclume-visual-cleantest-";
    const before = readdirSync(tmpdir()).filter((d) => d.startsWith(prefix));
    await runVisualEngine("architecture", stableStringify(smallArchitecture), "d-runner", {
      scratchPrefix: prefix,
    });
    const after = readdirSync(tmpdir()).filter((d) => d.startsWith(prefix));
    expect(after.length).toBe(before.length);
  });

  it("reports a missing binary as visual-engine/engine-unavailable", async () => {
    await expect(
      runVisualEngine("architecture", "{}", "d-runner", { cliPath: "C:/nope/not-here.mjs" }),
    ).rejects.toMatchObject({ code: "visual-engine/engine-unavailable" });
  });

  it("reports a non-zero exit as visual-engine/render-failed", async () => {
    await expect(runVisualEngine("architecture", "{ not json", "d-runner")).rejects.toMatchObject({
      code: "visual-engine/render-failed",
    });
  });

  it("reports a timeout as visual-engine/render-failed", async () => {
    // A fake CLI that never exits.
    const dir = mkdtempSync(join(tmpdir(), "arclume-runner-test-"));
    try {
      const sleepy = join(dir, "sleepy.mjs");
      writeFileSync(sleepy, "setTimeout(() => {}, 60000);", "utf8");
      await expect(
        runVisualEngine("architecture", "{}", "d-runner", { cliPath: sleepy, timeoutMs: 500 }),
      ).rejects.toMatchObject({ code: "visual-engine/render-failed" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("scrubs the environment handed to the child process", async () => {
    process.env["ARCLUME_TEST_SECRET"] = "TOP-SECRET-7f3a";
    const dir = mkdtempSync(join(tmpdir(), "arclume-runner-test-"));
    try {
      // A fake CLI that dumps its environment into the output file.
      const spy = join(dir, "spy.mjs");
      writeFileSync(
        spy,
        "import { writeFileSync } from 'node:fs';\n" +
          "writeFileSync(process.argv[process.argv.length - 1], '<svg/>' + JSON.stringify(Object.keys(process.env).sort()), 'utf8');\n",
        "utf8",
      );
      const { html } = await runVisualEngine("architecture", "{}", "d-runner", { cliPath: spy });
      const keys = JSON.parse(html.replace("<svg/>", "")) as string[];
      expect(keys).not.toContain("ARCLUME_TEST_SECRET");
    } finally {
      delete process.env["ARCLUME_TEST_SECRET"];
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never leaks scratch paths or env into error messages", async () => {
    const secret = "TOP-SECRET-VALUE-7f3a";
    process.env["ARCLUME_TEST_SECRET"] = secret;
    try {
      const err: unknown = await runVisualEngine("architecture", "{ not json", "d-runner").catch(
        (e: unknown) => e,
      );
      expect((err as Error).message).not.toContain(secret);
      expect((err as Error).message).not.toContain(tmpdir());
    } finally {
      delete process.env["ARCLUME_TEST_SECRET"];
    }
  });
});
