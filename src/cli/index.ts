#!/usr/bin/env node
/**
 * ARCLUME binary entry. All logic lives in `main.runCli`; this module only
 * wires process argv/stdio and translates the returned code into an exit.
 */

import { runCli } from "./main.js";

runCli(process.argv.slice(2))
  .then((code) => {
    process.exit(code);
  })
  .catch((err: unknown) => {
    // runCli never throws; this is the last-resort guard.
    process.stderr.write(`ARCLUME: ${(err as Error).message ?? String(err)}\n`);
    process.exit(2);
  });
