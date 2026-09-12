# Universe — final planning decision packet

September 12, 2026. **Planning only. No implementation, qualification execution, provider spend, draft reuse/deletion or merge is authorized by this document.**

## Where we stand

The complete packet received independent review, author corrections and re-review. Claude's [focused review of ac7b9a494](focused-review-report.md) was independently checked against the plans: attention ownership and layout save/restore gaps are closed at the planning-contract level. The optional onViewportChange wording clarification does not change the interface. That focused review is not a fresh all-slice audit; runtime tests and UAT remain unrun.

Keep the agreed nine epics, 31 slices, 69 increments and release allocation: 30 V1 slices; E3.4 V2; multi-screen deferred after the desktop app. Complete and verify V1 before V2 implementation. The remaining items below are explicit decisions and engineering evidence, not permission to silently reduce V1.

**Recommendation:** finish these decisions, produce a versioned execution authorization for a bounded first batch, and only then implement. User acceptance of this packet or its recommendations alone does not authorize coding.

## Accepted direction and remaining engineering work

TK asked to follow the recommendations, update the plan and review it, after the asset experience explanation. Record this as acceptance of the recommended planning direction, not execution authorization:

- **Human assets:** A is selected: reuse canonical company-scoped assets, with actor/destination permissions, recoverable originals, independent processing and immutable derived outputs. Company-scoped does not mean visible to all company members.
- **Branch:** continue on the existing Universe branch using the reviewed remote replatform direction; revalidate its exact execution revision and evidence before runtime work.
- **Premature draft:** preserve untouched and excluded as recommended. Later deletion or any reuse still needs a separate explicit decision.
- **Voice/media:** proceed with designing the recommended narrowly scoped credential policy. This accepts the direction, not a particular SDK, credential grant, direct-API amendment, retention term or spend authorization; these concrete details still need review.
- **Ownership:** retain the proposed implementation/reviewer/product separation. Actual people have not been named or appointed by this acceptance.

This request authorizes planning edits and author review. It does not authorize code, runtime qualifications, provider sessions, secret access, migrations or tests of the premature implementation. The material upload-path changes received [focused Claude review at abbfc3c7e](human-intake-review-report.md), now checked against source/plans: no material findings. This closes selected A's consistency-review round. Exact security evidence and runtime qualification remain open; later material changes still require review.

## D1 — Exact base and integration sequence

**Fresh read-only evidence:** remote refs were checked with git ls-remote in this pass.

| Reference | Observed SHA | Meaning |
|---|---|---|
| Remote docs/replatform-program | 183e46a9c65fc3105c7e3d125629276814df7dbb | Same source revision reviewed by the planning packet |
| Remote main | e097d2f9332a2715bdbaf2058a4b751481107713 | Ancestor and merge-base of the pinned replatform source |
| Reviewed Universe head before this accepted-direction update | 51e5b36daf8680749ddb3918857a14a699c1c060 | Documentation-only descendant of that source; includes the focused-review record |
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

**Accepted planning choice:** A for human original intake only. If a distributed derivative/index or executable-host grant ledger must be organization-owned, prefer investigating C before expanding grants under B. The human-intake choice is selected. The subsequent [worker-publication proposal](worker-publication-plan.md) recommends application-owned derivative/index/receipt and tool-grant records, reusing the existing organization-owned committed job ledger across a C-style reconciliation boundary. This avoids adding organization-owned projections solely because a worker produces their input. It is a concrete technical recommendation awaiting independent/security acceptance, not an accepted blanket A/C decision.

The security decision must classify each store separately: original-intake records, derivatives, asset index, generation/publication receipts, E5 grant ledger. Record company versus organization ownership, actor/destination access, actual connection role, canonical writer, source lineage, retention, migration and recovery protocol. E1 personal UI tables remain their already-planned company/user scope; do not apply a blanket RLS retrofit or modify the frozen grant manifest.

**Product boundary accepted:** human intake stays on existing asset authority with private destination access. TK still needs to identify/accept the accountable security decision-maker; do not re-ask A/B/C for human intake absent new evidence. **What engineering owes:** the exact role/transaction trace, threat review and synchronized E4/E5 plans before any affected schema/service implementation. Tests must then prove the selected protocol. The selected application data class is reflected in E4.1, but its exact migration/role trace and runtime implementation remain unapproved. No grant expansion is approved.

## D3 — Voice/media permitted paths

OpenAI, Gemini and ElevenLabs realtime integrations, plus the accepted image/audio/video generation scope, remain V1. This packet makes no new claim about a vendor's current SDK, pricing or feature availability.

**Accepted direction; exact policy amendment pending:** allow the qualified realtime speech and media-generation paths as purpose-scoped capabilities using the company's configured, access-controlled credential references. Preserve per-user/session authorization where required. Keep ordinary agent/Commander/extraction execution under the existing deployment/CLI rules; do not interpret a speech/media exception as a general direct-model API or shared-host fallback.

Providers owns connection/readiness and allowed capabilities; Secrets owns credential storage/access; Budget & caps owns spending limits. Reuse existing owners rather than another Universe credential or budget system. Starting voice remains explicit, AoA raw-audio recording defaults off, and no secret is stored in canvas state, prompts or evidence. Provider retention must be verified separately from AoA recording preferences.

For each provider/path, bind credential class, recipient/session permissions, local/cloud execution location, browser-safe session authorization if supported, retention/region policy, revocation, budget admission, cancellation and uncertain-outcome behavior. Research and qualify exact vendor contracts before selecting SDKs. The #104 cloud_auth extraction amendment is not itself permission for direct speech/media calls.

**Direction accepted:** prepare the narrow speech/media extension. TK will review the concrete policy text and material retention/cost tradeoffs; accepting the direction does not approve unspecified terms or provider spend. **What engineering owes:** an amendment compatible with locked decisions, separate reviewed provider contracts and requested limits before any credentials, provider sessions or spend. Qualification execution requires its own explicit scope and authorization. Until then, these V1 integrations remain gated; no scope cut or provider execution is assumed.

### What the voice/media decision means in practice

The user selects an available provider in the existing Providers settings and connects an authorized credential through Secrets. Universe reflects readiness; it does not ask for a second API key. CLI login alone does not make voice ready. End voice ends that connection while the blob can remain visible; mic mute and speaker silence are independent, and hiding chat/blob does not silently change those settings.

The connection must carry only the authority needed for speech/media and the chosen conversation. The browser must not receive a long-lived company provider key. Engineering will select a supported short-lived session mechanism or an authenticated proxy after vendor-contract review; lack of a safe supported path blocks that integration. Speech can convey intent to Commander, but providers cannot bypass task authorization, approval or budgets.

Cost decisions include which company/provider budget applies, admission when limits are reached and how to explain an uncertain billable result. Existing Budget & caps stays the owner. A lost generation response requires a status check before retry where supported; absent reliable observation must be shown as unknown, not automatically billed again. The plan does not select amounts or authorize paid tests.

Privacy decisions include what text/audio/files leave AoA, provider retention and region restrictions, plus whether a deployment permits that provider at all. AoA raw-audio recording off does not establish zero provider retention. If a provider cannot meet the accepted policy, surface unavailable with its reason; do not silently switch accounts/providers or weaken privacy. Concrete unsupported capabilities and material tradeoffs return to TK before implementation.

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

### What responsibility means here

These are review responsibilities, not a requirement to hire one person per row. An agreed engineer or agent can own several areas, but the author must not claim independent review of their own implementation. TK can continue handing review packets to Claude. The implementer documents the actual test environment and results; the reviewer checks the contracts and evidence; TK accepts experience and material policy choices. An AI plan review does not stand in for observed integration tests or upstream maintainer acceptance.

I will prepare the technical proposals and explain their consequences; TK need not choose database mechanics. Names or delegated authority are needed before a gated batch begins, so issues have an accountable resolver. Upstream work remains with its actual program until that program accepts responsibility—this document creates no assignments or promises on its behalf.

## D5 — Premature draft disposition

Read-only status of .worktrees/universe-e1-1 still shows uncommitted package.json, pnpm-lock.yaml, ui/package.json and untracked Universe component/harness/test/document paths. No adoption, deletion, commit, checkout or modification occurred. The accepted Universe worktree remains separate.

**Accepted disposition for now:** preserve the draft untouched as an excluded historical reference through the first approved replacement's acceptance; do not merge, cherry-pick or use it as implementation input by default. Then decide cleanup explicitly. This avoids destructive cleanup now and avoids treating premature work as accepted work.

Alternatives are explicit later deletion of verified draft-only paths/branches, or individually reviewed reuse with provenance and fresh tests. Any reuse changes the implementation input and must be reviewed before adoption. No automatic deletion schedule or cleanup authorization is created here.

**Decision state:** preserve untouched/excluded accepted. Later cleanup or reuse remains a separate decision, with no automatic trigger.

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
2. Complete the selected human-intake security trace; discuss separate distributed-store choices and accountable reviewer.
3. Draft D3's exact scoped policy amendment; return with concrete vendor-specific tradeoffs when researched.
4. Resolve D4 identities; retain D5's accepted untouched/excluded draft disposition.
5. Review the concrete bounded preparation authorization; only later review an implementation authorization.

These decisions can be discussed together, but each gets an explicit outcome, owner and affected scope. Do not ask TK to re-decide the already accepted tray/UI, version allocation, branch direction or upstream tier ruling.

## Next planning deliverables after the human-intake review

1. Review the now-drafted [worker-publication proposal](worker-publication-plan.md): per-store authority, verified durable copy, receipts, cancellation and recovery are specified and propagated to E4/E5. Exact processor admission, accepted output binding, revocation coordination and retention qualification remain open. Keep ordinary human intake independent.
2. Prepare the concrete D3 speech/media policy and provider contract packet, researching current official vendor contracts before recommending credentials, SDKs or retention terms. Present material product/cost/privacy decisions to TK; do not run providers.
3. Complete the reviewer/responsibility record with actual accepted identities. Do not invent assignments or treat the author as an independent reviewer.
4. Prepare the bounded BASE/DESIGN qualification proposal: exact replatform SHA, environment, commands, expected evidence and inherited-failure handling. Bring the concrete scope to TK before any execution; qualifications do not authorize coding.
5. After reviewed findings and applicable gates are resolved, present the first E1.1 implementation batch for explicit approval.

The human-upload decision does not need another unchanged review round. The two low observations require no architecture change: the summary inventory is intentionally representative, and organization metadata must never grant access. Keep the existing same-organization/cross-company denial cases mandatory when tests are implemented. Draft preservation remains accepted; cleanup timing is a later decision, not a blocker for unrelated planning.

## Worker-publication review follow-up status

[Received review](worker-publication-review-report.md) and [author disposition](independent-review-response.md#worker-publication-review-disposition) distinguish supported design conclusions from open qualifications. M2 is tightened in the publication plan. [M1/M3 detailed proposal](worker-publication-identity-revocation.md) defines stable action/slot identity, acceptance binding and authorization-barrier ordering. Security/CMD acceptance, complete permission/credential writer coverage and runtime evidence remain open. LOW-1's cascade concern was disproved at pinned source. Review this material follow-up before declaring generated publication accepted; the next separate planning area remains voice/media policy. No provider calls or implementation are authorized.

## Current status after the reconciliation review

The [review of a033e17c0](worker-publication-reconciliation-review-report.md) closes the focused worker-publication consistency round. [Qualification record](worker-publication-qualification.md) separates existing source seams from missing CMD bindings, expands permission/credential coverage and specifies contention checks. M2 is design-resolved; M1/M3 remain qualification-gated. Documented ordering is not proof of deadlock freedom.

We are done with this review's reconciliation, not all execution prerequisites. Next planning work is the D3 speech/media policy, accepted responsibility identities, and a concrete bounded BASE/DESIGN preparation proposal. Continue static CMD/writer tracing as producer evidence becomes available. Actual security acceptance and observed tests remain required for affected paths; independently review material new mechanisms, not the same unchanged packet repeatedly. No user implementation or runtime authorization is recorded.

## D3 concrete review packet prepared

The [voice/media policy proposal](voice-media-policy.md) now contains the narrow amendment, credential/deployment boundaries, session lifecycle, budget/revocation requirements, retention options, media outcome recovery and E3/E4/E8 mapping. [Fresh official evidence](voice-media-provider-evidence.md) records protocol/price/retention differences and Sora's scheduled retirement. All three V1 voice providers and video scope remain intact; GPT-Live is an OpenAI comparison candidate, not a backend replacement.

On September 12, 2026, TK accepted company-admin acceptance of disclosed provider terms, with AoA recording off by default and stricter company requirements enforced. TK confirmed that the disclosure, acceptance and company privacy settings belong in Providers voice configuration. Universal mandatory zero retention was not selected. This product decision is not acceptance of actual vendor terms or activation of any account. The controlled relay path and exact narrow amendment remain proposed for review. This completes the D3 drafting/research deliverable, not D3 approval or runtime qualification. Next: review this material proposal and record TK decisions; then accepted responsibilities and the bounded BASE/DESIGN preparation record. No coding/provider spend is authorized.
