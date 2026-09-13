import { mkdirSync } from "node:fs";
import { join } from "node:path";
// Capture the remaining official screenshots: diagram families (architecture,
// dataflow), audience/deck-type, and AI providers — against a knowledge that
// actually produces diagrams. Reuses the running local web server.
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3210";
const OUT = "docs/media/release-1.0";
const SAMPLE_REPO = "C:\\Users\\VOZSP\\Documents\\arclume\\examples\\fixtures\\sample-repo";
mkdirSync(OUT, { recursive: true });

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
  page.setDefaultTimeout(120000);
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("#source-input", { state: "visible" });

  const shot = (name) => page.screenshot({ path: join(OUT, name) });

  await page.fill("#source-input", SAMPLE_REPO);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.waitForTimeout(2000);
  await page.getByText("Advanced: manual agent envelope").click();
  await page.waitForTimeout(300);
  const stub = page.getByText("Heuristic preview (offline stub)");
  await stub.waitFor({ state: "visible" });
  await stub.click();
  await page.getByRole("button", { name: "Build offline preview" }).click();
  await page.waitForSelector("h2:has-text('Knowledge')", { state: "visible" });

  // audience + deck type picker (before building)
  await page.getByRole("button", { name: /^4 · Build$/ }).click();
  await page.waitForSelector("#build-audience", { state: "visible" });
  await page.selectOption("#build-audience", "executive");
  await page.selectOption("#build-deck-type", "project-overview");
  await shot("06-audience-deck-type.png");

  // technical + architecture-review to force an architecture diagram
  await page.selectOption("#build-audience", "technical");
  await page.selectOption("#build-deck-type", "architecture-review");
  await page.getByRole("button", { name: "Rebuild deck from knowledge" }).click();
  await page.waitForSelector("iframe.preview-frame", { state: "visible" });
  await page.waitForTimeout(2000);
  const frame = page.frameLocator("iframe.preview-frame");
  const svgCount = await frame.locator("svg").count();
  console.log("svg diagrams in architecture deck:", svgCount);

  // capture the preview (architecture) fully
  await shot("04-architecture.png");

  // dataflow: rebuild with a type that surfaces data flow
  await page.selectOption("#build-deck-type", "technical-deep-dive");
  await page.getByRole("button", { name: "Rebuild deck from knowledge" }).click();
  await page.waitForTimeout(2000);
  const svg2 = await frame.locator("svg").count();
  console.log("svg diagrams in deep-dive deck:", svg2);
  await shot("05-dataflow.png");

  // AI providers screen
  await page
    .getByRole("button", { name: /Settings|Settings/ })
    .first()
    .click();
  await page.waitForSelector("#settings-title, #ai-active-provider", { state: "visible" });
  await page.waitForTimeout(1000);
  await shot("08-ai-providers.png");

  // export screen (navigate, then screenshot)
  await page.getByRole("button", { name: /^5 · Export$/ }).click();
  await page.waitForTimeout(500);
  await shot("09-export.png");

  await browser.close();
  console.log("done");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
