/** `arclume --help` text: commands, inputs, formats, presets. No wall of text. */

import { DECK_TYPE_NAMES } from "../narrative/deck-types.js";
import { AUDIENCE_NAME_VALUES } from "../narrative/types.js";
import { PRESET_IDS } from "./presets.js";

export const HELP_TEXT = `ARCLUME — project/file/URL → deterministic presentation decks

Usage:
  arclume analyze <input...> --prepare-analysis <request.json>     # write the deterministic agent request, STOP
  arclume analyze <input...> --analysis-result <result.json> [--out knowledge.json]
                                                                  # consume the bound agent result → ProjectKnowledge
  arclume analyze <input...> --reasoner stub [--out knowledge.json]  # offline heuristic (not agent-grade)
  arclume build <knowledge.json|dir> [--preset id] [--audience id] [--deck-type id] [--format html,pdf,pptx] [--out dir] [--json]
  arclume validate <path> [--json]
  arclume presets
  arclume watch <path> --reasoner stub [--preset id] [--out dir]
  arclume web [--port N]        # local Web UI (loopback only)
  arclume --help
  arclume --version

Reasoning policy:
  analyze requires an explicit mode. The heuristic stub is offline-only and
  never presented as agent-grade reasoning; real analysis is produced by an
  external agent from the request file (see SKILL.md). No model SDK is bundled.
  watch is an explicit offline heuristic workflow and therefore requires
  --reasoner stub — it never runs agent reasoning.

Inputs (analyze):
  directory or repository · file (md, txt, json, yaml, pdf, docx) · https:// URL
  URLs go through the bounded, SSRF-hardened ingestion (Phase 8) — analyze never executes content.

Formats (build):
  html  self-contained deck document (default)
  pdf   atomic export bundle: deck.pdf + export-receipt.json
  pptx  atomic export bundle: deck.pptx + export-receipt.json

Build presets: ${PRESET_IDS.join(", ")}

Audience presets (choose the reader — controls density + evidence visibility):
  ${AUDIENCE_NAME_VALUES.join(", ")}

Deck-type presets (choose the narrative arc — section order, what the deck is trying to achieve):
  ${DECK_TYPE_NAMES.join(", ")}

Global flags:
  --json     machine-readable stdout (no ANSI, no prose)
  --quiet    minimal stdout
  --verbose  include stack traces on errors

Exit codes:
  0 success · 1 usage/input error · 2 build/validation error · 3 security refusal
`;
