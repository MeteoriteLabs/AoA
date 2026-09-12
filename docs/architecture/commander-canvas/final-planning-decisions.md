# Universe — final planning decision packet

September 12, 2026. **Planning only. No implementation, qualification execution, provider spend, draft reuse/deletion or merge is authorized by this document.**

## Where we stand

The complete packet received independent review, author corrections and re-review. Claude's [focused review of ac7b9a494](focused-review-report.md) was independently checked against the plans: attention ownership and layout save/restore gaps are closed at the planning-contract level. The optional onViewportChange wording clarification does not change the interface. That focused review is not a fresh all-slice audit; runtime tests and UAT remain unrun.

Keep the agreed nine epics, 31 slices, 69 increments and release allocation: 30 V1 slices; E3.4 V2; multi-screen deferred after the desktop app. Complete and verify V1 before V2 implementation. The remaining items below are explicit decisions and engineering evidence, not permission to silently reduce V1.

**Recommendation:** finish these decisions, produce a versioned execution authorization for a bounded first batch, and only then implement. User acceptance of this packet or its recommendations alone does not authorize coding.

## D1 — Exact base and integration sequence

**Fresh read-only evidence:** remote refs were checked with git ls-remote in this pass.

| Reference | Observed SHA | Meaning |
|---|---|---|
| Remote docs/replatform-program | 183e46a9c65fc3105c7e3d125629276814df7dbb | Same source revision reviewed by the planning packet |
| Remote main | e097d2f9332a2715bdbaf2058a4b751481107713 | Ancestor and merge-base of the pinned replatform source |
| Reviewed Universe head before this status update | ac7b9a494f9e3207142d77405036685445a4332f | Documentation-only descendant of that source |
| Local docs/replatform-program branch | bc2a5b8dfc3ad96f8ad765298ade54cc70cdcb18 | Nine commits behind remote, zero local-only commits; not the reviewed source |

**Recommendation:** retain the existing codex/universe-interface branch and the exact remote source pin above. Do not create another branch or reset to the stale local replatform branch. This confirms source identity/ancestry, not that the base is runtime-stable.

Before the first authorized runtime batch, recheck remote heads, source collisions and owning upstream findings at the selected revision. No contract delta is needed merely for this documentation update because the remote source has not moved. BASE engineering qualification remains open: reproduce the baseline in the intended Linux test environment, record typecheck/test/build results and attribute inherited failures separately. No runtime checks ran in this pass.

After coding is authorized, one assigned integrator checks upstream at each slice start and before integration. Merge reviewed upstream changes into the same published Universe branch at a controlled boundary, preserving review history; do not force-push/rewrite reviewed commits. Revalidate affected contracts, generated migrations and tests. Final sequence remains replatform landing in main → reconcile actual main into Universe → verify complete V1 → separately authorized merge/release. A blocked dependency blocks its consumers, not all V1 work.

**Decision state:** same-branch strategy already accepted; recommendation to retain this exact execution candidate awaits final execution record and BASE evidence. No sync/merge is performed here.

## D2 — Storage and security authority

The current non-owner aoa_app grants for assets/artifacts/artifact_versions are SELECT-only. See [E4.1 alternatives](coding-plans/e4-1.md#constraints-and-source-evidence). A single transaction cannot span separate owner/non-owner connections.

| Choice | Benefit | Cost / boundary |
|---|---|---|
| A — existing company-scoped authority for human intake | Matches canonical asset writes; no new legacy DML grants | Every intake/receipt/query still enforces company, actor and destination; not an owner fallback for distributed execution |
| B — organization-owned ledger plus reviewed write grants | Could compose permitted writes in one non-owner transaction | Requires privilege expansion, exact role trace and separate security migration/review |
| C — organization-owned ledger plus durable publication protocol | Preserves existing legacy grants | Two-transaction intent/receipt recovery, cancellation and crash protocol must be fully specified |

**Recommendation:** A for human original intake only. If a distributed derivative/index or executable-host grant ledger must be organization-owned, prefer investigating C before expanding grants under B. This is a direction for security design, not a selected implementation for every ledger.

The security decision must classify each store separately: original-intake records, derivatives, asset index, generation/publication receipts, E5 grant ledger. Record company versus organization ownership, actor/destination access, actual connection role, canonical writer, source lineage, retention, migration and recovery protocol. E1 personal UI tables remain their already-planned company/user scope; do not apply a blanket RLS retrofit or modify the frozen grant manifest.

**What TK decides:** accept or revise the proposed product/security boundary and nominate an accountable security decision-maker. **What engineering owes:** the exact role/transaction trace, threat review and synchronized E4/E5 plans before any affected schema/service implementation. Tests must then prove the selected protocol. No schema choice or grant change is approved by this packet.

## D3 — Voice/media permitted paths

OpenAI, Gemini and ElevenLabs realtime integrations, plus the accepted image/audio/video generation scope, remain V1. This packet makes no new claim about a vendor's current SDK, pricing or feature availability.

**Recommendation for an explicit policy amendment:** allow the qualified realtime speech and media-generation paths as purpose-scoped capabilities using the company's configured, access-controlled credential references. Preserve per-user/session authorization where required. Keep ordinary agent/Commander/extraction execution under the existing deployment/CLI rules; do not interpret a speech/media exception as a general direct-model API or shared-host fallback.

Providers owns connection/readiness and allowed capabilities; Secrets owns credential storage/access; Budget & caps owns spending limits. Reuse existing owners rather than another Universe credential or budget system. Starting voice remains explicit, AoA raw-audio recording defaults off, and no secret is stored in canvas state, prompts or evidence. Provider retention must be verified separately from AoA recording preferences.

For each provider/path, bind credential class, recipient/session permissions, local/cloud execution location, browser-safe session authorization if supported, retention/region policy, revocation, budget admission, cancellation and uncertain-outcome behavior. Research and qualify exact vendor contracts before selecting SDKs. The #104 cloud_auth extraction amendment is not itself permission for direct speech/media calls.

**What TK decides:** permit/reject the proposed narrowly scoped policy extension and any material retention/cost tradeoff revealed by the concrete design. **What engineering owes:** an amendment compatible with locked decisions, separate reviewed provider contracts and requested limits before any credentials, provider sessions or spend. Qualification execution requires its own explicit scope and authorization. Until then, these V1 integrations remain gated; no scope cut or provider execution is assumed.

## D4 — Accountable owners and gate evidence

Proposed responsibility model: TK retains product acceptance and identifies/accepts accountable people; the eventual implementation owner records evidence; an independently assigned reviewer checks it. Claude review is user-managed. Neither Claude nor this assistant is silently appointed security approver or upstream maintainer.

| Gate / work | Proposed accountable role (person unassigned) | Required before affected work is accepted |
|---|---|---|
| BASE and branch integration | Replatform integrator + Universe lead | Exact SHA, source/migration/collision review, baseline/candidate test attribution |
| DESIGN | Product/design owner with TK acceptance | Accepted U01–U10 and omitted/error/narrow/accessibility states; actual task-route defect evidence |
| CMD | Replatform Commander owner | E10-F001 routing, per-user credentials and interactive-result delivery evidence |
| BROWSER | Browser/runtime owner | E6.0 compatible adapter, local/cloud stream, epoch takeover and reconnect qualification |
| CLOUD | Cloud/security owner | Existing tier ruling inherited; E8-F012 credential-isolation/disclosure evidence |
| PROFILE | Accounts/browser-security owner | E8-F011 access, encryption/TTL evidence, purge/audit and revocation |
| APPROVAL | Replatform decision-service owner | E8-F001/F004 canonical authority and stranded-answer recovery |
| VOICE | Provider integration owner + security reviewer | D3 policy, actual session contracts and per-provider qualification |
| HOST | Isolated-content owner + security reviewer | E5.2 origin/CSP/bridge, grant scope, revocation and resource controls |
| E4/E5 data authority | Security/DB owner | D2 per-store classification and selected publication protocol |
| Converter/index distribution | Worker/format owner | Pinned builds, containment/format/native-output tests and destination-scoped retrieval |
| Terminal follow-up capture | Routines/task-service owner | Exhaustive terminal/reopen writer map or proved outbox; commit/crash coverage |

This is the complete nine-gate core register plus the additional named engineering obligations, not a claim that people have accepted assignments. Pinned E10-F001 is explicitly open; E8 finding records remain inputs to their respective gates. Re-read each at execution base before claiming closure. A gate closes through source and observed evidence, never because a role label or design document exists.

**Decision state:** accountable identities unassigned; no work is dispatched to others by this packet. Owners may qualify independent V1 portions, but whole-slice and V1 acceptance require every promised part. The [formal UAT plan](user-acceptance-plan.md) distinguishes engineering proof from TK/delegate product sign-off.

## D5 — Premature draft disposition

Read-only status of .worktrees/universe-e1-1 still shows uncommitted package.json, pnpm-lock.yaml, ui/package.json and untracked Universe component/harness/test/document paths. No adoption, deletion, commit, checkout or modification occurred. The accepted Universe worktree remains separate.

**Recommendation:** preserve the draft untouched as an excluded historical reference through the first approved replacement's acceptance; do not merge, cherry-pick or use it as implementation input by default. Then decide cleanup explicitly. This avoids destructive cleanup now and avoids treating premature work as accepted work.

Alternatives are explicit later deletion of verified draft-only paths/branches, or individually reviewed reuse with provenance and fresh tests. Any reuse changes the implementation input and must be reviewed before adoption. No automatic deletion schedule or cleanup authorization is created here.

**Decision state:** awaiting TK's choice; default remains the existing untouched/excluded state.

## First-batch proposal and approval boundary

After D1 and responsibility decisions, recommend a bounded preparation authorization for E0.1 runtime-baseline checks and E1.0 outstanding state review, with explicit environment/commands and no provider sessions. This would require TK authorization because existing instructions reserve runtime qualification as well as coding.

The first coding candidate is E1.1 (shared panel/controller), only after BASE/DESIGN and its package/build compatibility plan are ready and TK explicitly approves that batch. Then E1.2–3 state/drafts and subsequent consumers follow the actual producer order. D2/D3 need not block unrelated E1.1 presentation work, but block their own E4/E5/provider increments. Do not label a preparation approval as permission to start E1.1, or E1.1 approval as authority for all V1.

Before requesting implementation approval, fill this record with concrete values:

| Field | Required entry |
|---|---|
| Reviewed plan | Exact published SHA and resolved findings |
| Execution base | Exact source SHA and baseline result/known failure disposition |
| Approved work | Named slices/increments, files and qualification commands |
| Owners/reviewers | Accepted actual identities, including upstream dependencies |
| Gate status | Evidence and unresolved exclusions for this batch |
| Runtime/spend | Explicit allowed environment, dependency changes and any provider/spend limits; none implicit |
| Draft disposition | TK decision and provenance rule |
| Validation/rollback | Tests/UAT expected, failure handling and feature-disable plan |
| User authorization | TK's explicit instruction and date; currently absent |

No approval is recorded yet. Accepting the plan, reviewing this packet, or saying to continue planning cannot fill the last row.

## Proposed decision order

1. Confirm D1's unchanged remote pin and name the integrator.
2. Discuss D2 security direction and accountable reviewer.
3. Discuss D3 scoped policy amendment; return with concrete vendor-specific tradeoffs when researched.
4. Resolve D4 identities and D5 draft disposition.
5. Review the concrete bounded preparation authorization; only later review an implementation authorization.

These decisions can be discussed together, but each gets an explicit outcome, owner and affected scope. Do not ask TK to re-decide the already accepted tray/UI, version allocation, branch direction or upstream tier ruling.
