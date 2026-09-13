/**
 * Claude Code — uses the caller's own already-authenticated CLI session.
 * ARCLUME never reads, copies, or persists its credentials: it starts
 * `claude`, feeds it a prompt over stdin, reads its stdout, and validates the
 * result. No tool access is granted (`--allowedTools ""`) — ARCLUME already
 * supplies every document's full content in the prompt, so the CLI never
 * needs to read files or run commands to answer.
 *
 * Invocation contract (verified against a real, currently installed
 * `claude` 2.1.263 on this machine before being written; kept fully
 * overridable via config in case a future CLI release changes it):
 *
 *   claude -p --output-format json --model <model> --allowedTools ""
 *     (system + user prompt both fed over the SAME stdin stream, never as an
 *      argv value — see below for why)
 *
 * The system prompt is deliberately NOT passed via `--system-prompt <text>`
 * on argv, even though the CLI supports that flag: ARCLUME's system prompt
 * always contains newlines and embeds the full JSON schema text (quotes,
 * braces, thousands of characters). On Windows, a `claude` installed via
 * `npm install -g` resolves to a `.cmd` shim, which can only be executed by
 * routing through `cmd.exe` (an OS requirement, not a Node/cross-spawn
 * choice) — and cmd.exe's command-line parser cannot represent an embedded
 * newline inside an argument at all, under any quoting scheme. Passing the
 * system prompt as an argv value there corrupts or truncates the whole
 * invocation. Combining system+user into one stdin payload (the same
 * strategy {@link CodexReasoner} already uses) sidesteps the limitation
 * entirely and works identically on every install method (native binary,
 * npm shim, POSIX). Confirmed with a Windows `.cmd`-shim fake-CLI test.
 *
 * Success envelope (observed, real): a single JSON object on stdout with
 * `is_error: false` and the model's final text in `result`. Failure:
 * `is_error: true` with a human-readable `result`/error message — this
 * adapter pattern-matches that text for authentication-shaped failures
 * (best-effort; the exact wording is not a stable contract, so an
 * unrecognized failure still surfaces as a clear generic error rather than a
 * silent misclassification).
 */

import { ReasonerError } from "../../errors.js";
import type {
  Reasoner,
  ReasonerCapabilities,
  ReasonerRequest,
  ReasonerResult,
} from "../reasoner.js";
import { CliNotFoundError, invokeCli } from "./cli-common.js";
import { type ChatPrompt, buildAnalysisPrompt } from "./prompt.js";
import { validateAndWrap } from "./shared.js";

export type CliProviderState = "not-installed" | "not-authenticated" | "ready" | "error";

export interface CliStatus {
  state: CliProviderState;
  message: string;
  version?: string;
}

const CLAUDE_CANDIDATES = ["claude"] as const;
const DEFAULT_TIMEOUT_MS = 120_000;
const VERSION_TIMEOUT_MS = 8_000;

const AUTH_HINT_RE = /(not logged in|log in|authenticat|api key|unauthorized|please sign in)/i;

interface ClaudeCodeJsonEnvelope {
  is_error?: boolean;
  result?: string;
  subtype?: string;
}

function parseEnvelope(stdout: string): ClaudeCodeJsonEnvelope | undefined {
  try {
    return JSON.parse(stdout.trim()) as ClaudeCodeJsonEnvelope;
  } catch {
    return undefined;
  }
}

/** `claude --version` only — proves the CLI is installed and runnable. Use
 * {@link testClaudeCodeConnection} to also confirm it is authenticated. */
export async function detectClaudeCode(): Promise<CliStatus> {
  try {
    const result = await invokeCli({
      candidates: CLAUDE_CANDIDATES,
      args: ["--version"],
      timeoutMs: VERSION_TIMEOUT_MS,
    });
    if (result.exitCode === 0) {
      return {
        state: "ready",
        message: "Claude Code CLI found",
        version: firstLine(result.stdout),
      };
    }
    return {
      state: "error",
      message: `claude --version exited with code ${result.exitCode}: ${firstLine(result.stderr || result.stdout)}`,
    };
  } catch (err) {
    if (err instanceof CliNotFoundError) {
      return { state: "not-installed", message: "Claude Code CLI (`claude`) not found on PATH" };
    }
    return { state: "error", message: (err as Error).message };
  }
}

/** A minimal real invocation — the only way to actually prove the session is
 * authenticated and usable, not just installed. */
export async function testClaudeCodeConnection(
  config: { model?: string } = {},
): Promise<CliStatus> {
  const model = config.model ?? "haiku";
  try {
    const result = await invokeCli({
      candidates: CLAUDE_CANDIDATES,
      args: ["-p", "--output-format", "json", "--model", model, "--allowedTools", ""],
      stdin: "Reply with exactly one word: ok",
      timeoutMs: 30_000,
    });
    if (result.timedOut) {
      return { state: "error", message: "Claude Code CLI timed out" };
    }
    const envelope = parseEnvelope(result.stdout);
    if (envelope === undefined) {
      if (AUTH_HINT_RE.test(result.stderr) || AUTH_HINT_RE.test(result.stdout)) {
        return {
          state: "not-authenticated",
          message: "Claude Code CLI reports it is not authenticated",
        };
      }
      return {
        state: "error",
        message: `Claude Code CLI produced no parseable output: ${firstLine(result.stderr || result.stdout)}`,
      };
    }
    if (envelope.is_error) {
      const text = envelope.result ?? "";
      if (AUTH_HINT_RE.test(text)) {
        return {
          state: "not-authenticated",
          message: text || "Claude Code CLI reports it is not authenticated",
        };
      }
      return { state: "error", message: text || "Claude Code CLI reported an error" };
    }
    return { state: "ready", message: "Claude Code CLI is authenticated and ready" };
  } catch (err) {
    if (err instanceof CliNotFoundError) {
      return { state: "not-installed", message: "Claude Code CLI (`claude`) not found on PATH" };
    }
    return { state: "error", message: (err as Error).message };
  }
}

export interface ClaudeCodeConfig {
  model?: string;
  timeoutMs?: number;
  /** Defaults to the primary analysis prompt. Verified-mode reviewer duty
   * swaps this for `buildReviewerPrompt` bound to a candidate. */
  promptBuilder?: (request: ReasonerRequest) => ChatPrompt;
}

const CAPABILITIES: ReasonerCapabilities = {
  id: "claude-code",
  version: "0.1.0",
  deterministic: false,
  network: false, // ARCLUME itself makes no network call; the CLI subprocess does
};

export class ClaudeCodeReasoner implements Reasoner {
  readonly capabilities = CAPABILITIES;
  readonly #config: ClaudeCodeConfig;

  constructor(config: ClaudeCodeConfig = {}) {
    this.#config = config;
  }

  async analyze(request: ReasonerRequest): Promise<ReasonerResult> {
    const prompt = (this.#config.promptBuilder ?? buildAnalysisPrompt)(request);
    const model = this.#config.model ?? "sonnet";
    // System + user combined into one stdin payload — never argv. See the
    // module header comment for why (Windows .cmd-shim newline corruption).
    const combined = `${prompt.system}

---

${prompt.user}`;
    let result: Awaited<ReturnType<typeof invokeCli>>;
    try {
      result = await invokeCli({
        candidates: CLAUDE_CANDIDATES,
        args: ["-p", "--output-format", "json", "--model", model, "--allowedTools", ""],
        stdin: combined,
        timeoutMs: this.#config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
    } catch (err) {
      if (err instanceof CliNotFoundError) {
        throw new ReasonerError("Claude Code CLI (`claude`) not found on PATH", {
          code: "reasoner/provider-not-installed",
          severity: "fatal",
          cause: err,
        });
      }
      throw new ReasonerError(`claude-code: ${(err as Error).message}`, {
        code: "reasoner/provider-unavailable",
        severity: "fatal",
        cause: err,
      });
    }

    if (result.timedOut) {
      throw new ReasonerError(
        `claude-code: timed out after ${this.#config.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`,
        {
          code: "reasoner/provider-timeout",
          severity: "fatal",
        },
      );
    }

    const envelope = parseEnvelope(result.stdout);
    if (envelope === undefined) {
      throw new ReasonerError("claude-code: CLI produced no parseable JSON envelope", {
        code: "reasoner/provider-malformed-response",
        severity: "fatal",
        hint: firstChars(result.stderr || result.stdout, 400),
      });
    }
    if (envelope.is_error) {
      const message = envelope.result ?? "unknown error";
      const code = AUTH_HINT_RE.test(message)
        ? "reasoner/provider-auth-failed"
        : "reasoner/provider-http-error";
      throw new ReasonerError(`claude-code: ${message}`, { code, severity: "fatal" });
    }
    if (typeof envelope.result !== "string") {
      throw new ReasonerError("claude-code: envelope is missing `result`", {
        code: "reasoner/provider-malformed-response",
        severity: "fatal",
      });
    }

    return validateAndWrap({ rawText: envelope.result }, this.capabilities);
  }
}

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() ?? "";
}

function firstChars(text: string, n: number): string {
  return text.length > n ? `${text.slice(0, n)}…` : text;
}
