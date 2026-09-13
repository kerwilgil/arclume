/**
 * `arclume watch <path>` — filesystem watch → debounce → reanalyze → rebuild.
 *
 * Safety contract:
 *  - paths only; URLs are refused (no polling, no network);
 *  - self-trigger immune: a change under the output directory, any
 *    `*staging*` sibling or an ignored segment never schedules a rebuild;
 *  - node_modules/.git/dist/… ignored, plus the ingestion denylist already;
 *  - LAST-KNOWN-GOOD: a failed rebuild never removes the previous output
 *    (the HTML string is fully computed before any write happens);
 *  - SIGINT/SIGTERM close the watcher and exit 0 with no stack.
 */

import { type FSWatcher, watch } from "node:fs";
import { existsSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { StubReasoner } from "../analysis/reasoners/stub.js";
import type { AudienceName } from "../narrative/types.js";
import { analyzePrepared, buildKnowledge, prepareAnalysis } from "../pipeline/run.js";
import { CliUsageError, type ParsedArgs, parseArgs, singleValue } from "./args.js";
import { buildProject } from "./build.js";
import type { CliIo } from "./output.js";
import { PRESET_IDS, getPreset } from "./presets.js";

export const WATCH_FLAGS = {
  valueFlags: ["preset", "audience", "out", "debounce-ms", "reasoner"],
  booleanFlags: ["json", "quiet", "verbose"],
} as const;

const IGNORED_SEGMENTS = new Set(["node_modules", ".git", ".hg", ".svn", "dist"]);

export const DEFAULT_WATCH_DEBOUNCE_MS = 150;

function relOf(root: string, filename: string | null): string {
  if (filename === null) return "";
  return relative(root, resolve(root, filename)).split(sep).join("/");
}

/** True when this watch event must NOT schedule a rebuild. */
export function isIgnoredWatchEvent(rel: string, outDirAbs: string, rootAbs: string): boolean {
  if (rel === "") return true;
  if (rel.split("/").some((s) => IGNORED_SEGMENTS.has(s))) return true;
  const outRel = relative(rootAbs, outDirAbs).split(sep).join("/");
  if (
    outRel !== "" &&
    !outRel.startsWith("..") &&
    (rel === outRel || rel.startsWith(`${outRel}/`))
  ) {
    return true;
  }
  return rel.toLowerCase().includes("staging");
}

export interface WatchDeps {
  /** Test hook: called once the watcher is armed. */
  onArmed?: (rebuildTrigger: () => void) => void;
  /** Test hook: called after every rebuild attempt (`true` = success). */
  onRebuilt?: (ok: boolean) => void;
}

export async function runWatchCommand(
  argv: readonly string[],
  io: CliIo,
  deps: WatchDeps = {},
): Promise<number> {
  const parsed = parseArgs(argv, WATCH_FLAGS);
  return watchWith(parsed, io, deps);
}

export async function watchWith(
  parsed: ParsedArgs,
  io: CliIo,
  deps: WatchDeps = {},
): Promise<number> {
  const input = parsed.positionals[0];
  if (input === undefined) {
    throw new CliUsageError(
      "watch requires a project path",
      "Example: arclume watch ./project --preset executive",
    );
  }
  if (/^https?:\/\//i.test(input)) {
    throw new CliUsageError(
      "watch does not accept URLs",
      "Watching a URL would imply network polling — not supported.",
    );
  }

  // Watch is EXPLICITLY an offline heuristic workflow: the only accepted
  // reasoner spelling is `--reasoner stub`; nothing else is honest about what
  // the loop actually runs. It never calls agents/providers/SDKs.
  if (singleValue(parsed, "reasoner") === undefined) {
    throw new CliUsageError(
      "watch requires an explicit reasoning mode",
      "Watch can only perform automatic offline heuristic analysis.\nUse --reasoner stub explicitly.\nFor agent-grade analysis use the prepare/analysis-result workflow.",
    );
  }
  if (singleValue(parsed, "reasoner") !== "stub") {
    throw new CliUsageError(
      `watch reasoner "${singleValue(parsed, "reasoner") ?? ""}" is not supported`,
      "Watch can only perform automatic offline heuristic analysis.\nUse --reasoner stub explicitly.\nFor agent-grade analysis use the prepare/analysis-result workflow.",
    );
  }
  const root = resolve(io.cwd(), input);
  if (!existsSync(root)) throw new CliUsageError(`watch root "${input}" does not exist`);

  const outDir = resolve(io.cwd(), singleValue(parsed, "out") ?? "arclume-output");
  if (outDir === root) {
    throw new CliUsageError(
      "watch output cannot be the watched root itself",
      "Choose a dedicated output directory (e.g. ./arclume-output) outside the watched tree.",
    );
  }
  {
    // An output dir that CONTAINS the watch root makes every rebuild a source
    // event and vice versa — refuse the ambiguous geometry.
    const rel = relative(outDir, root).split(sep).join("/");
    if (rel !== "" && !rel.startsWith("..") && rel !== root) {
      throw new CliUsageError(
        "watch output directory cannot be an ancestor of the watched root",
        "The output dir would swallow its own rebuild events; give it a dedicated sibling path.",
      );
    }
  }

  const presetId = singleValue(parsed, "preset") ?? "general";
  const preset = getPreset(presetId);
  if (preset === undefined) {
    throw new CliUsageError(`unknown preset "${presetId}"`, `Available: ${PRESET_IDS.join(", ")}.`);
  }
  const audienceOverride = singleValue(parsed, "audience");
  if (
    audienceOverride !== undefined &&
    audienceOverride !== "executive" &&
    audienceOverride !== "technical" &&
    audienceOverride !== "general"
  ) {
    throw new CliUsageError(
      `unknown audience "${audienceOverride}"`,
      "Audiences: executive, technical, general.",
    );
  }
  const audience: AudienceName = (audienceOverride ?? preset.audience) as AudienceName;
  const debounceRaw = Number(singleValue(parsed, "debounce-ms") ?? DEFAULT_WATCH_DEBOUNCE_MS);
  const debounceMs =
    Number.isFinite(debounceRaw) && debounceRaw >= 0 ? debounceRaw : DEFAULT_WATCH_DEBOUNCE_MS;

  let building = false;
  let queued = false;
  const rebuild = async (): Promise<void> => {
    if (building) {
      queued = true;
      return;
    }
    building = true;
    try {
      const prepared = await prepareAnalysis([{ kind: "path", path: root }]);
      const analyzed = await analyzePrepared(prepared, new StubReasoner());
      const built = buildKnowledge(analyzed);
      await buildProject({
        knowledge: built.knowledge,
        formats: ["html"],
        audience,
        theme: preset.theme,
        outDir,
        atomicHtml: true,
      });
      deps.onRebuilt?.(true);
      io.stderr("watch: rebuilt ✓");
    } catch (err) {
      // LAST-KNOWN-GOOD: the previous output was not touched; watch continues.
      deps.onRebuilt?.(false);
      io.stderr(`watch: rebuild failed (previous output kept): ${(err as Error).message}`);
    } finally {
      building = false;
      if (queued) {
        queued = false;
        await rebuild();
      }
    }
  };

  let pending: ReturnType<typeof setTimeout> | undefined;
  const schedule = (): void => {
    if (pending !== undefined) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = undefined;
      void rebuild();
    }, debounceMs);
  };

  let watcher: FSWatcher;
  try {
    watcher = watch(root, { recursive: true }, (_event, filename) => {
      if (isIgnoredWatchEvent(relOf(root, filename), outDir, root)) return;
      schedule();
    });
  } catch (err) {
    throw new CliUsageError(`cannot watch "${root}": ${(err as Error).message}`);
  }

  io.stderr(`watch: listening on ${root} (preset ${preset.id}, out ${outDir})`);
  io.stderr(
    "warning: analysis/stub-reasoner — watch uses heuristic offline analysis, not agent-grade reasoning",
  );
  deps.onArmed?.(schedule);

  await new Promise<void>((done) => {
    const stop = (): void => {
      watcher.close();
      if (pending !== undefined) clearTimeout(pending);
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
      io.stderr("watch: stopped");
      done();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
  return 0;
}
