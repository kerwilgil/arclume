/**
 * `arclume build <knowledge.json|dir>` — ProjectKnowledge → HTML / PDF / PPTX.
 *
 * PDF/PPTX are published as Phase 8 export BUNDLES (artifact + receipt,
 * atomic rename). HTML is the canonical self-contained document.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { buildDeckPptx, publishExportBundle } from "../export/index.js";
import { renderDeckPdf } from "../export/pdf.js";
import type { DeckTypeName } from "../narrative/deck-types.js";
import type { AudienceName } from "../narrative/types.js";
import { readKnowledgeArtifact, writeHtmlArtifact } from "../pipeline/artifacts.js";
import type { CanonicalDeckRenderInput } from "../pipeline/canonical-render.js";
import { runDeck } from "../pipeline/run.js";
import { renderHtml } from "../pipeline/run.js";
import type { ProjectKnowledge } from "../types/knowledge.js";
import { validateProjectKnowledge } from "../validation/validator.js";
import { CliUsageError, type ParsedArgs, multiValue, parseArgs, singleValue } from "./args.js";
import { formatIssues } from "./issues.js";
import type { CliIo } from "./output.js";
import { warnAll } from "./output.js";
import { PRESET_IDS, getPreset, resolveAudienceFlag, resolveDeckTypeFlag } from "./presets.js";

export const BUILD_FLAGS = {
  valueFlags: ["audience", "deck-type", "preset", "theme", "format", "out"],
  booleanFlags: ["json", "quiet", "verbose"],
} as const;

export type ExportFormat = "html" | "pdf" | "pptx";

export interface BuildCommandResult {
  kind: "build";
  outputDir: string;
  slides: number;
  audience: string;
  deckType?: string;
  theme: string;
  html?: string;
  pdf?: { bundle: string; artifact: string; receipt: string; exportId: string };
  pptx?: { bundle: string; artifact: string; receipt: string; exportId: string };
  warnings: string[];
}

/** Load and schema-validate a ProjectKnowledge from a file or artifact dir. */
export function loadKnowledge(inputPath: string, cwd: string): ProjectKnowledge {
  const abs = resolve(cwd, inputPath);
  if (!existsSync(abs)) throw new CliUsageError(`knowledge input "${inputPath}" does not exist`);
  const knowledge = statSync(abs).isDirectory()
    ? readKnowledgeArtifact(abs)
    : (JSON.parse(readFileSync(abs, "utf8")) as ProjectKnowledge);
  const validation = validateProjectKnowledge(knowledge);
  if (!validation.valid) {
    throw new CliUsageError(
      `knowledge input "${inputPath}" failed schema validation`,
      formatIssues(validation.errors),
    );
  }
  return knowledge;
}

export interface ResolvedBuildArgs {
  audience: AudienceName;
  deckType?: DeckTypeName;
  theme: "minimal" | "executive";
  presetId?: string;
}

/**
 * Resolve the build arguments. A `preset` maps to an audience + theme; a plain
 * `--audience` overrides the audience alone; `--deck-type` layers on top of
 * whatever audience resolved. Any conflict (preset + audience) resolves the
 * audience the preset chose and ignores the flag.
 */
export function resolveBuildArgs(parsed: ParsedArgs): ResolvedBuildArgs {
  const presetId = singleValue(parsed, "preset");
  const audienceFlag = singleValue(parsed, "audience");
  const deckTypeFlag = singleValue(parsed, "deck-type");
  const themeFlag = singleValue(parsed, "theme");
  let audienceName: AudienceName = "general";
  let themeName: "minimal" | "executive" = "minimal";

  if (presetId !== undefined) {
    const preset = getPreset(presetId);
    if (preset === undefined) {
      throw new CliUsageError(
        `unknown preset "${presetId}"`,
        `Available presets: ${PRESET_IDS.join(", ")}. Run: arclume presets`,
      );
    }
    audienceName = preset.audience;
    themeName = preset.theme;
  }
  if (audienceFlag !== undefined) {
    const resolved = resolveAudienceFlag(audienceFlag);
    if (resolved === undefined) {
      throw new CliUsageError(
        `unknown audience "${audienceFlag}"`,
        "Audiences: executive, technical, general, product, client, investor, internal-review.",
      );
    }
    audienceName = resolved;
  }
  if (themeFlag !== undefined) {
    if (themeFlag !== "minimal" && themeFlag !== "executive") {
      throw new CliUsageError(`unknown theme "${themeFlag}"`, "Themes: minimal, executive.");
    }
    themeName = themeFlag;
  }
  if (deckTypeFlag !== undefined) {
    const resolved = resolveDeckTypeFlag(deckTypeFlag);
    if (resolved === undefined) {
      throw new CliUsageError(
        `unknown deck-type "${deckTypeFlag}"`,
        "Deck types: project-overview, architecture-review, technical-deep-dive, executive-brief, proposal, status-report, migration-plan, product-overview, incident-postmortem.",
      );
    }
    return {
      audience: audienceName,
      theme: themeName,
      ...(presetId ? { presetId } : {}),
      deckType: resolved,
    };
  }
  return {
    audience: audienceName,
    theme: themeName,
    ...(presetId ? { presetId } : {}),
  };
}

export function resolveFormats(parsed: ParsedArgs): ExportFormat[] {
  const formats = multiValue(parsed, "format");
  const out: ExportFormat[] = [];
  const seen = new Set<ExportFormat>();
  for (const f of formats.length === 0 ? ["html"] : formats) {
    if (f !== "html" && f !== "pdf" && f !== "pptx") {
      throw new CliUsageError(`unknown format "${f}"`, "Formats: html, pdf, pptx.");
    }
    if (!seen.has(f)) {
      seen.add(f);
      out.push(f);
    }
  }
  return out;
}

export interface BuildProjectOptions {
  knowledge: ProjectKnowledge;
  formats: ExportFormat[];
  audience: AudienceName;
  /** Optional deck-type arc composed on top of the audience. */
  deckType?: DeckTypeName;
  theme: "minimal" | "executive";
  /** Output directory; must not already exist for bundle outputs. */
  outDir: string;
  /**
   * Write `deck.html` through a sibling-temp + rename instead of in place.
   * Used by `watch`: last-known-good must survive a partial write/crash.
   */
  atomicHtml?: boolean;
}

/** Fully write, then rename — a reader never sees a truncated file. */
function writeFileAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${basename(path)}.tmp-${process.pid}`);
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

/**
 * The shared build used by `build` and `watch`: deck → HTML → export bundles.
 * Bundles respect Phase 8 atomic publication (existing destination is fatal).
 */
export async function buildProject(opts: BuildProjectOptions): Promise<BuildCommandResult> {
  const deckOut = runDeck(opts.knowledge, {
    audience: opts.audience,
    ...(opts.deckType !== undefined ? { deckType: opts.deckType } : {}),
    theme: opts.theme,
  });
  const deck = deckOut.deck;
  const { html } = renderHtml(deck, {
    knowledge: opts.knowledge,
    narrative: deckOut.narrative,
    slidePlan: deckOut.slidePlan,
  });

  const warnings: string[] = [];

  const result: BuildCommandResult = {
    kind: "build",
    outputDir: opts.outDir,
    slides: deck.slides.length,
    audience: opts.audience,
    ...(opts.deckType !== undefined ? { deckType: opts.deckType } : {}),
    theme: opts.theme,
    warnings,
  };

  if (opts.formats.includes("html")) {
    const htmlPath = join(opts.outDir, "deck.html");
    if (opts.atomicHtml === true) {
      writeFileAtomic(htmlPath, html);
    } else {
      writeHtmlArtifact(htmlPath, html);
    }
    result.html = htmlPath;
  }
  if (opts.formats.includes("pdf")) {
    const { bytes, receipt } = await renderDeckPdf({ deck });
    warnings.push(...receipt.validation.warnings);
    const bundle = await publishExportBundle({
      destination: join(opts.outDir, "deck.pdf-export"),
      fileName: "deck.pdf",
      format: "pdf",
      artifact: bytes,
      receipt,
      renderInput: { deck } satisfies CanonicalDeckRenderInput,
    });
    result.pdf = {
      bundle: bundle.bundlePath,
      artifact: bundle.artifactPath,
      receipt: bundle.receiptPath,
      exportId: bundle.exportId,
    };
  }
  if (opts.formats.includes("pptx")) {
    const { bytes, receipt } = await buildDeckPptx({ deck });
    warnings.push(...receipt.validation.warnings);
    const bundle = await publishExportBundle({
      destination: join(opts.outDir, "deck.pptx-export"),
      fileName: "deck.pptx",
      format: "pptx",
      artifact: bytes,
      receipt,
      renderInput: { deck },
    });
    result.pptx = {
      bundle: bundle.bundlePath,
      artifact: bundle.artifactPath,
      receipt: bundle.receiptPath,
      exportId: bundle.exportId,
    };
  }
  return result;
}

export async function runBuildCommand(argv: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArgs(argv, BUILD_FLAGS);
  const jsonMode = parsed.booleans.has("json");

  const input = parsed.positionals[0];
  if (input === undefined) {
    throw new CliUsageError(
      "build requires a ProjectKnowledge file or artifact directory",
      "Example: arclume build project-knowledge.json --audience technical --deck-type architecture-review --format html,pdf",
    );
  }

  const buildArgs = resolveBuildArgs(parsed);
  const formats = resolveFormats(parsed);
  const outDir = resolve(io.cwd(), singleValue(parsed, "out") ?? "arclume-output");
  const knowledge = loadKnowledge(input, io.cwd());
  const result = await buildProject({
    knowledge,
    formats,
    audience: buildArgs.audience,
    ...(buildArgs.deckType !== undefined ? { deckType: buildArgs.deckType } : {}),
    theme: buildArgs.theme,
    outDir,
  });
  warnAll(io, result.warnings);

  void buildArgs.presetId;
  if (jsonMode) {
    io.stdout(JSON.stringify({ ok: true, command: "build", ...result }));
  } else if (!parsed.booleans.has("quiet")) {
    io.stdout(`outputs in: ${result.outputDir}`);
    if (result.html !== undefined) io.stdout(`HTML:        ${result.html}`);
    if (result.pdf !== undefined) {
      io.stdout(`PDF bundle:  ${result.pdf.bundle}  (exportId ${result.pdf.exportId})`);
      io.stdout(`  receipt:   ${result.pdf.receipt}`);
    }
    if (result.pptx !== undefined) {
      io.stdout(`PPTX bundle: ${result.pptx.bundle}  (exportId ${result.pptx.exportId})`);
      io.stdout(`  receipt:   ${result.pptx.receipt}`);
    }
  }
  return 0;
}
