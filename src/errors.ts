/**
 * Structured error model for the Arclume pipeline.
 *
 * Every failure carries a `stage`, a stable `code`, optional `path` / `sourceId`
 * for location, an optional `hint`, and a `severity`. Raw stack traces are never
 * the primary UX — `toJSON()` / `describe()` give the actionable summary.
 */

export type PipelineStage =
  | "DISCOVERY"
  | "INGESTION"
  | "PARSER"
  | "REASONER"
  | "KNOWLEDGE_BUILD"
  | "PLANNING"
  | "VALIDATION"
  | "RENDER"
  | "VISUAL_QA"
  | "DELIVERY"
  | "SAFETY";

export type ErrorSeverity = "fatal" | "recoverable" | "warning";

export interface ArclumeErrorFields {
  stage: PipelineStage;
  /** Stable slug, e.g. `discovery/root-not-found`, `reasoner/malformed-output`. */
  code: string;
  path?: string;
  sourceId?: string;
  hint?: string;
  severity?: ErrorSeverity;
  /** Underlying error, kept for logs but never surfaced as primary UX. */
  cause?: unknown;
}

export interface ArclumeErrorJSON {
  name: string;
  stage: PipelineStage;
  code: string;
  message: string;
  severity: ErrorSeverity;
  path?: string;
  sourceId?: string;
  hint?: string;
}

export class ArclumeError extends Error {
  readonly stage: PipelineStage;
  readonly code: string;
  readonly severity: ErrorSeverity;
  readonly path?: string;
  readonly sourceId?: string;
  readonly hint?: string;

  constructor(message: string, fields: ArclumeErrorFields) {
    super(message, fields.cause !== undefined ? { cause: fields.cause } : undefined);
    this.name = new.target.name;
    this.stage = fields.stage;
    this.code = fields.code;
    this.severity = fields.severity ?? "fatal";
    if (fields.path !== undefined) this.path = fields.path;
    if (fields.sourceId !== undefined) this.sourceId = fields.sourceId;
    if (fields.hint !== undefined) this.hint = fields.hint;
  }

  toJSON(): ArclumeErrorJSON {
    const json: ArclumeErrorJSON = {
      name: this.name,
      stage: this.stage,
      code: this.code,
      message: this.message,
      severity: this.severity,
    };
    if (this.path !== undefined) json.path = this.path;
    if (this.sourceId !== undefined) json.sourceId = this.sourceId;
    if (this.hint !== undefined) json.hint = this.hint;
    return json;
  }

  describe(): string {
    const loc = [this.path, this.sourceId].filter(Boolean).join(" ");
    const hint = this.hint ? ` — hint: ${this.hint}` : "";
    return `[${this.severity}] ${this.stage} ${this.code}${loc ? ` (${loc})` : ""}: ${this.message}${hint}`;
  }
}

export type StagedErrorFields = Omit<ArclumeErrorFields, "stage">;

class StagedError extends ArclumeError {
  constructor(
    stage: PipelineStage,
    defaultSeverity: ErrorSeverity,
    message: string,
    fields: StagedErrorFields,
  ) {
    super(message, { ...fields, stage, severity: fields.severity ?? defaultSeverity });
  }
}

export class DiscoveryError extends StagedError {
  constructor(message: string, fields: StagedErrorFields = { code: "discovery/error" }) {
    super("DISCOVERY", "fatal", message, fields);
  }
}
export class IngestionError extends StagedError {
  constructor(message: string, fields: StagedErrorFields = { code: "ingestion/error" }) {
    super("INGESTION", "recoverable", message, fields);
  }
}
export class ParserError extends StagedError {
  constructor(message: string, fields: StagedErrorFields = { code: "parser/error" }) {
    super("PARSER", "recoverable", message, fields);
  }
}
export class ReasonerError extends StagedError {
  constructor(message: string, fields: StagedErrorFields = { code: "reasoner/error" }) {
    super("REASONER", "fatal", message, fields);
  }
}
export class KnowledgeBuildError extends StagedError {
  constructor(message: string, fields: StagedErrorFields = { code: "knowledge-build/error" }) {
    super("KNOWLEDGE_BUILD", "fatal", message, fields);
  }
}
export class PlanningError extends StagedError {
  constructor(message: string, fields: StagedErrorFields = { code: "planning/error" }) {
    super("PLANNING", "fatal", message, fields);
  }
}
export class ValidationFailedError extends StagedError {
  constructor(message: string, fields: StagedErrorFields = { code: "validation/error" }) {
    super("VALIDATION", "fatal", message, fields);
  }
}
export class RenderError extends StagedError {
  constructor(message: string, fields: StagedErrorFields = { code: "render/error" }) {
    super("RENDER", "fatal", message, fields);
  }
}
export class VisualQaError extends StagedError {
  constructor(message: string, fields: StagedErrorFields = { code: "visual-qa/error" }) {
    super("VISUAL_QA", "fatal", message, fields);
  }
}
export class DeliveryError extends StagedError {
  constructor(message: string, fields: StagedErrorFields = { code: "delivery/error" }) {
    super("DELIVERY", "fatal", message, fields);
  }
}
export class SafetyError extends StagedError {
  constructor(message: string, fields: StagedErrorFields = { code: "safety/error" }) {
    super("SAFETY", "recoverable", message, fields);
  }
}

/** A non-fatal note collected during a stage instead of thrown. */
export interface PipelineNote {
  stage: PipelineStage;
  code: string;
  message: string;
  severity: Exclude<ErrorSeverity, "fatal">;
  path?: string;
  sourceId?: string;
  hint?: string;
}

export function note(
  stage: PipelineStage,
  code: string,
  message: string,
  extra: Partial<Omit<PipelineNote, "stage" | "code" | "message">> = {},
): PipelineNote {
  const n: PipelineNote = {
    stage,
    code,
    message,
    severity: extra.severity ?? "warning",
  };
  if (extra.path !== undefined) n.path = extra.path;
  if (extra.sourceId !== undefined) n.sourceId = extra.sourceId;
  if (extra.hint !== undefined) n.hint = extra.hint;
  return n;
}
