/**
 * Deterministic "is this bytes-not-text" detection. No parsing, no execution.
 */

const SNIFF_BYTES = 8192;

/**
 * Heuristic: a buffer is treated as binary when it contains a NUL byte or has a
 * high ratio of non-text control bytes in its first {@link SNIFF_BYTES} bytes.
 *
 * Pure and deterministic for a given buffer.
 */
export function isProbablyBinary(buffer: Uint8Array): boolean {
  const len = Math.min(buffer.length, SNIFF_BYTES);
  if (len === 0) return false;

  let suspicious = 0;
  for (let i = 0; i < len; i += 1) {
    const byte = buffer[i] as number;
    if (byte === 0) return true;
    // allow tab(9), LF(10), FF(12), CR(13); flag other C0 controls
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) suspicious += 1;
  }
  return suspicious / len > 0.3;
}

/** Strip a UTF-8 BOM and normalize CRLF / lone CR to LF. */
export function normalizeText(raw: string): string {
  const noBom = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return noBom.replace(/\r\n?/g, "\n");
}

/** Count 1-based lines in already-normalized text. */
export function countLines(text: string): number {
  if (text.length === 0) return 0;
  let count = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) count += 1;
  }
  return count;
}
