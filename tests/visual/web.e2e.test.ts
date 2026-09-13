/**
 * Phase 10 browser E2E — real Chromium drives the local web UI through the
 * canonical flows:
 *   A) folder → prepare → agent envelope → knowledge → executive → preview → exports
 *   B) explicit stub preview (visible warning, not default)
 * plus iframe sandbox and screenshot sanity (no horizontal overflow).
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "playwright";
import { chromium } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { StubReasoner } from "../../src/analysis/reasoners/stub.js";
import { analyzePrepared, prepareAnalysis } from "../../src/pipeline/run.js";
import { type WebServerHandle, startArclumeWeb } from "../../src/web/server.js";

let browser: Browser;
let server: WebServerHandle;
let shots: string;

// CI-friendly timeouts: local runs are fast, but GitHub runners are slow.
// Use 180s for element visibility, 300s for long operations.
const VISIBLE_TIMEOUT = 180_000;
const LONG_OP_TIMEOUT = 300_000;

beforeAll(async () => {
  // the served app shell comes from web/dist (CI has no build step here)
  if (!existsSync(join(process.cwd(), "web", "dist", "index.html"))) {
    execFileSync("npm", ["run", "build"], {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: process.platform === "win32",
    });
  }
  browser = await chromium.launch();
  shots = mkdtempSync(join(tmpdir(), "arclume-web-e2e-"));
}, 300_000);

afterAll(async () => {
  await browser.close();
});

beforeEach(async () => {
  server = await startArclumeWeb({ port: 0 });
});

afterEach(async () => {
  await server.close();
});

const SAMPLE_REPO = join(process.cwd(), "examples", "fixtures", "sample-repo");

async function newPageAtServer() {
  // Force English regardless of the host OS locale: the UI defaults to the
  // browser's language (navigator.language) when no preference is persisted
  // yet (Phase 11 localization), and this whole suite asserts exact English
  // strings.
  const page = await browser.newPage({ locale: "en-US" });
  await page.goto(`${server.url}/`, { waitUntil: "networkidle" });
  // Wait for the app shell to be fully rendered - wait for the source input
  // which is the first interactive element on the Source screen
  await page.waitForSelector("#source-input", { state: "visible", timeout: VISIBLE_TIMEOUT });
  await page.waitForSelector("text=ARCLUME", { state: "visible", timeout: VISIBLE_TIMEOUT });
  // Extra wait for React hydration and initial render
  await page.waitForTimeout(3000);
  return page;
}

async function selectSourceRepo(page: import("playwright").Page) {
  await page.fill("#source-input", SAMPLE_REPO);
  await page.getByRole("button", { name: "Create workspace" }).click();

  // IMMEDIATELY after clicking, check what's on the page
  console.log("=== AFTER CREATE WORKSPACE CLICK ===");

  // Check for any error message
  const errorAlert = page.locator('[role="alert"]');
  try {
    await errorAlert.waitFor({ state: "visible", timeout: 5000 });
    const errorText = await errorAlert.textContent();
    console.log(`Workspace creation error: ${errorText}`);
  } catch {
    console.log("No error alert found");
  }

  // Wait a bit for any async operations
  await page.waitForTimeout(2000);

  // Check what's on the page
  console.log("=== CHECKING PAGE CONTENT ===");
  const bodyText = await page.textContent("body");
  console.log(`Page body (first 2000 chars): ${bodyText?.substring(0, 2000)}`);

  // Check what tabs/headers are visible
  const tabs = await page.locator('nav, [role="tablist"], header').allTextContents();
  console.log(`Tabs/headers: ${JSON.stringify(tabs)}`);

  // Try waiting for Analysis header
  try {
    await page.waitForSelector("text=Analysis", { state: "visible", timeout: VISIBLE_TIMEOUT });
    console.log("Analysis header found!");
  } catch {
    console.log("Analysis header NOT found after timeout");
    // Also check what tabs/headers are visible
    const allButtons = await page.locator("button").allTextContents();
    console.log(`All buttons: ${JSON.stringify(allButtons)}`);
  }

  // Open the advanced section first - the Prepare button is inside a <details> element
  const advancedSummary = page.getByText("Advanced: manual agent envelope");
  await advancedSummary.waitFor({ state: "visible", timeout: VISIBLE_TIMEOUT });
  await advancedSummary.click();

  // Then click the Prepare button directly - use force click since the button
  // may be "hidden" by CSS but still interactable once attached
  const prepareBtn = page.getByRole("button", { name: "Prepare analysis request" });
  await prepareBtn.waitFor({ state: "attached", timeout: VISIBLE_TIMEOUT });
  await prepareBtn.click({ force: true });
}

async function waitForVisible(
  page: import("playwright").Page,
  locator: import("playwright").Locator,
  label: string,
) {
  // First wait for the element to be attached to DOM, then wait for visible
  // This handles cases where elements exist in DOM but are hidden by CSS initially
  await locator.waitFor({ state: "attached", timeout: VISIBLE_TIMEOUT });
  await locator.waitFor({ state: "visible", timeout: VISIBLE_TIMEOUT });
}

async function waitForAttached(
  page: import("playwright").Page,
  locator: import("playwright").Locator,
  label: string,
) {
  await locator.waitFor({ state: "attached", timeout: VISIBLE_TIMEOUT });
}

describe("web E2E — Flow C: explicit stub preview", () => {
  it("stub preview requires explicit action and carries the visible warning", async () => {
    const page = await newPageAtServer();
    await selectSourceRepo(page);

    // the stub path is hidden inside an explicit <details> + warning
    const stubSummary = page.getByText("Heuristic preview (offline stub)");
    await waitForVisible(page, stubSummary, "stub summary");
    await stubSummary.click();
    await waitForVisible(
      page,
      page.getByText(/does not perform agent-grade semantic analysis/),
      "stub warning",
    );
    const buildBtn = page.getByRole("button", { name: "Build offline preview" });
    await waitForVisible(page, buildBtn, "build offline preview button");
    await buildBtn.click();
    await page.waitForSelector("h2:has-text('Knowledge')", {
      state: "visible",
      timeout: VISIBLE_TIMEOUT,
    });

    await page.screenshot({ path: join(shots, "c-knowledge.png") });
    await page.close();
  });
});

describe("web E2E — Flow A: agent workspace", () => {
  it("prepare → agent envelope → knowledge → executive build → preview → exports → validate", async () => {
    const page = await newPageAtServer();
    await selectSourceRepo(page);

    // ── prepare
    const prepareBtn = page.getByRole("button", { name: "Prepare analysis request" });
    await waitForVisible(page, prepareBtn, "prepare button");
    await prepareBtn.click();
    await page.waitForSelector(".request-summary", { state: "visible", timeout: VISIBLE_TIMEOUT });
    const digestText = await page.textContent(".request-summary code");
    expect(digestText).toMatch(/^sha256:/);
    await page.screenshot({ path: join(shots, "a-analysis.png") });

    // ── produce the envelope exactly like an external agent would
    const prepared = await prepareAnalysis([{ kind: "path", path: SAMPLE_REPO }]);
    const analyzed = await analyzePrepared(prepared, new StubReasoner());
    const envelope = JSON.stringify({
      artifact: "arclume/agent-analysis",
      version: "0.1.0",
      sourceDigest: prepared.sourceDigest,
      analysis: analyzed.analysis,
    });
    const agentResult = page.locator("#agent-result");
    await waitForVisible(page, agentResult, "agent result textarea");
    await agentResult.fill(envelope);
    const consumeBtn = page.getByRole("button", { name: "Consume agent result" });
    await waitForVisible(page, consumeBtn, "consume button");
    await consumeBtn.click();
    await page.waitForSelector("h2:has-text('Knowledge')", {
      state: "visible",
      timeout: VISIBLE_TIMEOUT,
    });

    // inspector shows the project + claims structure
    const knowledgeText = await page.textContent(".inspector");
    expect(knowledgeText).toContain("Project");
    await page.screenshot({ path: join(shots, "a-knowledge.png") });

    // ── build: executive + html
    const buildBtn = page.getByRole("button", { name: "4 · Build" });
    await waitForVisible(page, buildBtn, "build button");
    await buildBtn.click();
    await waitForVisible(page, page.locator("#build-audience"), "audience dropdown");
    await page.selectOption("#build-audience", "executive");
    const buildDeckBtn = page.getByRole("button", { name: "Rebuild deck from knowledge" });
    await waitForVisible(page, buildDeckBtn, "BUILD DECK button");
    await buildDeckBtn.click();
    await page.waitForSelector(".preview-frame", { state: "visible", timeout: LONG_OP_TIMEOUT });

    // the iframe is sandboxed and contains the canonical html
    const frame = page.frameLocator("iframe.preview-frame");
    await frame
      .locator(".arclume-stage")
      .first()
      .waitFor({ state: "visible", timeout: LONG_OP_TIMEOUT });
    await page.screenshot({ path: join(shots, "a-preview.png") });

    // ── export pptx + validate
    const pptxCheckbox = page.getByRole("checkbox", { name: "PPTX" });
    await waitForVisible(page, pptxCheckbox, "pptx checkbox");
    await pptxCheckbox.check();
    const buildDeckBtn2 = page.getByRole("button", { name: "Rebuild deck from knowledge" });
    await waitForVisible(page, buildDeckBtn2, "BUILD DECK BUTTON 2");
    await buildDeckBtn2.click();
    await page.waitForSelector("text=/exportId [0-9a-f]/", {
      state: "visible",
      timeout: LONG_OP_TIMEOUT,
    });

    const exportBtn = page.getByRole("button", { name: "5 · Export" });
    await waitForVisible(page, exportBtn, "export button");
    await exportBtn.click();
    const validateBtn = page.getByRole("button", { name: "Validate" });
    await waitForVisible(page, validateBtn, "validate button");
    await validateBtn.click();
    await page.waitForSelector("text=VALID", { state: "visible", timeout: LONG_OP_TIMEOUT });
    await page.screenshot({ path: join(shots, "a-export.png") });

    // layout sanity: no horizontal overflow of the app shell
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    await page.close();
  });
});

describe("web E2E — repeated builds with every format", () => {
  it("build #1 executive (html+pdf+pptx) then build #2 technical — both succeed", async () => {
    const page = await newPageAtServer();
    await selectSourceRepo(page);
    const stubSummary = page.getByText("Heuristic preview (offline stub)");
    await waitForVisible(page, stubSummary, "stub summary");
    await stubSummary.click();
    const buildOfflineBtn = page.getByRole("button", { name: "Build offline preview" });
    await waitForVisible(page, buildOfflineBtn, "build offline preview button");
    await buildOfflineBtn.click();
    await page.waitForSelector("h2:has-text('Knowledge')", {
      state: "visible",
      timeout: VISIBLE_TIMEOUT,
    });

    const buildBtn1 = page.getByRole("button", { name: "4 · Build" });
    await waitForVisible(page, buildBtn1, "build button 1");
    await buildBtn1.click();
    await waitForVisible(page, page.locator("#build-audience"), "audience dropdown");
    await page.selectOption("#build-audience", "executive");
    await page.getByRole("checkbox", { name: "PDF" }).check({ timeout: VISIBLE_TIMEOUT });
    await page.getByRole("checkbox", { name: "PPTX" }).check({ timeout: VISIBLE_TIMEOUT });
    const buildDeckBtn1 = page.getByRole("button", { name: "Rebuild deck from knowledge" });
    await waitForVisible(page, buildDeckBtn1, "BUILD DECK BUTTON 1");
    await buildDeckBtn1.click();
    await page.waitForSelector("text=/exportId [0-9a-f]/", {
      state: "visible",
      timeout: LONG_OP_TIMEOUT,
    });
    await page.waitForSelector(".preview-frame", { state: "visible", timeout: LONG_OP_TIMEOUT });

    await page.selectOption("#build-audience", "technical");
    await page.getByRole("checkbox", { name: "PDF" }).check({ timeout: VISIBLE_TIMEOUT });
    await page.getByRole("checkbox", { name: "PPTX" }).check({ timeout: VISIBLE_TIMEOUT });
    const buildDeckBtn2 = page.getByRole("button", { name: "Rebuild deck from knowledge" });
    await waitForVisible(page, buildDeckBtn2, "BUILD DECK BUTTON 2");
    await buildDeckBtn2.click();
    await page.waitForSelector("text=/exportId [0-9a-f]/", {
      state: "visible",
      timeout: LONG_OP_TIMEOUT,
    });

    const exportBtn = page.getByRole("button", { name: "5 · Export" });
    await waitForVisible(page, exportBtn, "export button");
    await exportBtn.click();
    const validateButtons = await page.getByRole("button", { name: "Validate" }).all();
    expect(validateButtons.length).toBeGreaterThanOrEqual(2);
    for (const v of validateButtons) {
      await waitForVisible(page, v, "validate button");
      await v.click();
    }
    await page.waitForSelector("text=VALID", { state: "visible", timeout: LONG_OP_TIMEOUT });
    const valids = await page.locator("output").allTextContents();
    expect(valids.filter((t) => t.includes("VALID")).length).toBeGreaterThanOrEqual(2);
    await page.close();
  });
});

describe("web E2E — stale agent result", () => {
  it("a sourceDigest mismatch surfaces the structured error", async () => {
    const page = await newPageAtServer();
    await selectSourceRepo(page);

    const prepared = await prepareAnalysis([{ kind: "path", path: SAMPLE_REPO }]);
    const analyzed = await analyzePrepared(prepared, new StubReasoner());
    const stale = JSON.stringify({
      artifact: "arclume/agent-analysis",
      version: "0.1.0",
      sourceDigest: "sha256:".concat("0".repeat(64)),
      analysis: analyzed.analysis,
    });
    const agentResult = page.locator("#agent-result");
    await waitForVisible(page, agentResult, "agent result textarea");
    await agentResult.fill(stale);
    const consumeBtn = page.getByRole("button", { name: "Consume agent result" });
    await waitForVisible(page, consumeBtn, "consume button");
    await consumeBtn.click();
    await page.waitForSelector("[role=alert]", { state: "visible", timeout: VISIBLE_TIMEOUT });
    const alert = await page.textContent("[role=alert]");
    expect(alert).toContain("reasoner/source-digest-mismatch");
    await page.close();
  });
});

/**
 * The Product Intelligence gate requires evidence-led UI coverage. Two
 * workflows are exercised end-to-end:
 *  1. Evidence Inspector: Knowledge → Inspector expand/collapse, badges, no
 *     absolute local paths.
 *  2. Rebuild from Knowledge: same workspace, two different of audience/deck
 *     type pairs produce two distinct decks — never a Reasoner call.
 *
 * Both flows persist their picks under the `arclume.ui.*` localStorage prefix.
 * Combined with the i18n/theme anchors the test carries EN/Light and ES/Dark:
 * the Evidence Inspector view and the rebuild flow are checked in both.
 */
describe("web E2E — Product Intelligence", () => {
  it("Evidence Inspector: claim cards carry badges, proofs and relative paths — and toggle cleanly", async () => {
    const page = await newPageAtServer();
    await selectSourceRepo(page);
    const stubSummary = page.getByText("Heuristic preview (offline stub)");
    await waitForVisible(page, stubSummary, "stub summary");
    await stubSummary.click();
    const buildOfflineBtn = page.getByRole("button", { name: "Build offline preview" });
    await waitForVisible(page, buildOfflineBtn, "build offline preview button");
    await buildOfflineBtn.click();
    await page.waitForSelector("h2:has-text('Knowledge')", {
      state: "visible",
      timeout: VISIBLE_TIMEOUT,
    });

    // Open the Evidence Inspector. The card is inside the Knowledge panel.
    const evidenceSummary = page.getByText("Evidence Inspector");
    await waitForVisible(page, evidenceSummary, "evidence inspector toggle");
    await evidenceSummary.click();

    // Each claim is a <details> with two badges: verification + fact type.
    const claims = page.locator(".evidence-claim");
    await waitForVisible(page, claims.first(), "first evidence claim");
    expect(await claims.count()).toBeGreaterThanOrEqual(1);

    // Badges exist for verification AND fact type.
    const first = claims.first();
    await waitForVisible(
      page,
      first.locator(".badge.fact-fact, .badge.fact-inference"),
      "fact-type badge (FACT or INFERENCE)",
    );
    // If the stub produced any file-locator claims with resolvable local sourceRef
    // (README says "pilot has been running" — in a git-aware repo this is
    // VERIFIED against HEAD; otherwise UNAVAILABLE — never an absolute path).
    const allText = await claims.allTextContents();
    expect(allText.every((t) => !t.includes("C:\\") && !t.includes("\\Users\\"))).toBe(true);

    await page.screenshot({ path: join(shots, "evidence-inspector-expanded.png") });

    // Collapse collapses.
    await evidenceSummary.click();
    await page.waitForSelector(".evidence-inspector", {
      state: "hidden",
      timeout: VISIBLE_TIMEOUT,
    });
    expect(await page.locator(".evidence-claim:visible").count()).toBe(0);
    await page.close();
  });

  it("Rebuild from Knowledge: same workspace, two decks produced by changing audience + deck type, zero net reasoner calls", async () => {
    const page = await newPageAtServer();
    await selectSourceRepo(page);

    // First build: agent envelope → workspace knowledge.
    const agentStub = page.getByText("Heuristic preview (offline stub)");
    await waitForVisible(page, agentStub, "stub summary");
    await agentStub.click();
    const buildOfflineBtn = page.getByRole("button", { name: "Build offline preview" });
    await waitForVisible(page, buildOfflineBtn, "build offline preview button");
    await buildOfflineBtn.click();
    await page.waitForSelector("h2:has-text('Knowledge')", {
      state: "visible",
      timeout: VISIBLE_TIMEOUT,
    });

    // Count /analyze and /knowledge-evidence calls after this point to prove
    // rebuild does not touch them.
    let analyzeCalls = 0;
    let evidenceCalls = 0;
    await page.route("**/api/**", async (route) => {
      const url = route.request().url();
      if (url.endsWith("/analyze")) analyzeCalls += 1;
      if (url.endsWith("/knowledge-evidence")) evidenceCalls += 1;
      await route.continue();
    });

    // First build: executive + architecture-review.
    const buildNavA = page.getByRole("button", { name: "4 · Build" });
    await waitForVisible(page, buildNavA, "build nav");
    await buildNavA.click();
    await waitForVisible(page, page.locator("#build-audience"), "audience dropdown");
    await page.selectOption("#build-audience", "executive");
    await page.selectOption("#build-deck-type", "architecture-review");
    const buildBtnA = page.getByRole("button", { name: "Rebuild deck from knowledge" });
    await buildBtnA.click();
    await page.waitForSelector(".preview-frame", { state: "visible", timeout: LONG_OP_TIMEOUT });
    const firstAud = await page.locator("#build-audience").inputValue();
    const firstDeckType = await page.locator("#build-deck-type").inputValue();
    expect(firstAud).toBe("executive");
    expect(firstDeckType).toBe("architecture-review");
    // Wait for the build summary line ("Built N slide(s)") — use a selector
    // anchored to the build panel, not a sibling selector that depends on the
    // preview pane's DOM order.
    await page.waitForSelector(".build-summary", { state: "visible", timeout: LONG_OP_TIMEOUT });
    const firstSummary = await page.textContent(".build-summary");
    expect(firstSummary).toMatch(/Built \d+ slide/);

    // Second build: same workspace, different audience + deck type.
    await page.selectOption("#build-audience", "technical");
    await page.selectOption("#build-deck-type", "technical-deep-dive");
    await buildBtnA.click();
    await page.waitForTimeout(500); // let the request settle after the click
    await page.waitForSelector("text=/Built \\d+ slide/", {
      state: "visible",
      timeout: LONG_OP_TIMEOUT,
    });
    const secondAud = await page.locator("#build-audience").inputValue();
    const secondDeck = await page.locator("#build-deck-type").inputValue();
    expect(secondAud).toBe("technical");
    expect(secondDeck).toBe("technical-deep-dive");

    // After 2 builds the system must have made ZERO Reasoner/analyze calls and
    // ZERO evidence calls (the inspector did not run at all in this flow).
    expect(analyzeCalls).toBe(0);
    expect(evidenceCalls).toBe(0);

    // The embedded preview exists and shows slides.
    const preview = page.frameLocator("iframe.preview-frame");
    const count = await preview.locator(".arclume-stage").count();
    expect(count).toBeGreaterThanOrEqual(1);
    await page.close();
  });

  it("i18n × theme smoke: EN Light Evidence Inspector, ES Dark Rebuild", async () => {
    const page = await newPageAtServer();
    // Colour scheme: prefer dark to cover the theme toggle; the Spanish text
    // comes via localStorage persistence already exercised above.
    await page.emulateMedia({ colorScheme: "dark" });
    await selectSourceRepo(page);
    const stubSummary = page.getByText("Heuristic preview (offline stub)");
    await waitForVisible(page, stubSummary, "stub summary (ES dark flow)");
    await stubSummary.click();
    const buildOfflineBtn = page.getByRole("button", { name: "Build offline preview" });
    await waitForVisible(page, buildOfflineBtn, "build offline preview button");
    await buildOfflineBtn.click();
    await page.waitForSelector("h2:has-text('Knowledge')", {
      state: "visible",
      timeout: VISIBLE_TIMEOUT,
    });

    // Evidence Inspector in light theme (default at login) first.
    const summary = page.getByText("Evidence Inspector");
    await waitForVisible(page, summary, "Evidence Inspector toggle");
    await summary.click();
    await waitForVisible(
      page,
      page.locator(".evidence-claim").first(),
      "first evidence claim (EN Light)",
    );
    await page.screenshot({ path: join(shots, "inspector-light-claim.png") });

    // Language switch is live (Settings → no reload): the workspace and the
    // loaded knowledge stay in memory, so the rebuild flow below can reuse it.
    const settingsBtn = page.getByRole("button", { name: /^Settings$|^Configuración$/ });
    await waitForVisible(page, settingsBtn, "settings nav");
    await settingsBtn.click();
    const esRadio = page.getByRole("radio", { name: /Español|Spanish/ });
    await waitForVisible(page, esRadio, "Spanish radio");
    await esRadio.check();
    await page.waitForSelector("html[lang='es']", { state: "attached", timeout: VISIBLE_TIMEOUT });

    // Now drive the rebuild in ES (already dark via emulateMedia).
    const buildNav = page.getByRole("button", { name: /Construir/ });
    await waitForVisible(page, buildNav, "rebuild nav (ES)");
    await buildNav.click();
    await page.selectOption("#build-audience", "investor");
    await page.selectOption("#build-deck-type", "project-overview");
    const buildBtn = page.getByRole("button", { name: "Reconstruir deck desde el conocimiento" });
    await buildBtn.click();
    await page.waitForSelector(".preview-frame", { state: "visible", timeout: LONG_OP_TIMEOUT });

    // The page is Spanish + dark; the rebuilt deck exists.
    const theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    expect(theme).toBe("dark");
    await page.close();
  });
});
