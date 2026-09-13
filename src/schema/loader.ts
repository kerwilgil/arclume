/**
 * Loads and compiles the bundled JSON Schemas with AJV (draft 2020-12).
 *
 * Phase 1 compiles at runtime from the JSON files. The compiled validators are
 * cached per process. This module is structured so a later phase can swap in
 * pre-generated standalone validators without changing callers.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { AnySchemaObject, Plugin, ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";

// ajv-formats is a CJS package whose type surface confuses default-import
// interop under NodeNext. Load it through `require` so the callable plugin is
// obtained unambiguously; the behaviour stays deterministic.
const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as Plugin<unknown>;
import { SCHEMA_IDS } from "../version.js";
import { schemasDir } from "./paths.js";

export type SchemaName =
  | "projectKnowledge"
  | "arclumeDeck"
  | "analysisResult"
  | "narrativePlan"
  | "slidePlan";

const SCHEMA_FILES: Record<"common" | SchemaName, string> = {
  common: "common.schema.json",
  projectKnowledge: "project-knowledge.schema.json",
  arclumeDeck: "arclume-deck.schema.json",
  analysisResult: "analysis-result.schema.json",
  narrativePlan: "narrative-plan.schema.json",
  slidePlan: "slide-plan.schema.json",
};

function readSchema(file: string): AnySchemaObject {
  const path = join(schemasDir(), file);
  return JSON.parse(readFileSync(path, "utf8")) as AnySchemaObject;
}

export interface CompiledSchemas {
  ajv: Ajv2020;
  projectKnowledge: ValidateFunction;
  arclumeDeck: ValidateFunction;
  analysisResult: ValidateFunction;
  narrativePlan: ValidateFunction;
  slidePlan: ValidateFunction;
}

let cache: CompiledSchemas | undefined;

/** Build a fresh AJV instance with the three schemas registered. */
export function createCompiledSchemas(): CompiledSchemas {
  const ajv = new Ajv2020({
    strict: true,
    allErrors: true,
    allowUnionTypes: true,
  });
  addFormats(ajv);

  // `common` is referenced by $id; register it but do not compile a root validator.
  ajv.addSchema(readSchema(SCHEMA_FILES.common), SCHEMA_IDS.common);

  const projectKnowledge = ajv.compile(readSchema(SCHEMA_FILES.projectKnowledge));
  const arclumeDeck = ajv.compile(readSchema(SCHEMA_FILES.arclumeDeck));
  const analysisResult = ajv.compile(readSchema(SCHEMA_FILES.analysisResult));
  const narrativePlan = ajv.compile(readSchema(SCHEMA_FILES.narrativePlan));
  const slidePlan = ajv.compile(readSchema(SCHEMA_FILES.slidePlan));

  return { ajv, projectKnowledge, arclumeDeck, analysisResult, narrativePlan, slidePlan };
}

/** Process-cached compiled schemas. */
export function getCompiledSchemas(): CompiledSchemas {
  if (!cache) cache = createCompiledSchemas();
  return cache;
}

/** Reset the cache. Intended for tests. */
export function resetCompiledSchemasCache(): void {
  cache = undefined;
}
