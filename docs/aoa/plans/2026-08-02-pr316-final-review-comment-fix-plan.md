# PR #316 final review-comment fix plan

**Branch:** `claude/multitenant-cloud`
**Reviewed HEAD:** `7196e154716ff01e7999808f629b746d14dcbfd7`
**Base:** `main`
**Purpose:** close the current production-safety findings before landing PR #316. Real gVisor execution remains a separate follow-up PR.

## Review-thread triage

The thread-aware GitHub audit found 58 unresolved Codex threads in total:

- 41 are already fixed or outdated.
- 7 describe explicitly deferred, unshipped capabilities.
- 3 are duplicates of those deferred capability gaps.
- 4 are false positives or non-reachable as claimed.
- 3 newest inline findings remain actionable.
- The latest Codex review body contains one additional actionable WebSocket finding.

Independent code review also found that the earlier provider dead-key repair catches every materialization error, including database and vault failures. A related deferred WebSocket cleanup is small and security-relevant enough to close while the same revalidation loop is being changed.

## In-scope fixes

### 1. Authenticate the cloud test-session mint

- Require a dedicated, per-run `AOA_E2E_TEST_SUPPORT_TOKEN` whenever `AOA_E2E_TEST_SUPPORT=1`.
- Refuse startup when the token is missing or shorter than 32 bytes.
- Require `Authorization: Bearer <token>` before parsing the mint request or touching the database.
- Compare fixed-length SHA-256 digests with `timingSafeEqual`.
- Preserve the existing board-authenticated `local_trusted` developer path without a token.
- Pass the token from the Playwright identity helper and extend the deploy-leak policy test.

Regression coverage: missing/wrong token denies with zero writes; correct token mints; weak/missing boot token fails; legacy local path is unchanged.

### 2. Enforce execution-target tenant ownership at persistence time

- During environment create/update, load and lock the company and selected execution target inside the route's existing transaction.
- Permit only system targets (`organization_id IS NULL`) or targets owned by the company's organization.
- Reject missing and cross-organization targets with the same non-enumerating 422 response.
- Keep `null` as the explicit pin-clear operation and leave omitted updates unchanged.

Regression coverage: cross-org create/update fail without persisting; same-org and system targets pass; null clears; omitted update preserves.

### 3. Claim organization capacity in true global FIFO order

- Replace agent-by-agent batch claiming with one organization-scoped transaction under the existing advisory lock.
- Read queued runs across every organization company ordered by `(created_at, id)`.
- Apply the organization cap and each queued agent's normalized runtime cap while walking that single ordered queue.
- Skip capped agents without head-of-line blocking and retain the `status='queued'` compare-and-set update.
- Return and launch claims in global selection order.

Regression coverage: `A:t1, B:t2, A:t3` with two slots claims `t1,t2`; capped oldest agent is skipped; concurrent claimers neither oversubscribe nor reorder.

### 4. Fail closed during LiveEvents WebSocket revalidation

- Extract a directly testable revalidation helper used by the 30-second sweep.
- In `cloud_auth`, re-run the board organization-and-company membership predicate.
- Close unauthorized sockets with policy code 1008.
- Close sockets on database/revalidation errors with code 1011 instead of logging and continuing.
- Preserve the no-op for non-cloud board sockets.

Regression coverage: active board remains; revoked board closes; DB error closes; non-cloud board does not query cloud membership.

### 5. Revalidate the exact agent key and agent status

- Carry the authenticated `agent_api_keys.id` in the socket upgrade context.
- On every authorization sweep, require that exact key to remain unrevoked and bound to the same agent/company.
- Require the agent to remain in the same company and outside `terminated`/`pending_approval`.
- Do not let another active key keep a socket opened with a revoked key alive.

Regression coverage: exact active key passes; revoked/missing/mismatched key closes; alternate key does not rescue; terminated/pending agent closes; query error closes.

### 6. Distinguish candidate-local provider failures from infrastructure failures

- Continue past personal-subscription materialization only for `ProviderCredentialBindingError`; rethrow database/filesystem/system failures.
- Introduce a typed secret-candidate-unavailable error for missing/deleted/inactive/unbound/missing-version/disabled-config cases.
- Continue to lower candidates or legacy credentials only for that typed error.
- Preserve AWS `ResourceNotFoundException` as candidate-local while propagating throttling, authentication, network, KMS, database, and audit failures.

Regression coverage: typed candidate failure falls through; generic secret/subscription failures propagate and do not invoke lower candidates or legacy; AWS not-found is typed while other AWS failures remain systemic.

## Small contract and documentation cleanup

- Remove the unused public `slug`/`plan` inputs from the shared self-serve organization-create validator so it matches the server's safe `{name}` contract.
- Trim and bound self-serve organization names and reject PostgreSQL-invalid NUL characters before slug derivation.
- Correct the PR description's stale instruction to enable unsandboxed multi-tenant execution. Hosted execution remains fail-closed until the gVisor worker plane ships.
- Reply to and resolve only the review threads proven fixed by this patch; leave intentional follow-up threads open with their existing scope notes.

## Explicitly deferred to later PRs

- Real gVisor worker execution and Gate-B hardware validation.
- Agent-to-organization runtime threading.
- Provider connection create/assignment API and UI, including connection concurrency leases.
- Worker freshness/sweeping.
- Multi-organization picker and URL namespace work.
- Dropping the company sentinel default, governed break-glass endpoints, and other handoff initiatives.

## Verification gate

1. Focused unit and integration tests for all six fixes.
2. `pnpm -r typecheck`.
3. `pnpm test:run` on a clean full rerun.
4. `pnpm build`.
5. `pnpm db:generate` with no drift.
6. `git diff --check` and forbidden-token/deploy-leak checks.
7. Independent whole-patch review against `origin/main`.
8. Commit and push to PR #316, trigger fresh Codex review, and require complete Linux CI before merge.
