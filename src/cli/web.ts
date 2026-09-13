/**
 * `arclume web [--port N]` — the local Web UI. Loopback-only; no public host
 * flag. Prints the URL plus the session note and runs until Ctrl+C.
 */

import { startArclumeWeb } from "../web/server.js";
import { CliUsageError, parseArgs, singleValue } from "./args.js";
import type { CliIo } from "./output.js";

export const WEB_FLAGS = {
  valueFlags: ["port"],
  booleanFlags: ["json", "quiet", "verbose"],
} as const;

export async function runWebCommand(argv: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArgs(argv, WEB_FLAGS);
  const portRaw = singleValue(parsed, "port");
  let port: number | undefined;
  if (portRaw !== undefined) {
    const n = Number(portRaw);
    if (!Number.isInteger(n) || n < 0 || n > 65535) {
      throw new CliUsageError(`invalid port "${portRaw}"`);
    }
    port = n;
  }
  const handle = await startArclumeWeb(port !== undefined ? { port } : {});
  io.stderr(`ARCLUME Web: ${handle.url}`);
  io.stderr("(loopback only; CTRL+C to stop; the session token is embedded in the served page)");
  io.stdout(
    parsed.booleans.has("json") ? JSON.stringify({ ok: true, url: handle.url }) : handle.url,
  );

  await new Promise<void>((done) => {
    const stop = (): void => {
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
      void handle.close().finally(() => {
        io.stderr("ARCLUME Web: stopped");
        done();
      });
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
  return 0;
}
