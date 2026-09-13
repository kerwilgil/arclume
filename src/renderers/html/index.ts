/**
 * HTML renderer + self-contained viewer (Phase 5).
 *
 * `ArclumeDeck` → one offline HTML file that opens in any modern browser and
 * presents the deck slide by slide, with keyboard + hash navigation, both
 * Phase 4 themes, all 16 block types and the native diagram kinds. No server,
 * no network, no framework. The renderer never alters deck semantics.
 */

export { renderDeckHtml } from "./renderer.js";
export { DECK_CSP } from "./document.js";
export { VIEWER_RUNTIME } from "./viewer-runtime.js";
export { keyMessageClass } from "./slides.js";
export { RENDERABLE_THEME_NAMES, isRenderableTheme } from "./theme.js";
export {
  assertRenderOutput,
  extractInlineScript,
  extractInlineStyle,
  ACTIVE_MARKUP_PATTERNS,
  SCRIPT_NETWORK_PATTERNS,
  STYLE_REMOTE_PATTERNS,
} from "./validation.js";
export {
  HTML_RENDERER_VERSION,
  type HtmlRenderContext,
  type HtmlRenderOptions,
  type HtmlRenderReport,
  type HtmlRenderResult,
  type HtmlRenderWarning,
} from "./types.js";
