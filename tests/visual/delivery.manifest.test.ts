import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildManifest, deriveDeliveryId, verifyManifest } from "../../src/index.js";

describe("delivery manifest", () => {
  it("buildManifest sorts entries by path and stamps the version", () => {
    const m = buildManifest({
      deliveryId: "a".repeat(32),
      visualQa: { valid: true, version: "0.1.0" },
      entries: [
        { path: "screenshots/z.png", bytes: 1, sha256: "0".repeat(64) },
        { path: "arclume-deck.html", bytes: 2, sha256: "1".repeat(64) },
        { path: "manifest-not-listed-here.json", bytes: 3, sha256: "2".repeat(64) },
      ],
    });
    expect(m.entries.map((e) => e.path)).toEqual([
      "arclume-deck.html",
      "manifest-not-listed-here.json",
      "screenshots/z.png",
    ]);
    expect(m.manifestVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(m.deliveryId).toBe("a".repeat(32));
  });

  it("deriveDeliveryId is deterministic and 32 hex chars", () => {
    const parts = {
      deckContentHash: "d".repeat(64),
      htmlSha256: "e".repeat(64),
      configHash: "f".repeat(64),
    };
    const a = deriveDeliveryId(parts);
    const b = deriveDeliveryId(parts);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(deriveDeliveryId({ ...parts, htmlSha256: "0".repeat(64) })).not.toBe(a);
  });

  it("verifyManifest reports a missing manifest", () => {
    const dir = mkdtempSync(join(tmpdir(), "arclume-mf-"));
    try {
      const v = verifyManifest(dir);
      expect(v.valid).toBe(false);
      expect(v.issues[0]?.code).toBe("delivery/manifest-missing");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("verifyManifest reports a listed-but-missing artifact", () => {
    const dir = mkdtempSync(join(tmpdir(), "arclume-mf-"));
    try {
      const manifest = buildManifest({
        deliveryId: "a".repeat(32),
        visualQa: { valid: true, version: "0.1.0" },
        entries: [{ path: "gone.txt", bytes: 3, sha256: "0".repeat(64) }],
      });
      writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
      const v = verifyManifest(dir);
      expect(v.valid).toBe(false);
      expect(v.issues.some((i) => i.code === "delivery/missing-artifact")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
