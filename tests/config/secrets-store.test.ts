import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ArclumeDirs } from "../../src/config/paths.js";
import {
  deleteSecret,
  maskSecret,
  parseEnvText,
  readSecretsFile,
  serializeEnvText,
  setSecret,
} from "../../src/config/secrets-store.js";

let base: string;
let dirs: ArclumeDirs;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "arclume-secrets-"));
  dirs = {
    configDir: join(base, "config"),
    secretsDir: join(base, "secrets"),
    logsDir: join(base, "logs"),
  };
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("parseEnvText / serializeEnvText", () => {
  it("parses KEY=VALUE lines, skipping comments and blank lines", () => {
    const map = parseEnvText("# a comment\nFOO=bar\n\nBAZ=qux\n");
    expect(Object.fromEntries(map)).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("strips matching quotes around a value", () => {
    const map = parseEnvText("FOO=\"bar baz\"\nQUX='single'\n");
    expect(map.get("FOO")).toBe("bar baz");
    expect(map.get("QUX")).toBe("single");
  });

  it("skips malformed lines with no KEY= shape", () => {
    const map = parseEnvText("not a valid line\nFOO=bar\n");
    expect(Object.fromEntries(map)).toEqual({ FOO: "bar" });
  });

  it("quotes a value containing whitespace or a hash when serializing", () => {
    const text = serializeEnvText(new Map([["FOO", "has space"]]));
    expect(text).toBe('FOO="has space"\n');
    expect(parseEnvText(text).get("FOO")).toBe("has space");
  });

  it("round-trips a value containing a literal double quote", () => {
    const map = new Map([["FOO", 'say "hi"']]);
    const text = serializeEnvText(map);
    expect(parseEnvText(text).get("FOO")).toBe('say "hi"');
  });
});

describe("readSecretsFile", () => {
  it("returns an empty map when no file exists", () => {
    expect(readSecretsFile(dirs).size).toBe(0);
  });
});

describe("setSecret / deleteSecret", () => {
  it("creates the secrets file with one key set", () => {
    setSecret("OPENAI_API_KEY", "sk-abc123", dirs);
    const map = readSecretsFile(dirs);
    expect(map.get("OPENAI_API_KEY")).toBe("sk-abc123");
  });

  it("preserves every other key when updating one", () => {
    setSecret("OPENAI_API_KEY", "sk-one", dirs);
    setSecret("ANTHROPIC_API_KEY", "sk-two", dirs);
    setSecret("OPENAI_API_KEY", "sk-updated", dirs);
    const map = readSecretsFile(dirs);
    expect(map.get("OPENAI_API_KEY")).toBe("sk-updated");
    expect(map.get("ANTHROPIC_API_KEY")).toBe("sk-two");
  });

  it("deletes exactly one key, preserving the others", () => {
    setSecret("OPENAI_API_KEY", "sk-one", dirs);
    setSecret("ANTHROPIC_API_KEY", "sk-two", dirs);
    deleteSecret("OPENAI_API_KEY", dirs);
    const map = readSecretsFile(dirs);
    expect(map.has("OPENAI_API_KEY")).toBe(false);
    expect(map.get("ANTHROPIC_API_KEY")).toBe("sk-two");
  });

  it("deleting an already-absent key is a no-op, not an error", () => {
    expect(() => deleteSecret("NOPE", dirs)).not.toThrow();
  });

  it("writes atomically — no stray temp file left in the secrets directory", () => {
    setSecret("OPENAI_API_KEY", "sk-abc", dirs);
    const files = readdirSync(dirs.secretsDir);
    expect(files).toEqual([".env"]);
  });

  it("never writes the raw secret value into anything but the .env file's own content", () => {
    setSecret("OPENAI_API_KEY", "sk-super-secret-value", dirs);
    const raw = readFileSync(join(dirs.secretsDir, ".env"), "utf8");
    expect(raw).toContain("sk-super-secret-value"); // it MUST be there — that's the file's job
    expect(raw.split("\n").filter((l) => l.length > 0).length).toBe(1); // and nowhere else / nothing extra
  });
});

describe("maskSecret", () => {
  it("never returns the full value for a normal-length key", () => {
    const masked = maskSecret("sk-abcdefghijklmnop");
    expect(masked).not.toBe("sk-abcdefghijklmnop");
    expect(masked).not.toContain("abcdefghijkl");
    expect(masked.startsWith("sk-")).toBe(true);
    expect(masked.endsWith("mnop")).toBe(true);
  });

  it("fully redacts a very short value instead of echoing it", () => {
    const masked = maskSecret("abcd");
    expect(masked).not.toBe("abcd");
    expect(masked).toMatch(/^•+$/);
  });
});
