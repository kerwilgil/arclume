# Architecture

TaskFlow is one process. An HTTP handler fans events into three components.

## Ingest

Receives webhooks from the external tracker, verifies the shared secret header,
normalizes the payload, and hands a task event to the rules engine. It is the
only component that touches the network boundary.

## Rules

Evaluates the active ruleset against a task event and returns an approve or
reject decision plus the rule ids that fired. Evaluation is pure: the same event
and ruleset always produce the same decision.

## Store

Persists every decision, its inputs, and the rule ids that fired. It is the
system of record for the audit export.
