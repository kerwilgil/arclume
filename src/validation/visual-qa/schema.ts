/**
 * A small, self-contained AJV instance for the Phase 6 artifact schemas
 * (`visual-qa.json`, the Visual QA receipt, the delivery manifest).
 *
 * Kept separate from `src/schema/loader.ts` on purpose: the Phase 1 loader's
 * `SchemaName` union and cache stay untouched, and Visual QA carries its own
 * validation surface.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { AnySchemaObject, Plugin, ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import { schemasDir } from "../../schema/paths.js";

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as Plugin<unknown>;

export type Phase6SchemaName = "visualQa" | "visualQaReceipt" | "deliveryManifest";

const FILES: Record<Phase6SchemaName, string> = {
  visualQa: "visual-qa.schema.json",
  visualQaReceipt: "visual-qa-receipt.schema.json",
  deliveryManifest: "delivery-manifest.schema.json",
};

function read(file: string): AnySchemaObject {
  return JSON.parse(readFileSync(join(schemasDir(), file), "utf8")) as AnySchemaObject;
}

let compiled: Record<Phase6SchemaName, ValidateFunction> | undefined;

function schemas(): Record<Phase6SchemaName, ValidateFunction> {
  if (!compiled) {
    const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true });
    addFormats(ajv);
    compiled = {
      visualQa: ajv.compile(read(FILES.visualQa)),
      visualQaReceipt: ajv.compile(read(FILES.visualQaReceipt)),
      deliveryManifest: ajv.compile(read(FILES.deliveryManifest)),
    };
  }
  return compiled;
}

export interface SchemaCheck {
  valid: boolean;
  errors: string[];
}

/** Validate a Phase 6 artifact against its bundled JSON Schema. Never throws. */
export function checkPhase6Schema(name: Phase6SchemaName, value: unknown): SchemaCheck {
  const validate = schemas()[name];
  const valid = validate(value) as boolean;
  if (valid) return { valid: true, errors: [] };
  const errors = (validate.errors ?? []).map(
    (e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`,
  );
  return { valid: false, errors };
}

/** Reset the compiled-schema cache. Test-only. */
export function resetPhase6SchemaCache(): void {
  compiled = undefined;
}
