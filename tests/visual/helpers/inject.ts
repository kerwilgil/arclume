/**
 * Surgical HTML injection for the positive-detector fixtures.
 *
 * These take an already-rendered, valid self-contained document and splice in a
 * deliberate defect (overflow, clipping, off-slide element, a network request, a
 * console error, a thrown error). The renderer is never re-run over the result —
 * the point is to prove Visual QA *catches* problems a real bug would produce.
 */

/** Insert markup just before the end of the first slide `<section>`. */
export function injectIntoFirstSlide(html: string, snippet: string): string {
  const open = html.indexOf('<section class="arclume-slide');
  if (open < 0) throw new Error("no slide section found");
  const close = html.indexOf("</section>", open);
  if (close < 0) throw new Error("no slide close found");
  return `${html.slice(0, close)}${snippet}${html.slice(close)}`;
}

/** Insert markup just before the end of the `<section>` with this `data-slide-id`. */
export function injectIntoSlide(html: string, slideId: string, snippet: string): string {
  const at = html.indexOf(`data-slide-id="${slideId}"`);
  if (at < 0) throw new Error(`no slide "${slideId}"`);
  const close = html.indexOf("</section>", at);
  if (close < 0) throw new Error("no slide close found");
  return `${html.slice(0, close)}${snippet}${html.slice(close)}`;
}

/** Insert markup just before `</head>`. */
export function injectIntoHead(html: string, snippet: string): string {
  return html.replace("</head>", `${snippet}</head>`);
}

/** Insert markup just before `</body>`. */
export function injectBeforeBodyEnd(html: string, snippet: string): string {
  return html.replace("</body>", `${snippet}</body>`);
}

/** A block-shaped element pushed far outside the slide bounds. */
export const OFF_SLIDE_SNIPPET =
  '<div class="arclume-block arclume-block-text" data-block-id="b-offscreen" data-block-type="text" style="position:absolute;left:-4000px;top:0;width:200px;height:80px">off</div>';

/** A block that clips its own text with overflow:hidden + a tiny fixed height. */
export const CLIP_SNIPPET =
  '<div class="arclume-block arclume-block-text" data-block-id="b-clipped" data-block-type="text" style="flex:none;overflow:hidden;height:14px;max-height:14px;width:120px;white-space:nowrap;text-overflow:clip">This sentence is far too long to fit inside a fourteen-pixel tall clipped box and will be cut off.</div>';

/**
 * A giant block that makes the whole slide overflow vertically. `min-height` +
 * `flex:none` so the slide's flex column cannot shrink it away.
 */
export const OVERFLOW_Y_SNIPPET =
  '<div class="arclume-block arclume-block-text" data-block-id="b-huge" data-block-type="text" style="flex:none;min-height:4000px;width:100px;background:#ddd">tall</div>';

/** An image whose src is a real http URL Chromium will try to fetch. */
export const NETWORK_SNIPPET =
  '<img alt="x" src="http://127.0.0.1:9/arclume-visual-qa-probe.png" width="1" height="1">';

/** A second script that logs a console error. */
export const CONSOLE_ERROR_SNIPPET =
  '<script>console.error("arclume visual-qa test console error")</script>';

/** A script that throws during load. */
export const PAGE_ERROR_SNIPPET =
  '<script>throw new Error("arclume visual-qa test page error")</script>';

/** A script that raises a dialog. */
export const DIALOG_SNIPPET = '<script>window.alert("arclume visual-qa test dialog")</script>';
