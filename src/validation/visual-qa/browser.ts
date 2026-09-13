/**
 * The Playwright / Chromium boundary.
 *
 * Nothing here knows about decks or findings — it launches a locked-down
 * Chromium, opens a page with a normalized environment, wires runtime
 * observers, and loads the self-contained HTML with `page.setContent` (no
 * server, no filesystem, no expected network).
 *
 * Security: no `--disable-web-security`, no `--allow-file-access-from-files`,
 * no `--no-sandbox`. If a CI host genuinely needs `--no-sandbox`, it is opt-in
 * via `ARCLUME_VISUAL_QA_NO_SANDBOX=1` and is recorded, never silent.
 */

import type { Browser, BrowserContext, ConsoleMessage, Dialog, Page, Request } from "playwright";
import { VisualQaError } from "../../errors.js";
import type { Viewport } from "./types.js";

// `playwright` is an optional (dev) dependency: importing `arclume` must not
// require it. Only `runVisualQa` pulls it in, lazily.
async function loadChromium(): Promise<typeof import("playwright").chromium> {
  try {
    const mod = await import("playwright");
    return mod.chromium;
  } catch (cause) {
    throw new VisualQaError("the optional 'playwright' package is not installed", {
      code: "visual/playwright-missing",
      hint: "npm i -D playwright && npx playwright install chromium",
      cause,
    });
  }
}

export interface RuntimeObservations {
  /** `METHOD url` for every http(s)/ws(s) request the page attempted. */
  networkRequests: string[];
  /** Text of every `console.error(...)` call. */
  consoleErrors: string[];
  /** Message of every uncaught page error. */
  pageErrors: string[];
  /** `type: message` for every `alert` / `confirm` / `prompt` / `beforeunload`. */
  dialogs: string[];
}

const REMOTE_SCHEME_RE = /^(https?|wss?):/i;

export async function launchChromium(opts: { channel?: string } = {}): Promise<Browser> {
  const chromium = await loadChromium();
  const args: string[] = [];
  if (process.env["ARCLUME_VISUAL_QA_NO_SANDBOX"] === "1") {
    args.push("--no-sandbox");
  }
  try {
    return await chromium.launch({
      headless: true,
      ...(opts.channel !== undefined ? { channel: opts.channel } : {}),
      args,
    });
  } catch (cause) {
    throw new VisualQaError("could not launch headless Chromium for Visual QA", {
      code: "visual/browser-launch",
      hint: "run `npx playwright install chromium` (CI: `npx playwright install --with-deps chromium`)",
      cause,
    });
  }
}

/** A context normalized so screenshots + geometry are reproducible. */
export async function newNormalizedContext(
  browser: Browser,
  viewport: Viewport,
): Promise<BrowserContext> {
  return browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    colorScheme: "light",
    reducedMotion: "reduce",
    forcedColors: "none",
    locale: "en-US",
    timezoneId: "UTC",
    bypassCSP: false,
    javaScriptEnabled: true,
  });
}

/** Attach network / console / pageerror / dialog observers to a page. */
export function observe(page: Page): RuntimeObservations {
  const obs: RuntimeObservations = {
    networkRequests: [],
    consoleErrors: [],
    pageErrors: [],
    dialogs: [],
  };

  page.on("request", (req: Request) => {
    const url = req.url();
    if (REMOTE_SCHEME_RE.test(url)) {
      obs.networkRequests.push(`${req.method()} ${url}`);
    }
  });
  page.on("requestfailed", (req: Request) => {
    const url = req.url();
    if (REMOTE_SCHEME_RE.test(url) && !obs.networkRequests.some((r) => r.endsWith(url))) {
      obs.networkRequests.push(`${req.method()} ${url}`);
    }
  });
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") obs.consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err: Error) => {
    obs.pageErrors.push(err?.message ? err.message : String(err));
  });
  page.on("dialog", (dialog: Dialog) => {
    obs.dialogs.push(`${dialog.type()}: ${dialog.message()}`);
    // Dismiss immediately so the page never hangs waiting on a modal.
    void dialog.dismiss().catch(() => undefined);
  });

  return obs;
}

/**
 * Load the self-contained document and wait for fonts. `setContent` keeps the
 * base URL at `about:blank`, so any real http(s)/ws(s) request is unambiguously
 * the deck trying to reach the network.
 */
export async function loadDeckHtml(page: Page, html: string, timeoutMs: number): Promise<void> {
  await page.setContent(html, { waitUntil: "load", timeout: timeoutMs });
  await page.evaluate(async () => {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts && typeof fonts.ready?.then === "function") {
      await fonts.ready;
    }
  });
}
