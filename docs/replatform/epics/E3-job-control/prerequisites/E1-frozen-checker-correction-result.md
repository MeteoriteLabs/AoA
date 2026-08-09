# Prerequisite P2 Result - E1 frozen-consumer checker correction

**Status:** `awaiting_review`
**Disposition:** `awaiting_review`
**Date (UTC):** `2026-08-10`
**Implementer:** `Codex implementer agent (/root/e1_checker_correction_impl)`
**Start SHA:** `baf903bc982c7580b6955b69c624fb6dcab570ae`
**Candidate code revision:** `4fa9df3f08452509f24c94681df73a8909451684`
**Reviewed revision:** `TBD - distinct reviewer`
**Scope:** Corrective E1 checker/test/evidence work only. No frozen v1 byte, worker-protocol source/schema/bundle, dependency version, or E3 ticket behavior changed.

This is an implementer-prepared prerequisite candidate, not a pass or completion decision. Only a distinct reviewer may set P2 complete/pass or authorize JOB-001 to rely on this correction.

## Candidate behavior

- The CLI reads `packages/worker-protocol/package.json` and `pnpm-lock.yaml` as raw Git blobs at the fixture-recorded E1 source commit.
- Recorded package/lock SHA-256 values and the Zod/esbuild importer evidence are checked against those immutable blobs, not the later consumer checkout or installed dependencies.
- Missing source commits, source trees, or source blobs fail closed with the missing object/path and a fetch/retry action.
- Existing frozen manifest, bundle, declaration, no-runtime-dependency, path-leak, and isolated server/worker smoke checks remain enforced.
- Git-byte checks are independent of working-tree LF/CRLF conversion and pass in a clean clone with no `node_modules`.

## Strict TDD evidence

### RED

1. Before the correction, `pnpm check:frozen-worker-protocol-v1 -- --source-sha b7a842870ce7509d8baa75409e0ab19da375c88a` exited `1`: the working-tree CRLF bytes made the recorded `packageIntegrity` and `lockfileIntegrity` appear stale even though the corresponding Git blobs were unchanged.
2. With the new behavior tests present and the old checker intact, `node --test scripts/check-frozen-worker-protocol-consumer.test.mjs` exited `1`, `12 passed / 7 failed`. The failures proved coupling to a later consumer lock/manifest and installed versions, CRLF dependence, missing commit/blob fail-open behavior, undetected Zod/esbuild source-snapshot mutations, and clean-clone dependence on installed Zod.
3. Before adding the two source-blob digest comparisons, the expanded integrity corpus exited `1`, `19 passed / 2 failed`; mutations to recorded `packageIntegrity` and `lockfileIntegrity` were incorrectly accepted.

### GREEN candidate

| Command | Outcome |
|---|---|
| `node --test scripts/check-frozen-worker-protocol-consumer.test.mjs` | exit `0`, `21/21` |
| `pnpm check:frozen-worker-protocol-v1 -- --source-sha b7a842870ce7509d8baa75409e0ab19da375c88a` | exit `0`; Zod `3.24.2`, esbuild `0.28.1` |
| `node --test scripts/check-worker-protocol-boundary.test.mjs` | exit `0`, `50/50` |
| `pnpm check:worker-protocol-boundary` | exit `0` |
| `node scripts/check-worker-protocol-package.mjs` | exit `0` |
| `node scripts/update-worker-protocol-contract-manifest.mjs --check` | exit `0` |
| worker-protocol typecheck/build | both exit `0` |
| `pnpm -r typecheck` | exit `0`, 24/25 workspace projects |
| `pnpm build` | exit `0` |
| `pnpm --filter @armyofagents/worker-protocol test:run` | exit `1`: `16` files / `490` tests passed; only the documented Windows collection failure at `cross-version.test.ts:12` failed before collection |
| `pnpm test:run` | exit `1` on the same sole Windows collection failure; not converted into a pass. Linux CI remains DEC-03 authority |

The full repository command was run twice; the local tool truncated the aggregate Vitest count block, so this ledger does not invent a current aggregate count. No second failed suite was reported.

## Immutable evidence

| Evidence | SHA / identity |
|---|---|
| Frozen E1 source commit | `b7a842870ce7509d8baa75409e0ab19da375c88a` |
| Source `packages/worker-protocol/package.json` Git-blob SHA-256 | `41acbb809c75647931a0cd891d92a6065cbd55f6609fbbc36937bca37f1291bb` |
| Source `pnpm-lock.yaml` Git-blob SHA-256 | `134169fe9cf4edecafc6b5c698eb251795a10da8bb69ac30dfbca58e451da426` |
| Frozen bundle SHA-256 | `3c854028f3f1c0e7a792bda328515dc4c801e41bf0b0f3c3ee79a3ac7b7294e9` |
| Frozen fixture Git tree at start and candidate | `e62b3b2977fdd69a20ea62a0be30ecd858aafa20` |
| `packages/worker-protocol` Git tree at start and candidate | `73aeaaeebefeabf660bf8e5a5ff809184fe2e33a` |

`git diff --exit-code baf903bc982c7580b6955b69c624fb6dcab570ae -- packages/worker-protocol tests/fixtures/worker-protocol-consumers/v1 docs/contracts/worker-protocol/v1 scripts/freeze-worker-protocol-consumer.mjs` exits `0`.

## Changed files

- `scripts/check-frozen-worker-protocol-consumer.mjs`
- `scripts/check-frozen-worker-protocol-consumer.test.mjs`
- This result ledger, E1-F008, and the awaiting-review QA/handoff records for the correction

## Reviewer action required

Review the exact evidence revision, independently exercise Git-object availability and later-consumer compatibility, verify the immutable tree identities, and classify the Windows-local Vitest baseline. Until then, P2 remains `awaiting_review` and this record grants no E3 implementation authority.
