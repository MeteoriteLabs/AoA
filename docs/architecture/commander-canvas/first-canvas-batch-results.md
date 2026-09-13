# First Canvas implementation batch

**Status: implementation in progress; final qualification pending.** TK approved starting this bounded batch with “lets start” after reviewing the base, execution sequence and isolated worktree. This record supersedes the earlier “feature coding unstarted” status for these packages only.

## Scope and source

- Branch: `codex/universe-interface`, isolated `.worktrees/universe-interface` checkout.
- Starting planning revision: `53e1ece01dd5b4be6c987af5950f1ea50fa4e4a7`.
- Adopted replatform revision: `b48132dac0f3435e017915e1e21ef1d66a39d0cd`. Remote replatform still matched at batch preflight; no new merge or rebase was required.
- Approved work: `E8.1/1.a` pure preference contracts and `E1.1/1–3` shared registry, geometry history, controlled React Flow frame and internal browser harness.
- `E1.3/1.a` destination snapshot types are an independent producer in B02 and remain for the next work packet. This batch does not close the entire scheduling slot.

The internal harness demonstrates generic task-like, artifact and iframe content. Public Universe navigation, persistent layout/drafts, actual task entry routes, Commander presentation, live voice/browser sessions and provider APIs remain their separately sequenced consumers. The unapproved earlier implementation is excluded and untouched.

## Progress and evidence

| Producer or gate | Current evidence |
|---|---|
| Shared preferences | `7fc25f919`: strict schemas/defaults/reset sections; focused 7 tests, shared 590 tests, shared typecheck/build; independent task review approved |
| React Flow dependency | `cf0d609f3`: exact `@xyflow/react@12.11.6`, manifest plus generated lockfile; frozen install and actual runtime exports checked |
| Pure controller/history | `fe3b356ca` plus `03d3244a8`: 43 focused tests and targeted strict TypeScript; independent review caught receipt-wide ordinal consistency, corrected and re-reviewed |
| Controlled frame | `e40313915`, `84230e07c`, `dfd52e9d4`: 60 focused tests and UI typecheck; independent review corrected resize targets, bounded opening and cancelled-gesture observer fencing |
| Actual browser journey | In progress. Permanent Chromium tests exercise three content fixtures and three zoom levels; restore keyboard-focus failure remains under investigation |
| Full modified-source qualification | Pending exact-source typecheck, complete test suite and build |
| User experience acceptance | Pending demonstration and TK review |

The existing Linux baseline certificate is preserved. A fresh qualification checkout at `/workspace/universe-canvas-20260913` uses the established non-root test container. Its initial online dependency installation failed with DNS `EAI_AGAIN`; transferring the four already integrity-addressed host-cache packages allowed a frozen offline install without manifest or lockfile changes. This environment preparation is not a source qualification result.

## Implementation bindings clarified

1. `OpeningAck` and `PendingOpen` both carry `scope: Scope`. An acknowledgement cannot change ordering without matching its company/user/conversation and recorded incarnation. All receipt mappings must preserve one ordinal per incarnation and cannot reuse an ordinal across incarnations, even ones already closed.
2. Geometry actions accept optional `expectedRect`. Undo/redo proposals include it, and the reducer checks it again at application time so an intervening edit cannot be overwritten. History returns a candidate action/history; the caller installs it only after acceptance. E1.2 must retain that guard in its persistence adapter.
3. `State.layoutRevision` is an optional bounded reconciliation watermark, not a persistence authority. Older acknowledgements or canonical/optimistic ordinal collisions require E1.2 reconciliation. Hydration is an authorized initial load or explicit clean replacement; routine dirty refresh cannot call it to overwrite edits.

4. `UniverseWorkspace` exposes a typed `WorkspaceHandle` through `forwardRef`, with scoped dispatch, camera commands, defensive diagnostic snapshots and accepted undo/redo proposals. Retained mutation handles from an old scope are inert. Later tray and Commander consumers must use this seam instead of DOM handlers.
5. `WorkspaceHandle.open(entry, policy?)` uses measured usable bounds and the current camera for a new panel. Repeated opens retain normal geometry. Unmeasured workspaces wait rather than create corrupt geometry.
6. Cancellation aborts a gesture: restore the before-rectangle only if the same scoped incarnation still has that gesture's last accepted rectangle. It creates no history entry and cannot overwrite a reentrant observer edit. This commits to abort semantics; changing to partial-motion retention would require revised undo/interaction tests.

These refinements make existing identity and compare-before-write requirements explicit. Their integration cost is aligning the later E1.2 adapter with these signatures and recovery paths; they do not add a second layout writer or domain execution authority.

## Completion boundary

Generic frame completion requires observed pointer/keyboard/resize/overlap behavior at zoom 0.5, 1 and 2, content lifetime and scope cancellation, narrow/reduced-motion checks, full modified-source tests/build and final review. Unit tests or fixture content cannot certify authenticated task routes, provider sessions, persistence or completed V1. The next batch remains subject to the user's review of this demonstration.
