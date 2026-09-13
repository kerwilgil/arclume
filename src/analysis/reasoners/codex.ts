/**
 * Codex — uses the caller's own already-authenticated CLI session, exactly
 * like {@link ClaudeCodeReasoner}: ARCLUME never reads, copies, or persists
 * its credentials.
 *
 * Invocation contract (verified against a real, currently installed
 * `codex-cli` 0.153.3 on this machine before being written; kept fully
 * overridable via config):
 *
 *   codex exec -s read-only --skip-git-repo-check --json --color never
 *     -o <temp-file> -
 *   (the combined system+user prompt fed over stdin; `-o` writes ONLY the
 *   final agent message to a plain text file — no event parsing needed for
 *   the happy path)
 *
 * `--json` additionally prints one JSON object per line to stdout for each
 * lifecycle event; on failure this adapter reads those for a `type: "error"`
 * / `"turn.failed"` event's `message` (or `error.message`) rather than
 * scraping human-readable prose — a real, observed failure shape (a usage
 * limit error) confirmed this during development.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReasonerError } from "../../errors.js";
import type {
  Reasoner,
  ReasonerCapabilities,
  ReasonerRequest,
  ReasonerResult,
} from "../reasoner.js";
import type { CliStatus } from "./claude-code.js";
import { CliNotFoundError, invokeCli } from "./cli-common.js";
import { type ChatPrompt, buildAnalysisPrompt } from "./prompt.js";
import { definedFields, validateAndWrap } from "./shared.js";

const CODEX_CANDIDATES = ["codex"] as const;
const DEFAULT_TIMEOUT_MS = 180_000;
const VERSION_TIMEOUT_MS = 8_000;

const AUTH_HINT_RE = /(not logged in|log ?in|authenticat|unauthorized|sign in|chatgpt account)/i;

interface CodexEvent {
  type?: string;
  message?: string;
  error?: { message?: string };
}

function parseJsonLines(stdout: string): CodexEvent[] {
  const events: CodexEvent[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      events.push(JSON.parse(trimmed) as CodexEvent);
    } catch {
      // not every line is guaranteed JSON (a stray banner, etc.) — skip it
    }
  }
  return events;
}

function findFailureMessage(events: CodexEvent[]): string | undefined {
  for (const event of events) {
    if (event.type === "error" && typeof event.message === "string") return event.message;
    if (event.type === "turn.failed" && typeof event.error?.message === "string")
      return event.error.message;
  }
  return undefined;
}

interface CodexRunOptions {
  model?: string;
  timeoutMs?: number;
}

interface CodexRunOutcome {
  outcome: "success" | "failure" | "not-installed" | "timeout";
  text?: string;
  failureMessage?: string;
}

async function runCodexOnce(prompt: string, options: CodexRunOptions): Promise<CodexRunOutcome> {
  const scratch = mkdtempSync(join(tmpdir(), "arclume-codex-"));
  const outFile = join(scratch, "last-message.txt");
  try {
    const args = [
      "exec",
      "-s",
      "read-only",
      "--skip-git-repo-check",
      "--json",
      "--color",
      "never",
      "-o",
      outFile,
    ];
    if (options.model) args.push("-m", options.model);
    args.push("-");

    let result: Awaited<ReturnType<typeof invokeCli>>;
    try {
      result = await invokeCli({
        candidates: CODEX_CANDIDATES,
        args,
        stdin: prompt,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
    } catch (err) {
      if (err instanceof CliNotFoundError) return { outcome: "not-installed" };
      throw err;
    }

    if (result.timedOut) return { outcome: "timeout" };

    const events = parseJsonLines(result.stdout);
    const failure = findFailureMessage(events);
    if (failure !== undefined || result.exitCode !== 0) {
      return {
        outcome: "failure",
        failureMessage: failure ?? firstChars(result.stderr || result.stdout, 400),
      };
    }

    let text: string;
    try {
      text = readFileSync(outFile, "utf8");
    } catch {
      return { outcome: "failure", failureMessage: "codex exec exited 0 but wrote no output file" };
    }
    return { outcome: "success", text };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** `codex --version` only — proves the CLI is installed and runnable. Use
 * {@link testCodexConnection} to also confirm it is authenticated. */
export async function detectCodex(): Promise<CliStatus> {
  try {
    const result = await invokeCli({
      candidates: CODEX_CANDIDATES,
      args: ["--version"],
      timeoutMs: VERSION_TIMEOUT_MS,
    });
    if (result.exitCode === 0) {
      return { state: "ready", message: "Codex CLI found", version: firstLine(result.stdout) };
    }
    return {
      state: "error",
      message: `codex --version exited with code ${result.exitCode}: ${firstLine(result.stderr || result.stdout)}`,
    };
  } catch (err) {
    if (err instanceof CliNotFoundError) {
      return { state: "not-installed", message: "Codex CLI (`codex`) not found on PATH" };
    }
    return { state: "error", message: (err as Error).message };
  }
}

/** A minimal real invocation — the only way to actually prove the session is
 * authenticated and usable, not just installed. */
export async function testCodexConnection(config: { model?: string } = {}): Promise<CliStatus> {
  try {
    const run = await runCodexOnce(
      "Reply with exactly one word: ok",
      definedFields({ model: config.model, timeoutMs: 30_000 }),
    );
    if (run.outcome === "not-installed") {
      return { state: "not-installed", message: "Codex CLI (`codex`) not found on PATH" };
    }
    if (run.outcome === "timeout") {
      return { state: "error", message: "Codex CLI timed out" };
    }
    if (run.outcome === "failure") {
      const message = run.failureMessage ?? "Codex CLI reported an error";
      if (AUTH_HINT_RE.test(message)) {
        return { state: "not-authenticated", message };
      }
      return { state: "error", message };
    }
    return { state: "ready", message: "Codex CLI is authenticated and ready" };
  } catch (err) {
    return { state: "error", message: (err as Error).message };
  }
}

export interface CodexConfig {
  model?: string;
  timeoutMs?: number;
  /** Defaults to the primary analysis prompt. Verified-mode reviewer duty
   * swaps this for `buildReviewerPrompt` bound to a candidate. */
  promptBuilder?: (request: ReasonerRequest) => ChatPrompt;
}

const CAPABILITIES: ReasonerCapabilities = {
  id: "codex",
  version: "0.1.0",
  deterministic: false,
  network: false, // ARCLUME itself makes no network call; the CLI subprocess does
};

export class CodexReasoner implements Reasoner {
  readonly capabilities = CAPABILITIES;
  readonly #config: CodexConfig;

  constructor(config: CodexConfig = {}) {
    this.#config = config;
  }

  async analyze(request: ReasonerRequest): Promise<ReasonerResult> {
    const prompt = (this.#config.promptBuilder ?? buildAnalysisPrompt)(request);
    const combined = `${prompt.system}\n\n---\n\n${prompt.user}`;

    let run: CodexRunOutcome;
    try {
      run = await runCodexOnce(
        combined,
        definedFields({
          model: this.#config.model,
          timeoutMs: this.#config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        }),
      );
    } catch (err) {
      throw new ReasonerError(`codex: ${(err as Error).message}`, {
        code: "reasoner/provider-unavailable",
        severity: "fatal",
        cause: err,
      });
    }

    if (run.outcome === "not-installed") {
      throw new ReasonerError("Codex CLI (`codex`) not found on PATH", {
        code: "reasoner/provider-not-installed",
        severity: "fatal",
      });
    }
    if (run.outcome === "timeout") {
      throw new ReasonerError(
        `codex: timed out after ${this.#config.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`,
        {
          code: "reasoner/provider-timeout",
          severity: "fatal",
        },
      );
    }
    if (run.outcome === "failure") {
      const message = run.failureMessage ?? "Codex CLI reported an error";
      const code = AUTH_HINT_RE.test(message)
        ? "reasoner/provider-auth-failed"
        : "reasoner/provider-http-error";
      throw new ReasonerError(`codex: ${message}`, { code, severity: "fatal" });
    }
    if (run.text === undefined) {
      throw new ReasonerError("codex: no output produced", {
        code: "reasoner/provider-malformed-response",
        severity: "fatal",
      });
    }

    return validateAndWrap({ rawText: run.text }, this.capabilities);
  }
}

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() ?? "";
}

function firstChars(text: string, n: number): string {
  return text.length > n ? `${text.slice(0, n)}…` : text;
}
