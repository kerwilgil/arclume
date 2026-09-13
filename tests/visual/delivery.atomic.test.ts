import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DeliveryError,
  buildVisualQaReceipt,
  contentHash,
  deliverAtomic,
  renderDeckHtml,
  verifyManifest,
  visualQaConfigHash,
} from "../../src/index.js";
import type {
  ArclumeDeck,
  DeliveryArtifactInput,
  DeliveryHooks,
  ScreenshotDescriptor,
  VisualQaResult,
} from "../../src/index.js";
import { sparseDeck } from "./helpers/decks.js";

/** A minimal but valid 1x1 transparent PNG. */
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==",
  "base64",
);

function descriptor(name: string, index: number): ScreenshotDescriptor {
  return {
    viewport: "desktop-1440x900",
    slideId: name,
    index,
    kind: "slide",
    width: 1,
    height: 1,
    bytes: PNG_1x1.length,
    sha256: createHash("sha256").update(PNG_1x1).digest("hex"),
    path: `screenshots/${name}.png`,
  };
}

function artifact(name: string, index: number): ScreenshotDescriptor & { buffer: Buffer } {
  return { ...descriptor(name, index), buffer: PNG_1x1 };
}

const sha256Utf8 = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex");

function fakeResult(valid: boolean, htmlSha256: string): VisualQaResult {
  return {
    version: "0.1.0",
    valid,
    browser: { name: "chromium", version: "151.0.0.0", platform: "linux", deviceScaleFactor: 1 },
    input: { htmlSha256 },
    viewports: [
      {
        viewport: "desktop-1440x900",
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        slideCount: 2,
        findings: valid ? 0 : 1,
        errors: valid ? 0 : 1,
        warnings: 0,
        info: 0,
      },
    ],
    findings: valid
      ? []
      : [
          {
            code: "visual/slide-overflow-y",
            severity: "error",
            viewport: "desktop-1440x900",
            message: "overflow",
          },
        ],
    screenshots: [descriptor("slide-001-a", 1), descriptor("slide-002-b", 2)],
    summary: { errors: valid ? 0 : 1, warnings: 0, info: 0 },
  };
}

function inputFor(deck: ArclumeDeck, html: string, valid: boolean): DeliveryArtifactInput {
  const result = fakeResult(valid, sha256Utf8(html));
  const receipt = buildVisualQaReceipt({
    result,
    html,
    deckIrVersion: deck.irVersion,
    deckContentHash: contentHash(deck).slice("sha256:".length),
    configHash: visualQaConfigHash([], {}),
  });
  return {
    deck,
    html,
    visualQa: result,
    receipt,
    screenshots: [artifact("slide-001-a", 1), artifact("slide-002-b", 2)],
  };
}

describe("atomic delivery", () => {
  let dir = "";
  let deck: ArclumeDeck;
  let html = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arclume-delivery-"));
    deck = sparseDeck();
    html = renderDeckHtml(deck).html;
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes a complete, manifest-verified bundle and renames it into place", async () => {
    const dest = join(dir, "delivery");
    const out = await deliverAtomic(dest, inputFor(deck, html, true));
    expect(out.delivered).toBe(true);
    expect(existsSync(dest)).toBe(true);

    const files = readdirSync(dest).sort();
    expect(files).toEqual([
      "arclume-deck.html",
      "arclume-deck.json",
      "manifest.json",
      "screenshots",
      "visual-qa-receipt.json",
      "visual-qa.json",
    ]);

    // manifest: sorted by path, lists every artifact except itself
    const manifest = JSON.parse(readFileSync(join(dest, "manifest.json"), "utf8"));
    const paths = manifest.entries.map((e: { path: string }) => e.path);
    expect(paths).toEqual([...paths].sort());
    expect(paths).not.toContain("manifest.json");
    expect(paths).toContain("arclume-deck.html");
    expect(paths).toContain("screenshots/slide-001-a.png");

    // no leftover staging sibling
    expect(readdirSync(dir).some((n) => n.includes(".staging-"))).toBe(false);

    // verifyManifest is clean
    expect(verifyManifest(dest).valid).toBe(true);
  });

  it("refuses to overwrite an existing destination", async () => {
    const dest = join(dir, "delivery");
    await deliverAtomic(dest, inputFor(deck, html, true));
    await expect(deliverAtomic(dest, inputFor(deck, html, true))).rejects.toMatchObject({
      code: "delivery/destination-exists",
    });
  });

  it("a failing Visual QA never produces a final bundle", async () => {
    const dest = join(dir, "delivery");
    await expect(deliverAtomic(dest, inputFor(deck, html, false))).rejects.toBeInstanceOf(
      DeliveryError,
    );
    expect(existsSync(dest)).toBe(false);
    expect(readdirSync(dir).some((n) => n.includes(".staging-"))).toBe(false);
  });

  it.each([["afterHtml"], ["afterScreenshots"], ["beforeManifest"], ["beforeRename"]] as const)(
    "failure injected at %s leaves no destination and cleans staging",
    async (hook) => {
      const dest = join(dir, "delivery");
      const hooks: DeliveryHooks = {};
      hooks[hook] = () => {
        throw new Error(`boom at ${hook}`);
      };
      await expect(
        deliverAtomic(dest, inputFor(deck, html, true), { hooks }),
      ).rejects.toBeInstanceOf(DeliveryError);
      expect(existsSync(dest)).toBe(false);
      expect(readdirSync(dir).some((n) => n.includes(".staging-"))).toBe(false);
    },
  );

  it("a previous delivery survives a later failed delivery to a different path", async () => {
    const good = join(dir, "good");
    await deliverAtomic(good, inputFor(deck, html, true));
    const bad = join(dir, "bad");
    await expect(
      deliverAtomic(bad, inputFor(deck, html, true), {
        hooks: {
          beforeRename: () => {
            throw new Error("boom");
          },
        },
      }),
    ).rejects.toBeInstanceOf(DeliveryError);
    expect(verifyManifest(good).valid).toBe(true);
  });

  it("tamper detection: modifying a delivered artifact fails verifyManifest", async () => {
    const dest = join(dir, "delivery");
    await deliverAtomic(dest, inputFor(deck, html, true));
    writeFileSync(join(dest, "arclume-deck.html"), `${html}<!-- tampered -->`);
    const v = verifyManifest(dest);
    expect(v.valid).toBe(false);
    expect(v.issues.some((i) => i.code === "delivery/hash-mismatch")).toBe(true);
  });

  it("verifyManifest flags an unlisted extra file", async () => {
    const dest = join(dir, "delivery");
    await deliverAtomic(dest, inputFor(deck, html, true));
    writeFileSync(join(dest, "extra.txt"), "surprise");
    const v = verifyManifest(dest);
    expect(v.valid).toBe(false);
    expect(v.issues.some((i) => i.code === "delivery/unlisted-artifact")).toBe(true);
  });

  it("the delivery id is hash-derived and stable for the same inputs", async () => {
    const a = await deliverAtomic(join(dir, "a"), inputFor(deck, html, true));
    const b = await deliverAtomic(join(dir, "b"), inputFor(deck, html, true));
    expect(a.deliveryId).toBe(b.deliveryId);
    expect(a.deliveryId).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("delivery evidence binding — negative cases (rejected before any staging)", () => {
  let dir = "";
  let deckA: ArclumeDeck;
  let htmlA = "";
  let deckB: ArclumeDeck;
  let htmlB = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arclume-bind-"));
    deckA = sparseDeck();
    htmlA = renderDeckHtml(deckA).html;
    deckB = sparseDeck({ meta: { title: "A different deck entirely" } });
    htmlB = renderDeckHtml(deckB).html;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const expectRejected = async (input: DeliveryArtifactInput, code: string): Promise<void> => {
    const dest = join(dir, "delivery");
    await expect(deliverAtomic(dest, input)).rejects.toMatchObject({ code });
    expect(existsSync(dest)).toBe(false);
    expect(readdirSync(dir).some((n) => n.includes(".staging-"))).toBe(false);
  };

  it("1. receipt built for HTML A, delivered with HTML B", async () => {
    const input = inputFor(deckA, htmlA, true);
    input.html = htmlB;
    await expectRejected(input, "delivery/html-hash-mismatch");
  });

  it("2. receipt built for deck A, delivered with deck B", async () => {
    const input = inputFor(deckA, htmlA, true);
    input.deck = deckB;
    await expectRejected(input, "delivery/deck-hash-mismatch");
  });

  it("2b. receipt is missing deck.contentHash", async () => {
    const input = inputFor(deckA, htmlA, true);
    const { contentHash: _drop, ...deckNoHash } = input.receipt.deck;
    input.receipt = { ...input.receipt, deck: deckNoHash };
    await expectRejected(input, "delivery/deck-hash-mismatch");
  });

  it("3. VisualQaResult browser version manipulated vs the receipt", async () => {
    const input = inputFor(deckA, htmlA, true);
    input.visualQa = {
      ...input.visualQa,
      browser: { ...input.visualQa.browser, version: "999.0.0.0" },
    };
    await expectRejected(input, "delivery/evidence-mismatch");
  });

  it("4. valid=true but there is a real error finding", async () => {
    const input = inputFor(deckA, htmlA, true);
    input.visualQa = {
      ...input.visualQa,
      valid: true, // lie
      findings: [
        {
          code: "visual/page-error",
          severity: "error",
          viewport: "desktop-1440x900",
          message: "x",
        },
      ],
      summary: { errors: 1, warnings: 0, info: 0 },
    };
    await expectRejected(input, "delivery/qa-summary-mismatch");
  });

  it("5. summary counts that do not match the real findings tally", async () => {
    const input = inputFor(deckA, htmlA, true);
    input.visualQa = {
      ...input.visualQa,
      findings: [
        {
          code: "visual/local-scroll",
          severity: "info",
          viewport: "desktop-1440x900",
          message: "x",
        },
      ],
      summary: { errors: 0, warnings: 0, info: 0 },
    };
    await expectRejected(input, "delivery/qa-summary-mismatch");
  });

  it("6. screenshot descriptor SHA correct for A but buffer is B", async () => {
    const input = inputFor(deckA, htmlA, true);
    const other = Buffer.from(`${PNG_1x1.toString("base64")}==tampered`, "utf8");
    input.screenshots = input.screenshots.map((s, i) => (i === 0 ? { ...s, buffer: other } : s));
    await expectRejected(input, "delivery/screenshot-hash-mismatch");
  });

  it("7. screenshot descriptor bytes value is wrong", async () => {
    const input = inputFor(deckA, htmlA, true);
    input.screenshots = input.screenshots.map((s, i) =>
      i === 0 ? { ...s, bytes: s.bytes + 1 } : s,
    );
    // visualQa.screenshots must stay consistent with the artifact set, so this
    // surfaces as the buffer/descriptor hash-and-bytes check first
    await expectRejected(input, "delivery/screenshot-hash-mismatch");
  });

  it("8. visualQa.screenshots carries a stale descriptor vs the artifacts", async () => {
    const input = inputFor(deckA, htmlA, true);
    input.visualQa = {
      ...input.visualQa,
      screenshots: [
        input.visualQa.screenshots[0] as ScreenshotDescriptor,
        {
          ...(input.visualQa.screenshots[1] as ScreenshotDescriptor),
          path: "screenshots/stale.png",
        },
      ],
    };
    await expectRejected(input, "delivery/screenshot-set-mismatch");
  });

  it("9. receipt.screenshots is missing an entry", async () => {
    const input = inputFor(deckA, htmlA, true);
    input.receipt = {
      ...input.receipt,
      screenshots: input.receipt.screenshots.slice(0, 1),
    };
    await expectRejected(input, "delivery/receipt-mismatch");
  });

  it("10. a receipt screenshot hash was modified", async () => {
    const input = inputFor(deckA, htmlA, true);
    input.receipt = {
      ...input.receipt,
      screenshots: input.receipt.screenshots.map((s, i) =>
        i === 0 ? { ...s, sha256: "0".repeat(64) } : s,
      ),
    };
    await expectRejected(input, "delivery/receipt-mismatch");
  });

  it("a coherent input still delivers", async () => {
    const out = await deliverAtomic(join(dir, "ok"), inputFor(deckA, htmlA, true));
    expect(out.delivered).toBe(true);
  });

  // --- semantic Deck <-> HTML <-> QA-input bindings (not just hash coherence) ---

  it("11. deck B + HTML A with a receipt fully REGENERATED for the mix still fails the Deck<->HTML binding", async () => {
    // This is deliberately NOT a stale-receipt case: inputFor rebuilds the
    // receipt for (deckB, htmlA), so receipt.deck.contentHash === contentHash(deckB),
    // receipt.inputs.htmlSha256 === sha256(htmlA) and visualQa.input.htmlSha256
    // === sha256(htmlA). Every per-field binding is internally coherent.
    const input = inputFor(deckB, htmlA, true);
    expect(input.receipt.deck.contentHash).toBe(contentHash(deckB).slice("sha256:".length));
    expect(input.receipt.inputs.htmlSha256).toBe(sha256Utf8(htmlA));
    expect(input.visualQa.input.htmlSha256).toBe(sha256Utf8(htmlA));
    // Only the semantic binding is broken: htmlA is not renderDeckHtml(deckB).html.
    await expectRejected(input, "delivery/html-deck-mismatch");
  });

  it("12. Visual QA evidence is for HTML A but delivery + receipt are HTML B → delivery/qa-input-mismatch", async () => {
    // deck B renders to htmlB (Deck<->HTML holds); the receipt correctly
    // certifies htmlB; a brand-new receipt cannot hide that the QA screenshots /
    // findings were produced against a different document (htmlA).
    const input = inputFor(deckB, htmlB, true);
    input.visualQa = { ...input.visualQa, input: { htmlSha256: sha256Utf8(htmlA) } };
    expect(input.receipt.inputs.htmlSha256).toBe(sha256Utf8(htmlB));
    await expectRejected(input, "delivery/qa-input-mismatch");
  });
});

describe("safe manifest path confinement", () => {
  let dir = "";
  let bundle = "";

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "arclume-confine-"));
    writeFileSync(join(dir, "outside.txt"), "SECRET outside the bundle");
    const deck = sparseDeck();
    const html = renderDeckHtml(deck).html;
    bundle = join(dir, "bundle");
    await deliverAtomic(bundle, inputFor(deck, html, true));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function rewriteManifest(
    mutate: (entries: Array<{ path: string; bytes: number; sha256: string }>) => void,
  ): void {
    const p = join(bundle, "manifest.json");
    const m = JSON.parse(readFileSync(p, "utf8"));
    mutate(m.entries);
    writeFileSync(p, `${JSON.stringify(m, null, 2)}\n`);
  }

  it.each([
    ["../outside.txt"],
    ["screenshots/../../outside.txt"],
    ["/etc/passwd"],
    ["C:/Windows/system32/x"],
    ["a\\b"],
    ["./arclume-deck.html"],
    ["foo/../bar"],
    ["manifest.json"],
  ])("verifyManifest rejects the malicious entry path %j", (badPath) => {
    rewriteManifest((entries) => {
      entries.push({ path: badPath, bytes: 1, sha256: "0".repeat(64) });
    });
    const v = verifyManifest(bundle);
    expect(v.valid).toBe(false);
    expect(
      v.issues.some(
        (i) => i.code === "delivery/unsafe-path" || i.code === "delivery/manifest-schema",
      ),
    ).toBe(true);
    // the outside file was never read/hashed as if it were part of the bundle
    expect(
      v.issues.every((i) => i.path !== "../outside.txt" || i.code !== "delivery/hash-mismatch"),
    ).toBe(true);
  });

  it("verifyManifest rejects a duplicate entry path", () => {
    rewriteManifest((entries) => {
      const first = entries[0];
      if (first) entries.push({ ...first });
    });
    const v = verifyManifest(bundle);
    expect(v.valid).toBe(false);
    expect(v.issues.some((i) => i.code === "delivery/duplicate-path")).toBe(true);
  });

  it("a legitimate bundle still verifies clean", () => {
    expect(verifyManifest(bundle).valid).toBe(true);
  });
});
