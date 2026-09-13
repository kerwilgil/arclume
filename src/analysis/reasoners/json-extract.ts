/**
 * Extracts a single JSON object out of a raw model response, tolerating the
 * ways a text-completion-shaped provider commonly wraps its output even when
 * explicitly told not to: a fenced ```json ... ``` block, or leading/trailing
 * prose around the object. Never used as a substitute for schema validation —
 * only to recover the JSON syntax itself; every result is still fed to
 * `validateAnalysisResult` by the caller.
 */

export class JsonExtractionError extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message);
    this.name = "JsonExtractionError";
  }
}

const FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/i;

/** Throws {@link JsonExtractionError} if no JSON object can be recovered. */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new JsonExtractionError("response is empty", text);
  }

  const attempts: string[] = [trimmed];

  const fenceMatch = FENCE_RE.exec(trimmed);
  if (fenceMatch?.[1] !== undefined) {
    attempts.push(fenceMatch[1].trim());
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) {
    attempts.push(trimmed.slice(first, last + 1));
  }

  for (const candidate of attempts) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // try the next recovery strategy
    }
  }

  throw new JsonExtractionError(
    "could not extract a JSON object from the response (checked raw text, a fenced code block, and the outermost {...} slice)",
    text,
  );
}
