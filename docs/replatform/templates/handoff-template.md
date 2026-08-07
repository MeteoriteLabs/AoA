# Handoff — <Merge train or epic gate>

**Date (UTC):** `<YYYY-MM-DD>`
**Epic:** `<E#-name>`
**Decision:** `pass`, `fail`, or `blocked_external`
**Gate owner role:** `Integration Gate Owner`

## Included ticket results

List committed ticket-result links.

## QA evidence

List immutable QA-result links and the revision each tested.

## Threshold decision

List every applicable REQUIRED condition and each HARD and INITIAL threshold from `docs/replatform/test-gates.md`. For D6, include every frozen matrix row, its SLI, and enabled/disabled desktop and mobility closure. A handoff cannot pass with any required condition/command failure or HARD/INITIAL failure. `blocked_external` is available only before an external lane/schedule starts; scheduled external failures after start count toward `fail`.

## Decisions and findings

List decisions locked during the train and every unresolved finding with severity.

## Compatibility and rollout

Record protocol/schema compatibility, flags, migration state, rollback/disable path, and active-work handling.

## Next unblocked work

List exact epic/ticket IDs unblocked by this gate.
