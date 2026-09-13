/**
 * Screenshot comparison for visual regression.
 *
 * `pixelmatch` + `pngjs` — small, dependency-light. This is deliberately *not*
 * a committed-golden system: a raster is only comparable within the same
 * browser build + platform + config (see docs/VISUAL_QA.md, "cross-platform").
 */

import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export interface DiffOptions {
  /** pixelmatch per-pixel colour distance threshold, 0..1. Default 0.1. */
  threshold?: number;
  /** Count anti-aliased pixels as differences. Default `false`. */
  includeAA?: boolean;
  /** Max fraction of differing pixels still considered a pass. Default 0 (exact). */
  maxRatio?: number;
  /** Also return a PNG buffer highlighting the differences. Default `false`. */
  emitDiffImage?: boolean;
}

export interface DiffResult {
  width: number;
  height: number;
  totalPixels: number;
  /** `-1` when the two images have different dimensions (incomparable). */
  differentPixels: number;
  ratio: number;
  pass: boolean;
  sizeMismatch: boolean;
  diffImage?: Buffer;
}

export function compareScreenshots(
  expected: Buffer,
  actual: Buffer,
  options: DiffOptions = {},
): DiffResult {
  const a = PNG.sync.read(expected);
  const b = PNG.sync.read(actual);

  if (a.width !== b.width || a.height !== b.height) {
    return {
      width: Math.max(a.width, b.width),
      height: Math.max(a.height, b.height),
      totalPixels: 0,
      differentPixels: -1,
      ratio: 1,
      pass: false,
      sizeMismatch: true,
    };
  }

  const { width, height } = a;
  const diff = new PNG({ width, height });
  const different = pixelmatch(a.data, b.data, diff.data, width, height, {
    threshold: options.threshold ?? 0.1,
    includeAA: options.includeAA ?? false,
  });
  const total = width * height;
  const ratio = total > 0 ? different / total : 0;
  const maxRatio = options.maxRatio ?? 0;

  const result: DiffResult = {
    width,
    height,
    totalPixels: total,
    differentPixels: different,
    ratio,
    pass: different === 0 ? true : ratio <= maxRatio,
    sizeMismatch: false,
  };
  if (options.emitDiffImage) result.diffImage = PNG.sync.write(diff);
  return result;
}
