# TaskFlow

TaskFlow is a small HTTP API that receives task events from an external tracker,
applies approval rules, and records the decision. It exists so that approvals
stop living in email threads.

## Architecture

The system is three components behind one HTTP entry point. See
`docs/architecture.md` for the detail.

## Requirements

- The API must accept task events over HTTP POST.
- Every approval decision must be persisted before the response is returned.
- Rule evaluation must be deterministic for a given event and ruleset.

## Constraints

- Must run inside the customer's own network.
- No external calls during request handling.

## Risks

- The external tracker may send duplicate webhooks under retry.
- A malformed ruleset could block all approvals until it is fixed.

## Roadmap

- M1: single-tenant pilot with one ruleset.
- M2: per-team rulesets.
- M3: audit export.

## Metrics

- Median approval time: 6 hours.
- Webhook error rate: 0.4 percent.

## Status

- The pilot has been running since June 2026.
- One ruleset is live in production.

## Assumptions

- The external tracker retries failed webhooks with the same payload.
- Rulesets change less than once per week.

## Actors

- Approver — a person who owns a decision.
- Tracker — the external system that emits task events.

## Open Questions

- Which authentication method will the tracker use in production?
- How long must audit records be retained?
