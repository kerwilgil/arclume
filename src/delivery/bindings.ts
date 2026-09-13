/**
 * Delivery evidence preflight.
 *
 * `deliverAtomic` must not just check schemas and per-file hashes — it must
 * prove that the deck, the HTML, the `VisualQaResult`, the receipt and the
 * screenshot buffers all belong to **one coherent run**. `validateDeliveryBindings`
 * runs before any staging directory is created; any mismatch is fatal and
 * nothing is written.
 *
 * Caller-supplied booleans (`visualQa.valid`, `receipt.result.*`) are never
 * trusted on their own — they are recomputed from the findings and the buffers.
 *
 * Two bindings here are *semantic*, not just hash-consistency: the delivered
 * HTML must be the canonical deterministic render of the delivered deck
 * (`renderDeckHtml(deck).html === html`), and the Visual QA evidence must carry
 * the SHA-256 of that same HTML (`visualQa.input.htmlSha256`). Regenerating the
 * receipt hashes cannot satisfy either — `deliverAtomic` does not trust the
 * caller to have run `validateRenderedDeck` first.
 */

import { contentHash } from "../determinism/hash.js";
import { VISUAL_ENGINE_COMMIT, VISUAL_ENGINE_VENDORED } from "../engines/visual/index.js";
import { DeliveryError } from "../errors.js";
import { anyVisualEngineProduced } from "../pipeline/canonical-render.js";
import { renderCanonicalDeckHtml } from "../pipeline/canonical-render.js";
import { sha256Bytes, sha256Utf8 } from "../validation/visual-qa/util.js";
import { validateBundleRelativePath } from "./paths.js";
import type { DeliveryArtifactInput } from "./types.js";

function fail(code: string, message: string): never {
  throw new DeliveryError(message, { code });
}

interface Tally {
  errors: number;
  warnings: number;
  info: number;
}
function tallyFindings(findings: DeliveryArtifactInput["visualQa"]["findings"]): Tally {
  const t: Tally = { errors: 0, warnings: 0, info: 0 };
  for (const f of findings) {
    if (f.severity === "error") t.errors += 1;
    else if (f.severity === "warning") t.warnings += 1;
    else t.info += 1;
  }
  return t;
}

type ShotKey = string;
function shotKey(s: {
  viewport: string;
  slideId: string;
  index: number;
  kind: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  path: string;
}): ShotKey {
  return [
    s.viewport,
    s.slideId,
    s.index,
    s.kind,
    s.width,
    s.height,
    s.bytes,
    s.sha256,
    s.path,
  ].join("");
}

/**
 * Throws `DeliveryError` on the first broken binding. Deterministic and
 * filesystem-free (it renders the deck in-memory to compare against the HTML).
 */
export function validateDeliveryBindings(input: DeliveryArtifactInput): void {
  const { deck, html, visualQa, receipt, screenshots } = input;

  /* ---- deck ---- */
  if (receipt.deck.irVersion !== deck.irVersion) {
    fail(
      "delivery/deck-hash-mismatch",
      `receipt.deck.irVersion "${receipt.deck.irVersion}" != deck.irVersion "${deck.irVersion}"`,
    );
  }
  const expectedDeckHash = contentHash(deck).slice("sha256:".length);
  if (!receipt.deck.contentHash) {
    fail(
      "delivery/deck-hash-mismatch",
      "receipt.deck.contentHash is missing — a Phase 6 delivery must carry the deck content hash",
    );
  }
  if (receipt.deck.contentHash !== expectedDeckHash) {
    fail(
      "delivery/deck-hash-mismatch",
      "receipt.deck.contentHash does not match contentHash(deck) — deck and receipt are from different runs",
    );
  }

  /* ---- html ---- */
  const htmlHash = sha256Utf8(html);
  if (receipt.inputs.htmlSha256 !== htmlHash) {
    fail(
      "delivery/html-hash-mismatch",
      "receipt.inputs.htmlSha256 does not match SHA-256(html) — HTML and receipt are from different runs",
    );
  }

  /* ---- receipt engine metadata ↔ actual final engine usage (P1-3).
     The receipt may claim visual engine output iff at least one delivered artifact
     was actually produced by the visual engine (a full-fallback deck cannot claim it;
     a visual-engine-produced deck cannot omit or mislabel it). ---- */
  const visualEngineProduced = anyVisualEngineProduced(input.diagramArtifacts);
  const claimed = receipt.engines?.visual;
  if (visualEngineProduced) {
    if (claimed === undefined) {
      fail(
        "delivery/engine-receipt-mismatch",
        "the deck embeds visual-engine-produced diagrams but the receipt omits engines.visual",
      );
    } else if (
      claimed.version !== VISUAL_ENGINE_VENDORED ||
      claimed.commit !== VISUAL_ENGINE_COMMIT
    ) {
      fail(
        "delivery/engine-receipt-mismatch",
        `receipt.engines.visual (${claimed.version}@${claimed.commit}) does not match the vendored engine (${VISUAL_ENGINE_VENDORED}@${VISUAL_ENGINE_COMMIT})`,
      );
    }
  } else if (claimed !== undefined) {
    fail(
      "delivery/engine-receipt-mismatch",
      "the receipt claims visual engine output but no delivered artifact was produced by the visual engine",
    );
  }

  /* ---- deck ↔ html (semantic): the delivered HTML must BE the canonical
     deterministic render of the delivered deck — including its resolved
     diagram artifacts. A regenerated receipt makes the hashes
     self-consistent but cannot make a mixed deck+HTML pair coherent. ---- */
  let canonicalHtml: string;
  try {
    canonicalHtml = renderCanonicalDeckHtml({
      deck,
      diagramArtifacts: input.diagramArtifacts,
    }).html;
  } catch (cause) {
    // Diagram-artifact binding failures keep their precise codes.
    const causeCode = (cause as { code?: string }).code;
    if (typeof causeCode === "string" && causeCode.startsWith("delivery/diagram-artifact-")) {
      fail(causeCode, (cause as Error).message);
    }
    fail(
      "delivery/html-deck-mismatch",
      `input.deck does not render — the delivered HTML cannot be proven to be its canonical output: ${
        (cause as Error).message
      }`,
    );
  }
  if (html !== canonicalHtml) {
    fail(
      "delivery/html-deck-mismatch",
      "input.html is not the canonical render of input.deck (renderCanonicalDeckHtml({deck, diagramArtifacts}).html differs) — " +
        "the deck and the HTML are from different runs",
    );
  }

  /* ---- Visual QA input ↔ delivered html: the QA evidence must have been
     produced against this exact HTML, not merely a hash-compatible receipt. ---- */
  if (visualQa.input.htmlSha256 !== htmlHash) {
    fail(
      "delivery/qa-input-mismatch",
      "visualQa.input.htmlSha256 does not match SHA-256(html) — the Visual QA evidence was produced " +
        "against a different HTML than the one being delivered",
    );
  }

  /* ---- Visual QA identity ---- */
  if (receipt.visualQa.version !== visualQa.version) {
    fail(
      "delivery/evidence-mismatch",
      `receipt.visualQa.version "${receipt.visualQa.version}" != visualQa.version "${visualQa.version}"`,
    );
  }
  if (
    receipt.browser.name !== visualQa.browser.name ||
    receipt.browser.version !== visualQa.browser.version ||
    receipt.browser.platform !== visualQa.browser.platform
  ) {
    fail(
      "delivery/evidence-mismatch",
      "receipt.browser identity does not match visualQa.browser — evidence is from a different browser run",
    );
  }

  /* ---- result consistency ---- */
  const realTally = tallyFindings(visualQa.findings);
  if (
    realTally.errors !== visualQa.summary.errors ||
    realTally.warnings !== visualQa.summary.warnings ||
    realTally.info !== visualQa.summary.info
  ) {
    fail(
      "delivery/qa-summary-mismatch",
      `visualQa.summary {e:${visualQa.summary.errors},w:${visualQa.summary.warnings},i:${visualQa.summary.info}} does not match the actual findings tally {e:${realTally.errors},w:${realTally.warnings},i:${realTally.info}}`,
    );
  }
  if (visualQa.valid !== (visualQa.summary.errors === 0)) {
    fail(
      "delivery/qa-summary-mismatch",
      `visualQa.valid=${visualQa.valid} but summary.errors=${visualQa.summary.errors}`,
    );
  }
  if (
    receipt.result.valid !== visualQa.valid ||
    receipt.result.errors !== visualQa.summary.errors ||
    receipt.result.warnings !== visualQa.summary.warnings
  ) {
    fail(
      "delivery/receipt-mismatch",
      "receipt.result does not match the VisualQaResult (valid / errors / warnings)",
    );
  }

  /* ---- screenshot descriptors <-> buffers ---- */
  const seenPaths = new Set<string>();
  for (const shot of screenshots) {
    const p = validateBundleRelativePath(shot.path);
    if (!p.ok) {
      fail(
        "delivery/unsafe-path",
        `screenshot path "${shot.path}" is not a safe bundle path: ${p.reason}`,
      );
    }
    if (!shot.path.startsWith("screenshots/")) {
      fail("delivery/unsafe-path", `screenshot path "${shot.path}" is outside screenshots/`);
    }
    if (seenPaths.has(shot.path)) {
      fail("delivery/duplicate-path", `duplicate screenshot path "${shot.path}"`);
    }
    seenPaths.add(shot.path);

    const bytes = shot.buffer.length;
    const sha256 = sha256Bytes(shot.buffer);
    if (bytes !== shot.bytes) {
      fail(
        "delivery/screenshot-hash-mismatch",
        `screenshot "${shot.path}" descriptor says ${shot.bytes} bytes but the buffer is ${bytes}`,
      );
    }
    if (sha256 !== shot.sha256) {
      fail(
        "delivery/screenshot-hash-mismatch",
        `screenshot "${shot.path}" descriptor SHA-256 does not match its buffer`,
      );
    }
  }

  /* ---- VisualQaResult.screenshots <-> delivered artifacts (exact set) ---- */
  const artifactKeys = new Set(screenshots.map((s) => shotKey(s)));
  const resultKeys = new Set(visualQa.screenshots.map((s) => shotKey(s)));
  if (artifactKeys.size !== screenshots.length) {
    fail("delivery/screenshot-set-mismatch", "delivered screenshots contain a duplicate identity");
  }
  for (const k of resultKeys) {
    if (!artifactKeys.has(k)) {
      fail(
        "delivery/screenshot-set-mismatch",
        "visualQa.screenshots contains a descriptor with no matching delivered artifact (stale or extra)",
      );
    }
  }
  for (const k of artifactKeys) {
    if (!resultKeys.has(k)) {
      fail(
        "delivery/screenshot-set-mismatch",
        "a delivered screenshot artifact is not listed in visualQa.screenshots (missing descriptor)",
      );
    }
  }

  /* ---- receipt <-> slide screenshots (order-independent) ---- */
  const slideArtifacts = screenshots.filter((s) => s.kind === "slide");
  const receiptKey = (s: { slideId: string; sha256: string; bytes: number }): string =>
    `${s.slideId}${s.sha256}${s.bytes}`;
  const receiptSet = new Set(receipt.screenshots.map(receiptKey));
  const slideSet = new Set(slideArtifacts.map(receiptKey));
  if (receiptSet.size !== receipt.screenshots.length) {
    fail("delivery/receipt-mismatch", "receipt.screenshots contains a duplicate entry");
  }
  if (receiptSet.size !== slideSet.size) {
    fail(
      "delivery/receipt-mismatch",
      `receipt lists ${receiptSet.size} slide screenshot(s); ${slideSet.size} were delivered`,
    );
  }
  for (const k of slideSet) {
    if (!receiptSet.has(k)) {
      fail(
        "delivery/receipt-mismatch",
        "a delivered slide screenshot is not covered by receipt.screenshots (slideId / sha256 / bytes)",
      );
    }
  }
}
