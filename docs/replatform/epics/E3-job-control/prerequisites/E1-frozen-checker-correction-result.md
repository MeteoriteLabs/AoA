# Prerequisite P2 Result - E1 frozen-consumer checker correction

**Status:** `gate_review`
**Disposition:** `needs_changes`
**Date (UTC):** `2026-08-10`
**Implementer:** `Codex implementer agent (/root/e1_checker_correction_impl)`
**Start SHA:** `baf903bc982c7580b6955b69c624fb6dcab570ae`
**Candidate code revision:** `4fa9df3f08452509f24c94681df73a8909451684`
**Reviewed revision:** `c90908281b43ef5e2fba319d828ed1958ca3bb60`
**Scope:** Corrective E1 checker/test/evidence work only. No frozen v1 byte, worker-protocol source/schema/bundle, dependency version, or E3 ticket behavior changed.

Distinct review attempt 1 requested changes. P2 is not complete, this record is not a pass, and JOB-001 is not authorized to rely on this correction.

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

## Review attempt 1 - needs_changes

**Reviewer:** `Codex distinct reviewer (/root/e1_checker_correction_review)`
**Reviewed revision:** `c90908281b43ef5e2fba319d828ed1958ca3bb60`
**Spec verdict:** `fail`
**Quality/security verdict:** `fail`
**Disposition:** `needs_changes`

### Blocking findings

1. **P1 - coordinated frozen bundle and manifest mutation is accepted.** `scripts/check-frozen-worker-protocol-consumer.mjs:143-155` recomputes the manifest and compares it only with the manifest stored beside the bytes it authenticates. The immutable-source check at lines 345-408 anchors the package/lock/dependency evidence but never anchors the frozen fixture, manifest, schema declarations, or bundle to an immutable Git object. In an isolated `--no-local` clean clone of the reviewed revision, the reviewer appended a harmless export to `dist/index.js`, updated the matching `manifest.sha256` line, and ran the actual checker at `b7a842870ce7509d8baa75409e0ab19da375c88a`; it exited `0` with `OK`. This violates the brief's requirement that frozen bundle/fixture mutations fail.
2. **P2 - Git replacement refs can substitute the recorded source commit.** The `git cat-file` calls at `scripts/check-frozen-worker-protocol-consumer.mjs:254-269` honor `refs/replace`. In another isolated clone, the reviewer replaced the recorded source commit with commit `2252845f93dc3a3cc6876ae6feab94ce8a598796`, whose tree mutates `packages/worker-protocol/src/version.ts` while preserving package/lock evidence. The apparent source tree changed from `3ea185d9d6fab12b221d8f477f03a1515e3781b3` to `fbe91e153c1f87615b5ebafe40504636fbef5b3c`; the checker still exited `0` under the original source SHA.
3. **P2 - unauthenticated fixture code executes before static failures are emitted and has no timeout.** The CLI gathers static/source errors at lines 448-462, but always imports the fixture at lines 464-468; `smokeImport` at lines 413-424 has no timeout. A controlled invalid-manifest probe proved a top-level sentinel in the tampered bundle executed in both server and worker children after the manifest mismatch was already known. A hostile mutation can therefore run or hang verification even though the fixture has failed authentication.
4. **P2 - the focused test harness inherits global Git signing and leaks temp repositories on setup failure.** `initSourceRepo` commits at `scripts/check-frozen-worker-protocol-consumer.test.mjs:132-147` without disabling inherited `commit.gpgSign`, and `withSourceRepo` calls setup before entering `try/finally` at lines 196-202. With `GIT_CONFIG_COUNT=1`, `GIT_CONFIG_KEY_0=commit.gpgSign`, and `GIT_CONFIG_VALUE_0=true`, the corpus exited `1` on GPG signing failures and left nine new `frozen-wp-git-*` directories in the OS temp directory.

Non-blocking coverage/maintenance gaps: the missing-tree branch at checker lines 355-357 has no direct case (the corpus covers an unavailable commit and missing lock blob), and the header at lines 13-16 inaccurately calls the Git-subprocess-backed source-snapshot verifier a pure helper.

### Independent acceptance evidence

| Command / probe | Outcome |
|---|---|
| Exact review package compared with `git diff --no-ext-diff --no-color --unified=10 baf903bc982c7580b6955b69c624fb6dcab570ae c90908281b43ef5e2fba319d828ed1958ca3bb60` | byte-identical package, exit `0` |
| `node --check` for checker and focused test | both exit `0` |
| `node --test scripts/check-frozen-worker-protocol-consumer.test.mjs` | exit `0`, `21/21` under default local Git configuration |
| Actual checker at recorded `b7a842...` | exit `0`, Zod `3.24.2`, esbuild `0.28.1` |
| Later consumer/root-lock drift, CRLF, unavailable commit/blob, Zod/esbuild, package/lock-integrity, and no-`node_modules` clean-clone cases | present in and pass the 21-case corpus |
| Coordinated bundle + regenerated manifest probe | **incorrect exit `0`** (`OK`) |
| Recorded-source Git replacement-ref probe | **incorrect exit `0`** (`OK`) |
| Invalid-manifest executable sentinel probe | exit `1`, but sentinel executed twice before rejection |
| Focused corpus with inherited `commit.gpgSign=true` | exit `1`; nine temp repositories leaked |
| Worker-protocol boundary Node suite / boundary CLI | exit `0`, `50/50` / exit `0` |
| Package smoke / contract-manifest check | both exit `0` |
| Worker-protocol typecheck / build | both exit `0` |
| Worker-protocol tests | exit `1`; `16` files and `490` tests passed, sole failed suite was the documented Windows collection SyntaxError at `src/cross-version.test.ts:12` |
| `pnpm -r typecheck` / `pnpm build` | both exit `0` |
| `pnpm test:run` | exit `1`; sole failed suite was the same Windows `src/cross-version.test.ts:12` collection SyntaxError; Linux CI remains DEC-03 authority |
| `git diff --check baf903bc982c7580b6955b69c624fb6dcab570ae c90908281b43ef5e2fba319d828ed1958ca3bb60` | exit `0` |

Direct base/head object comparison is clean: worker-protocol tree `73aeaaeebefeabf660bf8e5a5ff809184fe2e33a`, frozen-fixture tree `e62b3b2977fdd69a20ea62a0be30ecd858aafa20`, protocol source tree `a932ba4bec9dc7b96dd51b1670de92976ceeee69`, frozen bundle blob `260bf29edefb138a37bdfd28e68ceba95f3fdc38`, package blob `51dc7b2c67a1b60884219144a353b7e14e2162b3`, and lock blob `eed4aa6ac1559fff2b9f0788f735fe2473462df1` are unchanged between the base and reviewed head.

### Decision

The immutable boundaries themselves are unchanged and the intended later-consumer/CRLF/dependency correction works, but the checker does not enforce the complete frozen-artifact mutation contract and is unsafe against replacement refs and invalid executable fixture bytes. P2 remains in `gate_review` with `needs_changes`. The awaiting-review E1 QA/handoff are not finalized or superseded by pass artifacts.
