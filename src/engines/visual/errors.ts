/**
 * ARCLUME Visual Engine error model.
 *
 * Error codes are stable identifiers. Two classes:
 *
 *  - **Fallbackable** (environment / capacity): the resolver may turn them
 *    into a loud `native-fallback` artifact.
 *      - `visual-engine/unsupported-diagram`
 *      - `visual-engine/layout-capacity`
 *      - `visual-engine/engine-unavailable`
 *      - `visual-engine/render-failed`
 *
 *  - **Fatal** (integrity / security): never a fallback — no silent degradation
 *    of trust.
 *      - `visual-engine/adapter-invalid-input`
 *      - `visual-engine/output-invalid`
 *      - `visual-engine/unsafe-output`
 *      - `visual-engine/topology-mismatch`
 *      - `visual-engine/provenance-loss`
 *      - `visual-engine/order-mismatch`
 */

import { RenderError } from "../../errors.js";

export const VISUAL_ENGINE_ERROR_CODES = [
  "visual-engine/adapter-invalid-input",
  "visual-engine/unsupported-diagram",
  "visual-engine/layout-capacity",
  "visual-engine/engine-unavailable",
  "visual-engine/render-failed",
  "visual-engine/output-invalid",
  "visual-engine/unsafe-output",
  "visual-engine/topology-mismatch",
  "visual-engine/provenance-loss",
  "visual-engine/order-mismatch",
  "visual-engine/fallback-native",
] as const;

export type VisualEngineErrorCode = (typeof VISUAL_ENGINE_ERROR_CODES)[number];

/** Codes the resolver may turn into a `native-fallback` artifact. */
export const VISUAL_ENGINE_FALLBACKABLE_CODES: ReadonlySet<string> = new Set([
  "visual-engine/unsupported-diagram",
  "visual-engine/layout-capacity",
  "visual-engine/engine-unavailable",
  "visual-engine/render-failed",
]);

export class VisualEngineError extends RenderError {
  readonly diagramId?: string;

  constructor(code: VisualEngineErrorCode, message: string, diagramId?: string, cause?: unknown) {
    super(message, {
      code,
      ...(cause !== undefined ? { cause } : {}),
    });
    if (diagramId !== undefined) this.diagramId = diagramId;
  }
}

export function isFallbackableVisualEngineCode(code: string): boolean {
  return VISUAL_ENGINE_FALLBACKABLE_CODES.has(code);
}
