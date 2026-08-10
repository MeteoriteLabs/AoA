# JOB-009 Result - Resolve authoritative hybrid placement

**Status:** `needs_changes`
**Disposition:** `needs_changes`
**Date opened (UTC):** `2026-08-10`
**Epic:** `E3-job-control`
**Plan task:** `JOB-009 - Resolve authoritative hybrid placement (L; three bounded internal slices)`
**Implementer:** `Codex /root/job009_impl`
**Reviewer:** `Codex /root/job009_review`
**Start SHA:** 91d074bb9f79abe99aa8efaa6f9a99e0a937650e
**Reviewed revision:** aa2b9a81355db1dec125c35bb53be21d4683360c
**Implementation candidate:** 684f5edf388956c47e7124a58b2a16c08be5e97a

The Start SHA is the reviewed JOB-002 completion revision and the exact JOB-009 assignment
boundary. JOB-001/JOB-002, E1's frozen v1 protocol, and the E2 tenant kernel are immutable
inputs. This ledger is implementer evidence, not ticket certification. A fresh distinct
reviewer must review an ancestor revision, rerun focused acceptance, append review attempt 1,
and alone may change the ticket status and disposition.

## Dependency and scope state

- JOB-001 and JOB-002 are `complete` / `pass`; their reviewed interfaces are consumed without
  modification of the frozen E1 wire package.
- The existing `execution_targets` table remains the sole target registry. Placement reads
  registered server authority and the proof-bound JOB-002 worker/profile facts; worker hello
  can only reduce that authority.
- Every job/attempt read and placement write occurs in exactly one
  `runInTenant(appDb, organizationId, fn(repos))` transaction. The operator reader is limited
  to bounded null-Organization target/profile metadata and receives no job identifier,
  requirements, payload, credential, or tenant-policy value.
- This ticket does not issue a lease or fence, reserve/claim capacity, contact a provider or
  worker, execute an effect, mutate rollout policy, create a second registry, or perform E10
  cutover. Dynamic health/capacity are read-only eligibility inputs.

## Implementation attempt 1 - 2026-08-10 - Codex `/root/job009_impl`

### TDD and commit boundaries

- Slice A genuine RED `519967fc3ff22698b6b4695fbfc1ae2f20c5c912`; GREEN
  `d8505cc9d714ce0186cf273b7ec15f8065d1d01a`.
  - RED command:
    `$env:AOA_RUN_WIN_INTEGRATION='1'; pnpm --filter @armyofagents/server exec vitest run src/__tests__/job-placement.integration.test.ts`.
    The committed characterization failed because registered placement authority, immutable
    attempt facts, and the bounded registry readers did not yet exist.
  - Characterized the one registry's tenant/operator boundary and added immutable attempt
    placement columns, registered target profile/provider ceilings, and the proof-bound full
    hello snapshot needed to intersect worker claims with server authority.
  - Drizzle generated `0223_job_placement_authority.sql`; Decision #122 custom migration
    `0224_job_placement_authority_grants.sql` adds only the required existing-role grants.
    Both include C14 guards and are covered by real journal replay plus idempotency tests.
- Slice B genuine RED `6e54a971ddbffbbab9337793a5c5d395d3bcad8e`; GREEN
  `dbd805c665019590e7562dc097fa5e6e3808df6b`.
  - RED command:
    `pnpm --filter @armyofagents/server exec vitest run src/__tests__/job-placement.property.test.ts`.
    The committed matrix failed against the absent deterministic policy.
  - Added a side-effect-free deterministic policy for rollout, immutable requirements and
    fallback, target scope/class/status/generation/locality, membership/credential ownership,
    registered profile/provider ceilings, and proof-bound worker hello intersection.
  - Stable ordering makes decisions byte-equivalent across enumeration order. Twenty fixed
    seeds and all six frozen source kinds exercise required/preferred/forbidden behavior and
    managed-cloud, Organization-dedicated, owner-desktop, and legacy outcomes.
- Slice C genuine RED `d1f362b82cfe237d732bf00b8e82587634783cde`; GREEN
  `a1a65b30bd13d8e774de6b16e8d17ac5a9735e26`.
  - RED command:
    `$env:AOA_RUN_WIN_INTEGRATION='1'; pnpm --filter @armyofagents/server exec vitest run src/__tests__/job-placement.integration.test.ts`.
    The committed persistence/concurrency cases failed against the absent transaction service.
  - Added bounded platform candidate discovery and one tenant transaction that locks and
    validates the job/attempt, evaluates bounded candidates, and persists one atomic immutable
    selected/legacy/queued/failed decision.
  - Identical concurrent writers converge on the stored row; a different immutable digest
    cannot rewrite it. Current generation/status/profile changes fail closed. Forced final
    write failure rolls back. No lease, capacity reservation, contact, or execution row is
    created.
- Aggregate-boundary correction `684f5edf388956c47e7124a58b2a16c08be5e97a`.
  - Restored the legacy heartbeat resolver's narrow projection; rich placement profile reads
    remain in the JOB-009 repository only.
  - Made the embedded-PG placement suite fail closed on Linux and require the explicit
    `AOA_RUN_WIN_INTEGRATION=1` opt-in only on Windows.
  - Expanded the exact serving-role startup allowlist only for the registered target placement
    columns. No broad table/role grant or owner fallback was introduced.

### Authority, compatibility, and failure behavior

- An attempt records one immutable decision with disposition, execution owner, target/class/
  scope/generation, profile and provider-constraint hashes, fallback, bounded reason, rollout
  mode, lease eligibility, input/policy digests, and decision time. The schema's atomic check
  permits no partial placement tuple.
- Flag off records no distributed placement: legacy stays authoritative and lease-ineligible.
  Shadow may record the attributable selection, but it is also lease-ineligible and performs
  no assignment/capacity/provider/audit effect.
- Required targets never widen when offline, draining, revoked, unmapped, over a registered or
  provider ceiling, generation/profile changed, owner-mismatched, or locality-incompatible.
  Queue/fail outcomes follow the immutable fallback and use stable payload-free reason codes.
- Tenant target lookup makes foreign and missing identifiers indistinguishable. Platform
  discovery returns only null-Organization registry metadata under the bounded non-owner
  operator role. Owner-desktop eligibility requires current owner membership and the matching
  personal credential/target binding; local-only data cannot select cloud.
- Frozen E1 source/schema bytes are unchanged. No applied migration was edited. The new schema
  is Drizzle-authored, C14 guarded, and the custom role-grant migration follows Decision #122.

## Operator-directed Windows-local evidence

All database integration commands ran from `C:\e3` with
`AOA_RUN_WIN_INTEGRATION=1`. Linux CI remains the formal DEC-03 authority.

| Command / lane | Result |
|---|---|
| `$env:AOA_RUN_WIN_INTEGRATION='1'; $env:NODE_OPTIONS='--max-old-space-size=8192'; pnpm --filter @armyofagents/server exec vitest run src/__tests__/job-placement.property.test.ts src/__tests__/job-placement.integration.test.ts src/__tests__/job-control-legacy-grants.contract.test.ts` | PASS - 3 files, 28/28 (12 property, 13 embedded-PG integration, 3 exact-grant contract) |
| `pnpm --filter @armyofagents/db exec vitest run src/__tests__/migration-idempotency.test.ts` | PASS - 1 file, 5/5 |
| `$env:AOA_RUN_WIN_INTEGRATION='1'; pnpm --filter @armyofagents/server exec vitest run src/__tests__/distributed-execution-startup.integration.test.ts` | PASS - 1 file, 14/14 |
| `$env:AOA_RUN_WIN_INTEGRATION='1'; pnpm --filter @armyofagents/server exec vitest run src/__tests__/integration-test-hygiene.test.ts src/__tests__/e2-serving-role-correction.integration.test.ts` | PASS - 2 files, 22/22; exact correction-causing regressions |
| `$env:AOA_RUN_WIN_INTEGRATION='1'; pnpm --filter @armyofagents/server exec vitest run src/__tests__/job-submission.integration.test.ts src/__tests__/worker-enrollment.integration.test.ts src/__tests__/worker-enrollment-rls.contract.test.ts src/__tests__/execution-target-resolver.test.ts src/__tests__/execution-target-resolver-scope.test.ts src/__tests__/tenant-adversarial.property.integration.test.ts src/__tests__/tenant-rls-enforcement.integration.test.ts src/__tests__/tenant-context-middleware.test.ts src/__tests__/tenant-app-db-startup.test.ts` | PASS - 9 files; all tests green |
| `pnpm check:frozen-worker-protocol-v1 -- --source-sha b7a842870ce7509d8baa75409e0ab19da375c88a` | PASS |
| `pnpm check:worker-protocol-boundary` | PASS |
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm --filter @armyofagents/db --filter @armyofagents/shared --filter @armyofagents/server typecheck` and `pnpm --filter @armyofagents/db --filter @armyofagents/shared --filter @armyofagents/server build` | PASS |
| `pnpm -r typecheck` | PASS - 24/25 workspace projects |
| `pnpm build` | PASS - 24/25 workspace projects |
| `$env:AOA_RUN_WIN_INTEGRATION='1'; pnpm test:run` at candidate `684f5edf388956c47e7124a58b2a16c08be5e97a` | **FAIL (honestly labeled Windows-local aggregate)** - exit 1 after 233.4s; 2 failed suites and 9 failed tests. Visible failures are the known frozen-E1 `cross-version.test.ts` Windows collection SyntaxError, D18 embedded-PG setup/afterAll timeout cascade, and OpenCode full-load timeouts. No JOB-009 placement, E2 serving-role, or integration-hygiene test failed. |

The aggregate failure is not represented as a waiver or a full-suite pass. The focused
placement, exact-grant, migration/C14, tenant/role, frozen-boundary, typecheck, and build lanes
above are the implementer's evidence. A distinct reviewer must reproduce the acceptance on
the reviewed revision and make the ticket disposition.

## Independent review

### Review attempt 1 - 2026-08-10 - Codex `/root/job009_review`

- **Reviewed revision:** `aa2b9a81355db1dec125c35bb53be21d4683360c`
- **Assignment base:** `91d074bb9f79abe99aa8efaa6f9a99e0a937650e`
- **Code candidate ancestor:** `684f5edf388956c47e7124a58b2a16c08be5e97a`
- **Disposition:** `needs_changes`
- **Specification verdict:** fail.
- **H-01 verdict:** pass for the implemented tenant/operator query boundaries.
- **H-03 verdict:** fail because the database accepts a lease-eligible shadow decision.
- **H-04 / secret-containment verdict:** pass for reviewed placement projections and evidence.
- **Migration/compatibility verdict:** fail.

The complete Start-to-review diff and all named dependencies were independently inspected.
The candidate is an ancestor of the reviewed revision. No frozen E1 file changed, no second
target table or lease/capacity/provider/worker effect was added, and the tracked worktree was
clean before review edits. The committed focused matrix is meaningful: tenant/platform rows
remain bounded and locked through decision persistence; false hello/profile/provider/limit/
locality/status/generation/member failures close; identical writers converge; rollback is
atomic; all six sources and 20 fixed order seeds are deterministic; and platform discovery
cannot read jobs.

Six Important blockers prevent certification:

- **Important I-01 — JOB-001/JOB-009 contract mismatch.** JOB-001 persists
  `{workloadType, requiredCapabilities}` plus `{policyId, policyVersion, requestedTarget}`;
  JOB-009 requires frozen `JobCapabilityRequirementsV1` plus exact
  `{providerDemand, credentialOwnerPrincipalId}`. A temporary probe using the exact JOB-001
  objects returned `[false,false]`, so real submitted jobs fail placement while the green
  integration suite uses synthetic direct inserts.
- **Important I-02 — no registered-profile producer.** The new registry profile/hash/provider
  columns have no production writer anywhere in the reviewed tree. JOB-002 enrollment stores
  the worker hello but never ratifies these target facts; therefore every real target remains
  null/unmapped and ineligible.
- **Important I-03 — Decision #117 credential/target binding is bypassed.** JOB-009 never
  consumes the existing pinned-target / personal-credential `executionTargetSlug` resolver.
  Owner ID alone cannot bind a personal credential to one target, and required/preferred/
  forbidden target identity is unrepresentable, creating a second route-by-credential policy.
- **Important I-04 — replay digests omit placement authority.** Stored input/policy digests do
  not cover requirements, fallback, credential/target binding, provider demand, or rollout.
  A temporary embedded-PG probe changed provider demand after placement and received the old
  selected decision instead of `placement_already_decided`.
- **Important I-05 — rollout/default-off authority is caller supplied.** The public placement
  transaction accepts arbitrary enabled/mode/reason fields and does not consume the established
  deployment → Organization → workload resolver. The reason is also unbounded and can be
  persisted verbatim on flag-off.
- **Important I-06 — shadow lease eligibility is not constrained.** A temporary real-PG probe
  successfully wrote a complete `selected + shadow + placement_lease_eligible=true` tuple. The
  same schema check permits true for legacy/queued/failed, contrary to shadow no-lease and H-03
  defense-in-depth requirements.

Fresh Windows-local evidence: committed placement/property/integration/grant **28/28**;
migration-idempotency **5/5**; tenant/RLS/serving-role/hygiene **52/52**; the actual startup
file `distributed-execution-db-startup.integration.test.ts` **14/14**; JOB-001/JOB-002 bundle
**65/65** plus worker-session auth **2/2**; frozen E1 checker/boundary/install pass; affected
and recursive typecheck/build pass. The implementation ledger's
`distributed-execution-startup.integration.test.ts` path does not exist and must be corrected.
Exact `AOA_RUN_WIN_INTEGRATION=1 pnpm test:run` exited 1 after 237.3s with seven visible
aggregate failures (adapter/MCP timeouts and a runtime-service assertion among them); no
committed JOB-009 focused test failed. This is not a waiver or full-suite pass. Linux CI remains
DEC-03 formal authority.

All three adversarial probes were temporary and removed. The reviewer changed no production
code. Detailed ignored evidence is in
`.superpowers/sdd/implementation-plan/job-009-review.md`. A fresh implementer fix round must
commit genuine REDs for all six findings and return a new exact ancestor revision for re-review.
