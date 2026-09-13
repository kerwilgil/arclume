/**
 * 1.0.1 native source picker — API contract and security boundary.
 *
 * Browser-free (node fetch against the real server on an ephemeral port).
 * The OS dialog itself is never spawned here: a TEST-ONLY seam answers on
 * its behalf, the same pattern as `urlTransport` / `buildFailureHook`.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PICK_SOURCE_POWERSHELL_ARGV,
  PICK_SOURCE_POWERSHELL_COMMAND,
  PickSourceBusyError,
  pickSourceSupported,
} from "../../src/web/pick-source.js";
import { type WebServerHandle, startArclumeWeb } from "../../src/web/server.js";

interface CapturedCall {
  status: number;
  json: Record<string, unknown> | undefined;
}

async function call(
  server: WebServerHandle,
  method: string,
  body?: unknown,
  withToken = true,
): Promise<CapturedCall> {
  const res = await fetch(`${server.url}/api/system/pick-source`, {
    method,
    headers: {
      ...(withToken ? { "x-arclume-session": server.token } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json: Record<string, unknown> | undefined;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = undefined;
  }
  return { status: res.status, json };
}

describe("pick-source — platform capability", () => {
  it("reports supported exactly on Windows", () => {
    expect(pickSourceSupported("win32")).toBe(true);
    expect(pickSourceSupported("linux")).toBe(false);
    expect(pickSourceSupported("darwin")).toBe(false);
  });
});

describe("pick-source — API contract", () => {
  it("GET reports capability without needing the session token", async () => {
    const server = await startArclumeWeb({ port: 0 });
    try {
      const r = await call(server, "GET", undefined, false);
      expect(r.status).toBe(200);
      expect(r.json?.ok).toBe(true);
      expect(r.json?.supported).toBe(pickSourceSupported());
    } finally {
      await server.close();
    }
  });

  it("POST requires the session token (same gate as every mutation)", async () => {
    const server = await startArclumeWeb({ port: 0 });
    try {
      const r = await call(server, "POST", {}, false);
      expect(r.status).toBe(401);
    } finally {
      await server.close();
    }
  });

  it("POST returns the picked path", async () => {
    const server = await startArclumeWeb({
      port: 0,
      pickSource: async () => ({ cancelled: false, path: "C:\\Mis Proyectos\\demo" }),
    });
    try {
      const r = await call(server, "POST", {});
      expect(r.status).toBe(200);
      expect(r.json).toEqual({ ok: true, cancelled: false, path: "C:\\Mis Proyectos\\demo" });
    } finally {
      await server.close();
    }
  });

  it("a cancelled dialog is 200 with cancelled: true — never an error", async () => {
    const server = await startArclumeWeb({
      port: 0,
      pickSource: async () => ({ cancelled: true }),
    });
    try {
      const r = await call(server, "POST", {});
      expect(r.status).toBe(200);
      expect(r.json).toEqual({ ok: true, cancelled: true });
      expect(r.json?.code).toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it("an already-open dialog is a 409, never a second window", async () => {
    const server = await startArclumeWeb({
      port: 0,
      pickSource: async () => {
        throw new PickSourceBusyError();
      },
    });
    try {
      const r = await call(server, "POST", {});
      expect(r.status).toBe(409);
      expect(r.json?.code).toBe("web/pick-source-busy");
    } finally {
      await server.close();
    }
  });

  it("client input never reaches the picker — the body is ignored entirely", async () => {
    const seenArgs: unknown[] = [];
    const server = await startArclumeWeb({
      port: 0,
      pickSource: async (...args: unknown[]) => {
        seenArgs.push(...args);
        return { cancelled: false, path: "C:\\picked-by-dialog" };
      },
    });
    try {
      // A hostile body attempting command injection / path override.
      const r = await call(server, "POST", {
        command: "cmd.exe /c calc",
        args: ["-NoProfile", "-c", "evil"],
        path: "C:\\attacker\\chosen",
        title: "powershell -c evil",
      });
      expect(r.status).toBe(200);
      expect(r.json?.path).toBe("C:\\picked-by-dialog");
      expect(seenArgs).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("rejects unknown sub-resources under /api/system", async () => {
    // The seam keeps this off the real OS dialog; only routing is exercised.
    const server = await startArclumeWeb({
      port: 0,
      pickSource: async () => ({ cancelled: true }),
    });
    try {
      const r = await call(server, "POST", {});
      const other = await fetch(`${server.url}/api/system/pick-source/run`, {
        method: "POST",
        headers: { "x-arclume-session": server.token },
      });
      expect(r.status).toBe(200);
      expect(other.status).toBe(404);
    } finally {
      await server.close();
    }
  });
});

describe("pick-source — the spawned command is a fixed literal", () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "web", "pick-source.ts"),
    "utf8",
  );

  it("argv contains only fixed flags and the static command", () => {
    expect(PICK_SOURCE_POWERSHELL_ARGV.slice(0, 5)).toEqual([
      "-NoProfile",
      "-STA",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
    ]);
    expect(PICK_SOURCE_POWERSHELL_ARGV[5]).toBe(PICK_SOURCE_POWERSHELL_COMMAND);
    expect(PICK_SOURCE_POWERSHELL_ARGV).toHaveLength(6);
  });

  it("the command never evaluates or interpolates input at runtime", () => {
    // No dynamic evaluation primitives…
    expect(PICK_SOURCE_POWERSHELL_COMMAND).not.toMatch(/Invoke-Expression|\biex\b/i);
    // …and the module never builds the command from pieces: the constant is
    // assigned once from a static array literal, with no template `${}`.
    expect(PICK_SOURCE_POWERSHELL_COMMAND).not.toContain("${");
    expect(source).not.toMatch(/PICK_SOURCE_POWERSHELL_COMMAND\s*\+=/);
  });
});
