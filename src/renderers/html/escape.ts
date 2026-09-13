/**
 * Escaping helpers — the security spine of the HTML renderer.
 *
 * Every string that originates in the `ArclumeDeck` IR passes through one of
 * these before it reaches the output. Nothing from the deck is ever emitted as
 * raw HTML, raw SVG, a raw attribute value, or interpolated into CSS / JS.
 */

const NUL = String.fromCharCode(0);
const REPLACEMENT = String.fromCharCode(0xfffd);

/** HTML text-node / double-quoted-attribute escaping. Safe for SVG text too. */
export function escapeHtml(value: unknown): string {
  const s = typeof value === "string" ? value : String(value ?? "");
  let out = "";
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i] as string;
    switch (ch) {
      case "&":
        out += "&amp;";
        break;
      case "<":
        out += "&lt;";
        break;
      case ">":
        out += "&gt;";
        break;
      case '"':
        out += "&quot;";
        break;
      case "'":
        out += "&#39;";
        break;
      case NUL:
        // A NUL byte must never survive into the document.
        out += REPLACEMENT;
        break;
      default:
        out += ch;
    }
  }
  return out;
}

/** Alias kept for call-site clarity: attribute values use the same rules. */
export const escapeAttr = escapeHtml;

/**
 * A deck id is already constrained by the schema to `^[A-Za-z][A-Za-z0-9_-]*$`.
 * This re-checks it before it is used as an `id=` / `data-*` value or a URL
 * fragment, so a malformed IR can never inject an attribute break.
 */
const SAFE_ID_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
export function isSafeId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 128 && SAFE_ID_RE.test(value);
}

/** Space-joined list of ids, dropping anything that is not a safe id. */
export function safeIdList(values: readonly unknown[] | undefined): string {
  return (values ?? []).filter(isSafeId).join(" ");
}

/**
 * Allowlist for a code block's language hint. Returns a lowercased token safe to
 * place in `class="language-…"` / `data-language="…"`, or `undefined`.
 */
const LANG_RE = /^[A-Za-z0-9][A-Za-z0-9+#._-]{0,29}$/;
export function safeLanguage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return LANG_RE.test(trimmed) ? trimmed.toLowerCase() : undefined;
}

/**
 * Accept only a base64 raster-image data URI for an `<img src>`. SVG data URIs
 * are rejected on purpose (they can carry script when navigated to directly).
 * Everything remote (`http:`, `https:`, `file:`, protocol-relative) or a bare
 * filesystem path is rejected — the document must stay self-contained.
 */
const DATA_IMG_RE = /^data:image\/(png|jpe?g|gif|webp|avif|bmp);base64,[A-Za-z0-9+/]+={0,2}$/;
export function safeImageDataUri(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const compact = value.replace(/\s+/g, "");
  return DATA_IMG_RE.test(compact) ? compact : undefined;
}

/** Collapse runs of whitespace and trim — used for single-line contexts. */
export function oneLine(value: unknown): string {
  return (typeof value === "string" ? value : String(value ?? "")).replace(/\s+/g, " ").trim();
}
