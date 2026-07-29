<!-- /autoplan restore point: C:\Users\TK\.gstack\projects\MeteoriteLabs-AoA\codex-access-required-provider-ux-plan-20260728-autoplan-restore-20260728-010252.md -->
# Access-required onboarding and provider execution plan

**Date:** 2026-07-28
**Status:** Reviewed and ready for implementation approval
**Target:** `testing.armyofagents.org`, a dedicated `remote_single_tenant` QA deployment

## Confirmed premises

1. The testing deployment remains a dedicated single-tenant execution environment. It is not an open hosted multi-tenant runtime.
2. Human authentication is multi-user, but company provisioning is governed: only instance administrators may create or import a company. Other users join through an invitation.
3. AOA Google identity and Codex/Claude subscription identity are independent. A founder may authenticate a provider with a different provider account.
4. Subscription credentials remain scoped by company, user, provider, and execution target. The shared Linux process identity is not a tenant security boundary.
5. Authentication validity, execution compatibility, and agent binding are separate states. A failed execution check must not invalidate a valid credential.
6. Public product copy uses AOA. Internal compatibility paths, database names, and wire contracts are not renamed by this change.
7. Personal Codex/Claude subscription authentication is a dedicated-instance convenience path for Commander, not the default durable credential model for unattended agents.
8. API keys are supplied to the existing CLI adapters through their scoped execution environment. This plan does not add SDK/API execution adapters or a hosted cloud-agent path.

## User outcomes

- An authenticated user always reaches exactly one valid state: founder onboarding, invited joining, returning lobby, or access required.
- An uninvited non-admin never sees company-creation UI and never enters founder onboarding.
- Every onboarding screen has an obvious account escape so a user can sign out and switch accounts.
- Route transitions never flash the lobby, switch to a light background, or move the page unexpectedly.
- Codex and Claude subscription sign-in and API-key setup explain their true scope and report credential verification separately from execution readiness.
- Release QA proves Commander subscription execution and ordinary-agent API-key execution without exposing a general-purpose “run smoke turn” UI.

## Root causes

### Journey classification

`getJourneyForUser` already gives an instance administrator visibility to an existing company and allows an administrator on an empty instance to become founder. The narrow defect is the pure resolver's final fallback: a non-admin with no eligible membership or invitation is classified as `founder`. The company-create endpoint then correctly rejects that user with `403 Instance admin required`.

Membership and administrator fallback queries also need an explicit eligible-company rule: archived companies must not produce `returning`, and target choice must be deterministic.

### Lobby flash and false recovery

`LobbyLayout` mounts before the index child resolves the journey. The sidebar therefore renders and runs its mount animation while the child is still deciding whether to redirect. A failed journey request also falls through to `Lobby`, where zero-company creation actions may render.

### Navigation dead end

`FlowEngine` intentionally hides Back on the first step because navigating to `/` sends the same founder back to onboarding. There is no separate account escape.

### Layout movement

The onboarding shell conditionally gains a vertical scrollbar, and every step is vertically centered with `my-auto`. Different content and error heights therefore change both the horizontal scrollbar footprint and vertical anchor.

### Provider scope and execution proof

The provider Settings copy still says subscription sign-in applies to every company on the machine. The implementation now writes to a company/user/provider/execution-target scoped auth home. The login process slot is host-shared, but the credential is not.

Successful login automatically verifies and binds the credential only to Commander. Founder-gated APIs for ordinary-agent bindings exist, but their current mutation invariants do not establish credential-owner consent, owner offboarding, or provider/target compatibility strongly enough to expose them in the UI. Provider readiness can show authentication state without proving that the complete execution path is healthy.

The implemented login lock is scoped by provider and auth home, while current copy implies a target-wide single-flight boundary. The enforced concurrency boundary and the UI claim must be made identical.

## Architecture

### 1. Extend the journey contract

Add `access_required` to the post-auth result union without adding it to the state-machine journeys accepted by onboarding progress.

Resolution precedence, applied only to eligible non-archived companies:

1. Active membership: `returning`
2. Eligible pending/open invitation: `invited`
3. Instance administrator who can see an existing eligible company: `returning`
4. Instance administrator on an empty eligible instance: `founder`
5. Everyone else: `access_required`

Return explicit capability metadata where useful, including `canCreateCompany`, instead of reconstructing authority from empty-company state in multiple UI components.

Preserve and pin with tests the existing invitation precedence, verified-email matching, rejected-request exclusion, administrator visibility bypass, and `resumeFirstRunCompanyId` behavior. Define deterministic outcomes for archived-only memberships, suspended memberships, multiple memberships, and multiple unfinished founder journeys.

### 2. Centralize protected-route journey gating

Introduce one post-auth journey gate below session authentication and above protected application layouts.

- While loading, render a full-viewport, dark-safe neutral transition surface.
- On error, render an actionable retry and sign-out surface. Never fall through to the lobby.
- Redirect founders only to `/onboarding`.
- Redirect invited users only to `/onboarding/join`.
- Redirect access-required users only to `/access-required`.
- Allow returning users into lobby/company routes.
- Preserve the returning founder resume signal.
- Allow only the destination required by the current journey, preventing deep-link bypasses through `/companies`, `/import`, or company pages.

The existing index-only `LobbyOrOnboardingRedirect` is removed or reduced to returning-lobby rendering so the lobby shell cannot mount before journey resolution.

### 3. Add the access-required screen

Build an AOA-branded, dark, responsive screen that displays:

- the signed-in email;
- an explanation that an invitation or instance-admin access is required;
- `Refresh access`, which invalidates/refetches the journey;
- `Sign out and switch account`;
- concise instructions to ask an administrator for an invitation;
- an optional operator-configured support/contact link or message, without exposing administrator identities.

Do not offer company creation or an unauthenticated request-access mutation in this slice. Record privacy-safe access-required entry, refresh, conversion, and account-switch events so this does not become an invisible dead end.

### 4. Add onboarding account escape

Add a persistent, keyboard-accessible account action to the shared onboarding chrome:

- `Back` continues to move through completed onboarding steps;
- `Switch account` uses one shared account-switch operation that signs out, cancels provider-login polling, clears all user/company queries, selected-company state, and user-scoped local state, then returns to `/auth`;
- it is visible on the first step and all loading/error states;
- it does not discard or roll back durable onboarding progress.

### 5. Enforce company-provisioning policy consistently

- Hide New organization and Import organization controls unless the current user is an instance administrator.
- Split new-company and existing-company portability into path-authorizable endpoints. Run authentication, CSRF/rate limiting, body-size enforcement, and the appropriate instance-admin or company-RBAC check before the large JSON parser, full schema validation, URL fetching, or portability work.
- Keep import into an existing authorized company governed by existing company RBAC.
- Ensure no-company deep links resolve through the journey gate, not `NoCompaniesStartPage`.
- Log governed mutations through existing activity mechanisms.

### 6. Remove unwanted motion and stabilize onboarding layout

- Remove the `lobby-sidebar-enter` mount class and its now-unused keyframe/test.
- Keep other motion only where it follows reduced-motion settings.
- Apply a stable scrollbar gutter to the onboarding viewport.
- Replace unconstrained per-step vertical centering with a stable stage/grid whose header and primary content anchor do not move between steps.
- Preserve scrolling for short viewports, large error lists, 200% zoom, and mobile widths.
- Keep the dark onboarding background on route loading, errors, responsive changes, and system-theme changes.

### 7. Correct provider scope UX

- Replace “every company on this host shares it” with exact copy: the verified subscription belongs to this company, user, provider, and execution target.
- Separately explain that only one sign-in challenge may run on the execution target at a time.
- Show whether a credential is verified, which execution target owns it, and which agents are bound.
- Do not display provider tokens, authorization query strings, codes, or credential filesystem paths.

### 8. Separate credential, compatibility, and binding states

Expose three independent, timestamped states:

- `credential_verified`: the credential was accepted by the provider;
- `execution_compatible`: the CLI, model, execution target, provider availability, and quota passed the latest bounded probe;
- `agent_bound`: an approved credential source is selected for this agent.

Execution failure never revokes or marks a credential invalid. Probes are retriable and redacted. Company API keys remain the recommended durable path for unattended ordinary agents. Subscription auth remains an opt-in Commander path on a dedicated execution target.

### 9. Align login concurrency with reality

- Define the actual scarce resource for each provider: callback port, login worker, or execution target.
- Enforce that boundary with a server-authoritative, restart-safe lock.
- Test simultaneous challenges across two users and two companies.
- Generate scope/concurrency copy from the enforced capability instead of hard-coding a broader claim.

### 10. Prove execution only in controlled release QA

Do not add a founder-facing direct adapter execution endpoint in this program.

- Keep the existing bounded provider probe as the product readiness action.
- For release QA, create a synthetic task and run it through the normal heartbeat path in a disposable QA company and workspace.
- Disable tools, connectors, approvals, repository context, and unnecessary egress.
- Apply hard process-tree timeout, token, and cost ceilings. Use a fixed, non-sensitive prompt and accept the normal heartbeat audit/persistence contract; purge the disposable QA company/workspace under the documented QA data-retention procedure.
- If an adapter cannot guarantee this sandbox, stop at the provider probe and classify execution proof as unsupported.
- Test Codex and Claude subscriptions through Commander, and OpenAI/Anthropic API keys through an ordinary agent.

### 11. Defer personal-subscription delegation to ordinary agents

Do not expose the existing binding APIs in UI until a separately approved design provides:

- explicit credential-owner consent and owner-visible bindings;
- owner-initiated revocation and automatic suspension on membership loss;
- provider/agent/execution-target validation at mutation time;
- a database-enforced active uniqueness invariant;
- durable, convergent credential-file cleanup with retry/alerting;
- owner departure, rotation, quota exhaustion, and emergency replacement workflows;
- provider-policy/legal approval for unattended use.

## Error and rescue registry

| Failure | User-visible explanation | Recovery |
|---|---|---|
| Journey request fails | Access state could not be determined | Retry or sign out |
| User has no membership/invite | Access is required | Ask for invite, refresh, or switch account |
| Non-admin attempts company creation/import | Instance-admin authority is required | Return to access/lobby; contact admin |
| CLI missing or unsupported | Exact CLI/version requirement | Install or upgrade on execution target |
| Subscription disabled by topology | Profile does not permit subscription auth | Use company key or dedicated target |
| Login slot occupied | Another sign-in is in progress on this target | Finish/cancel, then retry |
| Challenge lost on restart | Sign-in session expired | Start a new challenge |
| Provider rejects credential | Provider authentication failed | Re-authenticate or replace key |
| Binding missing/ambiguous/revoked | Agent has no approved usable credential | Use a company API key or an approved Commander credential |
| Target mismatch | Credential belongs to another execution target | Authenticate on the correct target |
| Probe or controlled QA turn fails | Credential may still be valid, but execution is not currently ready | Preserve authentication; show classified cause and remediation |
| Credential cleanup fails after revocation | Execution is blocked, but files still require deletion | Retry durably and alert the operator until confirmed absent |

## Security invariants

- The server remains authoritative for instance-admin, membership, role, company, provider, and execution-target checks.
- `hosted_multi_tenant` continues to disable personal subscription sign-in.
- `remote_single_tenant` subscription support remains opt-in through its existing topology flags.
- Scoped credential directories are routing and hygiene controls, not an OS tenant boundary.
- No authentication artifact appears in API responses, logs, activity details, browser console, test snapshots, or screenshots.
- Journey and provider caches are cleared on sign-out and cannot bleed across accounts.
- New-company import cannot bypass the company-creation authority check.

## Test plan

### Shared and server

- Exhaustive journey resolver table covering membership, invitation, instance-admin status, existing-company visibility, and access-required.
- Route tests for all redirect destinations, resume behavior, journey errors, and deep links.
- Company create and new-company import authorization tests for instance admin, founder, member, and unauthenticated actors.
- Credential-state tests proving verification, execution compatibility, and binding do not overwrite one another.
- Topology tests proving remote-single-tenant enablement and hosted-multi-tenant denial.
- Provider-probe failure-classification and redaction tests.
- Cross-user/cross-company concurrent login tests at the enforced resource boundary.

### UI

- The lobby shell never mounts for founder, invited, access-required, loading, or error states.
- Access-required Refresh and Switch account behavior.
- Onboarding account escape on first and later steps.
- Create/import controls hidden for non-admin returning users.
- Sidebar has no mount animation.
- Provider copy matches actual credential and concurrency scope.
- Long verify errors remain scrollable.
- Visual checks at 320×568, 768×1024, 1440×900, 200% zoom, reduced motion, system light, and system dark.
- Assert stable header/content coordinates across representative short and tall onboarding steps.

### End-to-end and live QA

1. First Google user on an empty instance becomes admin and completes founder onboarding.
2. Uninvited second Google user reaches access required.
3. Invited second Google user joins the existing company.
4. Sign out/switch account works from access required and every onboarding step.
5. Codex subscription: sign in, probe, controlled Commander QA task.
6. Claude subscription: paste-code sign in, probe, controlled Commander QA task.
7. OpenAI API key: validate, save, probe, bounded ordinary-agent run.
8. Anthropic API key: validate, save, probe, bounded ordinary-agent run.
9. Restart during pending challenges and verify recoverable expiry.
10. Inspect server/browser logs for credential leakage.

### Repository gates

Run:

```text
pnpm -r typecheck
pnpm test:run
pnpm build
```

Then review the diff, create a PR, require CI, deploy the exact merged SHA to testing, and repeat the live matrix.

## Rollout

1. **Slice A — Access repair:** journey contract, eligible-company rules, protected-route gate, access-required screen, shared account switching, and new-company create/import authorization.
2. **Slice B — Visual stabilization:** remove lobby mount motion and stabilize onboarding scroll, theme, and geometry.
3. **Slice C — Provider truth and controlled proof:** correct scope/concurrency copy, separate readiness states, and run the controlled release-QA matrix. No ordinary-agent subscription delegation UI.
4. Give each slice independent acceptance criteria and rollback, and deploy Slice A before Slice C.
5. Run full local and CI verification for every slice.
6. Deploy the exact merged SHA to the dedicated testing target.
7. Keep rollback at the previous tested image/SHA; no schema-destructive operation is introduced.

Release measures:

- zero unauthorized new-company preview, import, or creation in the authorization matrix;
- zero lobby-shell mounts for non-returning journeys;
- zero cross-account query/local-state artifacts in sequential-account tests;
- journey latency/error rate within the current authenticated-route baseline;
- no regression in invitation completion;
- provider challenge completion and probe failures classified by provider/method;
- probe and controlled-QA disagreement measured, but never used to invalidate credentials.

## Not in scope

- Open self-service company creation.
- Treating shared Linux directories as a multi-tenant security boundary.
- Enabling subscription authentication under `hosted_multi_tenant`.
- Horizontal login-worker replicas or durable challenge-process routing.
- Renaming compatibility database credentials, old volume aliases, wire fields, or internal paths solely for branding.
- Adding non-Google AOA human authentication.
- Adding provider billing/subscription management.
- Exposing personal subscription credentials to ordinary unattended agents.
- Adding a founder-facing direct adapter smoke endpoint.
- Open self-service access requests; an operator-configured contact path is sufficient for this release.

## CEO review decision

### Alternatives considered

| Alternative | Advantage | Cost/risk | Decision |
|---|---|---|---|
| One large access + layout + credential-delegation release | One nominal project | Urgent access repair inherits authorization, policy, runtime, and rollback risk | Rejected |
| Access/UI repair only | Lowest immediate risk | Leaves misleading provider readiness and QA gaps | Incomplete |
| Three independently releasable slices | Fixes the live defect first while retaining full provider verification work | More release gates | Selected |

### Six-month regret test

The largest avoidable regret would be turning an employee's consumer subscription into unattended company infrastructure without consent, offboarding, cleanup, and provider-policy guarantees. The second would be hiding a correct access repair behind a risky runtime expansion. The selected slices avoid both.

### Independent-review consensus

| Topic | Independent reviewer | Codex reviewer | Resolution |
|---|---|---|---|
| Authentication vs execution | Separate states; smoke must not invalidate auth | Same | Adopted |
| Ordinary-agent subscription binding | Dedicated-instance convenience only; require policy/consent | Remove from release until invariants exist | Deferred |
| Real execution smoke | Requires a tool-disabled disposable sandbox | Do not create direct endpoint; use normal heartbeat synthetic QA task | Adopted |
| Release shape | Split access, visual, and provider work | Same | Adopted |
| Import authorization | Gate preview and commit before parsing | Same | Adopted |
| Access-required dead end | Add contact/request path and metrics | Add operator contact without identity leak | Operator contact adopted; request mutation deferred |
| Journey resolver | Correct the narrow fallback, preserve admin bypass/resume | Add eligible-company and deterministic targeting | Adopted |

### Decision audit trail

| Decision | Why | Revisit when |
|---|---|---|
| Keep `remote_single_tenant` | Matches dedicated Hetzner QA topology | Deployment becomes shared/untrusted |
| Invitation-only non-admin access | Preserves governed company provisioning | Product explicitly chooses self-service tenancy |
| Ship three slices | Separates urgent access, visual, and provider runtime risk | None; slices may share one reviewed program |
| Treat auth, compatibility, and binding separately | Prevents false credential invalidation | Never collapse without stronger provider semantics |
| Defer ordinary-agent subscription delegation | Missing consent, offboarding, uniqueness, cleanup, and policy guarantees | All listed gates are designed and approved |
| Use controlled synthetic QA tasks, not direct smoke UI | Preserves heartbeat invariants and contains side effects | A formal sandboxed execution contract exists |
| Use operator-configured contact, not admin identity | Avoids privacy leakage and support dead end | A rate-limited audited access-request product is approved |

## Design review contract

### Route and journey matrix

The journey gate renders after session authentication but before `LobbyLayout`, company `Layout`, redirects, or protected pages. Public routes remain exempt: `/auth`, `/invite/:token`, `/board-claim/:token`, and `/cli-auth/:id`.

| Resolved journey | Allowed destination | Any other protected route |
|---|---|---|
| `founder` | `/onboarding` including its intentional new-company mode | Redirect to `/onboarding`; discard `next` |
| `invited` | `/onboarding/join?company=<targetCompanyId>` | Redirect to the exact invitation target; discard `next` |
| `access_required` | `/access-required` | Redirect to access required; retain a safe original destination only in memory |
| `returning` with `resumeFirstRunCompanyId` | `/onboarding` after atomically selecting the still-eligible company | Redirect to onboarding; if eligibility changed, refetch and reclassify |
| `returning` without resume | Lobby, company routes, `/me`, authorized instance settings/access, marketplace, import/export, and plugin settings | Preserve a validated internal `next`; unknown routes use the normal not-found behavior |

Direct loads, refresh, browser back/forward, unknown routes, `/onboarding?new=1`, `/import`, and representative company/non-company deep links are tested for every journey. A preserved destination is honored only after the user becomes `returning`; it never overrides founder, invitation, or access-required routing.

`Refresh access` transitions atomically:

- `invited` → exact join URL with target company;
- `returning` → validated original destination or lobby;
- `founder` → onboarding;
- unchanged → remain and announce the checked timestamp;
- error → retain the current screen with Retry and Switch account.

### One onboarding shell and one scroll owner

Create one route-level onboarding shell for founder, invited, loading, error, progress, founder tail, and in-flight branches. It owns:

- explicit dark background, foreground, and `color-scheme`;
- a sticky, safe-area-aware chrome;
- one vertical scroll container with `scrollbar-gutter: stable`;
- route/step heading focus;
- responsive Back, progress, and Switch account controls;
- a top-anchored content grid for overflow and a stable centered anchor only when content fits.

At 320 px and 200% zoom, chrome may wrap into two rows but must not overlap content. All bottom actions and errors remain reachable without nested-scroll traps. Coordinate stability uses a small tolerance only for short steps; tall steps use reachability, no-horizontal-overflow, and unclipped-focus assertions.

The shell also owns all asynchronous states. Journey, session, onboarding progress, lazy step, new-organization preparation, invited join, and founder-tail failures each provide Retry and Switch account; no rejected request may leave an indefinite Loading state.

### Dark first paint and motion

The pre-React bootstrap marks `/onboarding`, `/access-required`, and unresolved protected journey boot as dark before bundle execution. The outer Suspense, health, session, journey, and gate fallbacks use the same explicit bootstrap surface. Test first paint with delayed JavaScript/API responses under stored light, system light, and system dark.

Remove `lobby-sidebar-enter`. JavaScript-driven backgrounds subscribe to live `prefers-reduced-motion` changes and stop/start without remounting or hiding content. Onboarding and access-required surfaces remain dark if the application theme changes while open.

### Account-switch transaction

Use one session-level account-switch operation everywhere:

1. Disable repeated activation.
2. Stop timers and polling.
3. Cancel any active Codex or Claude server challenge while the old session is still valid; wait within a bounded timeout.
4. Cancel in-flight queries.
5. Reset session-scoped providers, user-namespaced company selection, sidebar state, drafts, and provider UI state synchronously.
6. Sign out.
7. Hard-replace to `/auth`.

On cancellation failure, follow an explicit retry/continue policy that warns about a potentially occupied login slot. On sign-out failure, remain on the current screen with Retry; never render `/auth` over a still-valid session. Test Codex device-code and Claude paste-code challenges from onboarding and Settings, double activation, backend restart, session expiry, and account A → B isolation.

### Provider presentation model

Never use one aggregate green `Ready` badge. Present three ordered rows:

| Row | Plain-language values | Required context/action |
|---|---|---|
| Credential | Not configured, Checking, Verified, Expired, Revoked, Verification failed | Method, scope, owner when personal, last checked, Sign in/Replace |
| Execution | Not checked, Checking, Compatible, Stale, Target offline, Unsupported, Quota limited, Probe failed | Execution target, timestamp, stale threshold, Check again |
| Assignment | Commander subscription, Company key fallback, Not assigned, Unsupported | Intended agent and credential-source type; configure only supported mutations |

Company API keys are company-scoped and recommended for unattended agents. Personal subscriptions show owner user, company, provider, and execution target and are Commander-only in this release. “Uses this provider” is never relabeled as “bound to this credential.” Approved existing bindings may be shown read-only; ordinary-agent personal-subscription binding and mutation controls remain hidden.

### Accessibility and content resilience

- Focus the route heading after redirects and the step heading after wizard transitions.
- Use status/live-region semantics for access refresh, sign-in polling, clipboard result, and provider probe completion.
- Move focus to a focusable error summary after failures.
- Provide manual-copy fallback for device or paste codes.
- Preserve visible focus and logical tab order at 200% zoom.
- Wrap long emails, organization names, provider errors, URLs, device codes, and localized timestamps without horizontal overflow.
- Add keyboard-only and automated accessibility assertions for access required, onboarding async errors, Codex device code, and Claude paste code.

### Design-review consensus

| Topic | Independent reviewer | Codex reviewer | Resolution |
|---|---|---|---|
| Route gating | Exhaustive route/journey matrix required | Same; resume is an explicit fifth routing condition | Adopted |
| Async failures | Shared rescue shell for all onboarding failures | One route-level shell for every onboarding branch | Adopted |
| Dark flash | Cover access required and boot/Suspense | One explicit bootstrap surface and first-paint tests | Adopted |
| Account switching | Cancel challenge before session teardown | Session-level registry plus session-scoped state reset | Adopted |
| Responsive layout | One scroll owner and sticky responsive chrome | Same | Adopted |
| Provider language | Full state/copy matrix | Redacted source discriminator and no aggregate Ready | Adopted |
| Accessibility | Focus, announcements, copy feedback | Same | Adopted |
| Reduced motion | Respond to live preference changes | Same | Adopted |

## Engineering review contract

### Slice-compatible deployment order

The implementation sequence is stricter than the product slices:

1. Deploy a tolerant UI, identity/session epoch boundary, shared account-switch operation, and server-side self-cancel challenge operation. Unknown journey values render the dark recoverable gate, never a blank page.
2. Deploy the server journey contract with `access_required` disabled by capability flag.
3. Verify old/new client compatibility, then enable `access_required`.
4. Deploy visual stabilization.
5. Deploy the provider DTO/read model and server-side authentication finalization.
6. Deploy any provider lock/readiness schema migrations in expand/backfill/switch/contract phases.
7. Run controlled QA, then enable revised provider presentation.

Every step has an old-client test and an independent rollback. Turning off `access_required` restores the prior journey response without removing the access screen. Provider migrations are additive until the new reader has been verified.

### Identity epoch and stale-response containment

Session identity is the root cache boundary:

- derive a monotonically changing session epoch whenever user ID or authenticated session changes;
- include user ID/session epoch in every user-scoped journey, company, profile, provider, onboarding, and preference query key;
- namespace persisted company/sidebar/draft state by user ID;
- abort in-flight HTTP work and close live-update sockets on expiry, OAuth replacement, sign-out, or account switch;
- discard every response/callback whose captured epoch no longer matches;
- remount/reset user-scoped providers synchronously before account B renders.

Test manual switching, 401/session expiry, OAuth account replacement, delayed account-A HTTP responses, and late WebSocket callbacks.

### Journey consistency and deterministic SQL

Resolve the journey from one read transaction or versioned snapshot. “Eligible company” means non-archived and accessible through an active membership, an eligible verified-email invitation/request, or the instance-admin visibility rule.

Use explicit stable orderings:

- memberships: most recently active membership, then company ID;
- invitations: newest eligible invitation/request, then company ID, with a valid deep-link target taking precedence;
- administrator-visible company: oldest active company creation time, then company ID;
- unfinished founder resume: most recently updated eligible progress row, then company ID.

Recheck eligibility when selecting the target company. Add real-Postgres race tests for archive, invite revoke, membership loss, and reversed insertion/query plans.

### Import authorization before parsing

Do not inspect a 20 MB generic JSON body merely to discover authorization scope. Introduce path-authorizable routes, for example:

- instance-admin-only new-company preview/commit;
- `:companyId` existing-company preview/commit under company RBAC.

Mount actor, CSRF, rate-limit, and capability middleware before a route-specific bounded JSON parser. Only then run full Zod validation, remote-source fetching, and portability services. Unauthorized, malformed, and oversized tests must prove that parsing, validation, fetch, and service spies were never called.

### Provider source-of-truth DTO

Define a versioned shared DTO whose three rows are projections, not independent ad hoc labels:

- credential evidence source, method, redacted owner/scope, `verifiedAt`, and credential lifecycle state;
- readiness observation keyed by company, provider, scope, execution target, credential-source/config fingerprint, `testedAt`, outcome, and stale-after rule;
- assignment source and intended agent, with approved/revoked timestamps.

Document the authoritative table and allowed writer for every field. Authentication-only finalization may write credential state and Commander assignment; an execution probe writes only readiness. Rotation, target change, revocation, binding change, and membership loss invalidate only matching observations.

If new readiness fingerprint/target columns are needed, use an additive migration with backfill/default behavior, dual-read compatibility, switch-over, and rollback tests. Cover all credential × execution × assignment combinations across restart, including simultaneous company-key and subscription sources.

### Server-side challenge finalization

Browser polling is an observer, not the commit point. When the CLI challenge completes, a server-owned finalizer:

1. records authentication evidence and performs the authentication-only credential transition;
2. enforces the Commander-only subscription assignment;
3. commits independently of any browser poller;
4. queues a separate retryable compatibility probe.

Test browser close, reload, account switch, server restart, and failures between CLI completion, credential verification, assignment, and probe.

Add a self-only, idempotent server operation to list/cancel all pending challenges owned by the authenticated user across authorized companies. The shared account-switch transaction uses it before sign-out, including multi-tab and lost-component-state cases.

### Login resource keys and ownership

Persist a canonical `resourceKey` and owning principal:

- Codex callback flow: execution target + provider + callback port;
- Codex device-code flow: execution target + provider + scoped auth home, unless CLI testing proves a stricter worker boundary;
- Claude paste-code flow: execution target + provider + scoped auth home, unless CLI testing proves a stricter worker boundary.

Enforce one active challenge per resource key transactionally with a database uniqueness strategy. Cross-user/company contention returns `409`; only the exact owner may inspect, cancel, or retry. A boot reaper completes before readiness. Because horizontal login-worker replicas remain out of scope, configuration must enforce one login-worker process; a future multi-worker design requires owner leases/routing before enablement.

The UI renders the server-reported concurrency scope. Tests cover two users, two companies, two processes, stale-owner takeover, rolling restart overlap, and exact-owner cancellation.

### Commander-only enforcement

Hiding ordinary-agent binding UI is insufficient. Reject new personal-subscription assignments unless the target is the company's current Commander. Inventory any pre-existing ordinary-agent subscription assignments and either suspend them during migration or keep them read-only under an explicit operator-visible compatibility policy. Direct API tests cover non-Commander attempts.

### Controlled QA persistence decision

Use the normal heartbeat path because it is the behavior being proven. Do not invent a parallel “ephemeral heartbeat” that could diverge from production. The QA task uses a fixed non-secret prompt, disposable company/workspace, disabled tools/connectors/approvals, restricted egress, and hard cost/time limits. Normal run content is expected to be persisted temporarily; document and verify its retention and purge. If those containment controls cannot be proven for an adapter, stop at the provider probe.

### Safe operator contact

Validate the optional support link at startup. Allow explicit `https:` and, if configured, `mailto:` only; reject credentials, control characters, raw HTML, `javascript:`, and `data:`. Escape message text and use safe external-link attributes.

### Engineering-review consensus

| Topic | Independent reviewer | Codex reviewer | Resolution |
|---|---|---|---|
| Import boundary | Authorize before full validation/parsing | Global parser is an unauthenticated 20 MB path; split endpoints | Adopted |
| Authentication finalization | Provider states need explicit writers | Browser polling cannot be the commit point | Server-owned finalizer adopted |
| Identity isolation | Session epoch required for all identity transitions | Abort/discard old HTTP and socket callbacks | Adopted |
| Login locking | Pick resource keys and owner/lease semantics | Add schema migration and exact-owner enforcement | Adopted |
| Readiness attribution | Versioned DTO and transition table | Include target and credential/config fingerprint | Adopted |
| Commander-only policy | UI hiding is insufficient | Enforce in direct binding API | Adopted |
| Controlled QA | Current heartbeat persists content | Normal heartbeat is the proof; retain/purge fixed non-secret output | Selected over parallel execution mode |
| Slice compatibility | Additive migration and rollback required | Tolerant UI must precede new journey value | Adopted |

## Developer-experience and testability contract

### Concrete shared contracts

Replace cast-based JSON handling with shared Zod schemas and inferred TypeScript types.

`PostAuthJourneyResult` is a discriminated union:

- `founder`: `targetCompanyId: null`, `canCreateCompany: true`, no resume company;
- `invited`: non-null invitation target, `canCreateCompany: false`, no resume company;
- `access_required`: no target/resume company, `canCreateCompany: false`;
- `returning`: non-null eligible target; optional non-null eligible `resumeFirstRunCompanyId`.

All variants carry `schemaVersion`, eligible pending invitations, and capability metadata with exact nullability. The UI parses the response; malformed or unknown versions render the recoverable gate. Tolerant readers preserve unknown enum values as `unknown`, never as success.

The provider DTO is a shared versioned schema with stable enums, source IDs, timestamps, server-derived `staleAt`, execution-target identity, non-secret configuration fingerprint, assignment source, capabilities, and redacted owner display. Check in canonical JSON fixtures for every state and reuse them in server projection, UI, and E2E tests.

Use one safe error envelope:

```text
{ code, message, retryable, correlationId, remediation? }
```

Pin stable codes and HTTP mappings for journey failure/stale eligibility, body-size/parser denial, authorization denial, topology denial, login contention/loss/expiry, target mismatch, CLI missing/version mismatch, quota, timeout, malformed provider output, and probe failure. UI logic switches on codes, not provider stderr or English text; unknown codes degrade to a safe retry/sign-out path.

### Challenge/finalizer state machine

Document the exact states and allowed transitions for pending, externally authenticated, finalizing, verified, probe queued/running, completed, cancelled, expired, and failed. Every transition has:

- an idempotency key and owning principal;
- database-clock lease/expiry fields where work is claimed;
- retry limit and terminal-state rule;
- safe error code;
- activity/metric behavior;
- restart semantics.

Restart-safe means locks are safely expired or reaped; it does not mean the external CLI process resumes. Use a partial active-resource uniqueness constraint. Boot reaping completes before login readiness. Failure-injection tests pause at each commit boundary with deterministic barriers, not sleeps, and exercise two-process contention.

### Hermetic authentication and journey fixtures

Add a dedicated authenticated Playwright configuration with an isolated AOA home, database, and server. A test-only identity/session factory is enabled only by an explicit E2E flag and creates admin, uninvited, invited, and returning users without Google network access. Keep real Google OAuth as one live manual check.

Each stateful scenario group gets a fresh instance or an authoritative reset fixture covering users, sessions, admin roles, invitations, memberships, onboarding progress, companies, credentials, challenges, and preferences. The journey suite must pass twice consecutively.

Introduce a journey fixture/repository seam with explicit company statuses, memberships, invitations, progress, admin role, and clock. Use it for the exhaustive pure table; use fixed UUIDs/timestamps and transaction barriers for real-Postgres races.

### Deterministic provider seams

Reuse the fake-CLI/PATH pattern behind an injected provider runner. Fixtures cover success, missing CLI, unsupported version, signed out, revoked source, target mismatch, quota, malformed JSONL, nonzero exit, timeout, and process-tree cancellation. Required CI never consumes real credentials or provider quota.

One allowlist diagnostic serializer sits at the provider-process boundary. Adversarial sentinel tests place realistic keys, bearer tokens, device/paste codes, OAuth queries, credential paths, prompts, and model output in stdout, stderr, exceptions, and timeouts. Automatically scan API bodies, logs, activity rows, console output, traces, screenshots, snapshots, and QA manifests; fail if a sentinel survives. Authentication portions of live runs disable traces/screenshots unless a sanitizer is proven.

### Exact import API contract

The implementation PR must replace the illustrative import paths with final, documented preview/commit endpoints before coding. The contract specifies request/response schema, content types, maximum transfer and expanded sizes, URL-source policy, idempotency, legacy endpoint behavior, and error codes.

Middleware-order tests cover unauthenticated, unauthorized, malformed, oversized, chunked-transfer, misleading `Content-Length`, and remote-source requests, proving that disallowed requests never reach decompression, JSON parsing, full validation, DNS/network, or portability code.

### Test and CI lanes

| Lane | Contents | Gate |
|---|---|---|
| Fast contract | Resolver/DTO/error/state-machine tables, UI mapping, fake CLI, redaction | Every PR |
| Slice integration | Targeted server/UI integration for the changed slice | Every PR |
| Authenticated Chromium | One hermetic founder/invited/access-required/returning journey campaign | Every PR |
| Real Postgres | Eligibility races, login uniqueness/leases, migration compatibility | Required dedicated CI job |
| Focused visual | Canonical mobile, tablet, desktop; dark first paint; zoom/scroll/reduced motion | Required for visual slice |
| Real provider | Codex/Claude subscription and API-key campaign | Protected manual release gate |
| Post-deploy canary | Exact deployed SHA against testing target | Deployment gate |

Avoid a full visual Cartesian product. Use deterministic fonts/browser settings, representative combinations, invariant assertions with tolerances, and a small canonical screenshot set. Add named package scripts, OS support, required environment variables, expected duration, and per-job budgets to the implementation PR and runbook.

### Target QA campaign and runbook

Check in a `testing.armyofagents.org` runbook and a bounded release-QA runner that:

- requires target URL and expected deployed SHA;
- verifies effective topology flags, execution target, and supported CLI versions;
- generates a unique campaign ID;
- creates only disposable resources through supported APIs and records every created ID;
- runs the four authentication methods and two approved execution paths;
- enforces time/token/cost limits;
- emits a redacted evidence manifest with provider, model, statuses, timestamps, SHA, and cleanup state;
- can abort/resume without broad deletion;
- cancels wedged challenges and revokes test credentials;
- cleans up only campaign-owned database/workspace/log/credential artifacts and verifies absence;
- documents rollback verification and evidence locations without secrets.

### Migration and operator ergonomics

For every lock/readiness column or index, the implementation plan/PR records table, null/default semantics, generated Drizzle migration, backfill query and batch size, expected row volume, lock-time budget, progress metric, compatibility mode, and rollback. Use separate flags for write-new, dual-read, read-new, journey enablement, and provider presentation.

Add old-binary/new-schema and new-binary/old-data tests. Startup diagnostics expose only redacted effective install profile, platform, execution target, CLI version/support, and enabled auth modes. Configuration conflicts fail or warn with a remediation code.

### Metrics and alerts

Define bounded-label counters/histograms for journey outcomes and latency, gate redirects, access refresh conversion, invitation completion, account switching, challenge transitions, lock conflicts, finalizer lag, reaper failure, provider probes, controlled-QA disagreement, and campaign cleanup. Email, user/company/challenge IDs, URLs, and credential fingerprints are forbidden metric labels.

Logs use correlation IDs and allowlisted fields. Alert thresholds cover elevated journey errors, stuck finalizers, reaper failures, repeated lock conflicts, provider-flow regression, and cleanup failure.

### DX-review consensus

| Topic | Independent reviewer | Codex reviewer | Resolution |
|---|---|---|---|
| Multi-user E2E | Needs authenticated identity harness and isolated state | Same; add named reproducible commands | Adopted |
| Journey/provider contracts | Discriminated journey schema and stable diagnostics | Exact versioned DTO/fixtures required | Adopted |
| Provider testing | Deterministic fake runners; real provider optional | Same | Adopted |
| Redaction | One allowlist boundary plus adversarial scans | Same | Adopted |
| Live QA | Exact Hetzner runbook required | Add campaign runner, manifest, owned cleanup | Adopted |
| CI cost | Split required and protected lanes | Same, with per-job budgets | Adopted |
| Migrations | Concrete schema/backfill/rollback details | Feature-flagged compatibility stages | Adopted |
| Observability | Privacy-safe effective config and outcomes | Named metrics/alerts and bounded labels | Adopted |

## File-level implementation work packages

### Package 0 — Compatibility and session foundation

Primary files:

- `packages/shared/src/onboarding.ts`
- `ui/src/api/onboarding.ts`
- `ui/src/lib/queryKeys.ts`
- `ui/src/context/CompanyContext.tsx`
- `ui/src/components/UserMenu.tsx`
- `ui/src/App.tsx`
- authenticated Playwright identity/session fixtures

Deliver the discriminated journey schema, tolerant reader, identity epoch, user-namespaced state, shared account-switch transaction, challenge self-cancel API client, and dark recoverable unknown-journey fallback. Acceptance: old server/new UI and new server/old UI compatibility tests pass before `access_required` is enabled.

### Package A — Access repair and provisioning authority

Primary files:

- `server/src/services/post-auth-journey.ts`
- `server/src/routes/onboarding-journey.ts`
- `server/src/routes/companies.ts`
- `server/src/app.ts`
- `ui/src/App.tsx`
- new access-required page and route
- journey/import server and browser tests

Deliver eligible-company resolution, deterministic ordering, the route gate, access-required UI, exact import endpoints, and pre-parser authorization. Acceptance: the complete journey/route matrix passes, unauthorized import work is never invoked, and the live second uninvited user reaches access required with a working account switch.

### Package B — Onboarding visual and rescue shell

Primary files:

- `ui/index.html`
- `ui/src/App.tsx`
- `ui/src/pages/OnboardingFlow.tsx`
- `ui/src/onboarding/FlowEngine.tsx`
- `ui/src/onboarding/FirstRunHome.tsx`
- `ui/src/onboarding/InvitedJoinTerminal.tsx`
- `ui/src/onboarding/inflight/InFlightFlow.tsx`
- `ui/src/onboarding/motion/ConstellationBg.tsx`
- `ui/src/components/LobbySidebar.tsx`
- `ui/src/index.css`

Deliver one shell/scroll owner, sticky responsive chrome, all async rescue states, dark first paint, live reduced-motion handling, and removal of the lobby mount animation. Acceptance: focused visual/interaction suite passes at canonical viewports and 200% zoom; every long error and primary action is reachable.

### Package C1 — Provider contract and authentication finalization

Primary files:

- new shared provider DTO/error schemas under `packages/shared/src`
- `server/src/routes/providers.ts`
- `server/src/services/provider-credentials.ts`
- `server/src/services/providers/readiness.ts`
- `server/src/services/commander-login.ts`
- `server/src/services/commander-login-runtime.ts`
- `server/src/routes/provider-credentials.ts`
- `ui/src/api/providers.ts`
- `ui/src/components/settings/sections/ProvidersSection.tsx`
- `ui/src/components/providers/ProviderReadinessCard.tsx`

Deliver server-owned authentication finalization, Commander-only enforcement, independent credential/readiness/assignment projections, stable diagnostics, and the three-row provider UI. Acceptance: lost-client/restart failure injection passes; probes cannot mutate credential state; no aggregate Ready remains.

### Package C2 — Login resource persistence and migration

Primary files:

- `packages/db/src/schema/commander_login_challenges.ts`
- `packages/db/src/schema/provider_readiness_status.ts`
- generated Drizzle migration
- login/readiness services and integration tests

Deliver resource keys, exact ownership, active uniqueness, leases/reaping, readiness target/source fingerprinting, additive compatibility stages, and operator diagnostics. Acceptance: two-process barrier tests, migration compatibility tests, and rollback rehearsal pass.

### Package C3 — Hermetic and live provider proof

Primary files:

- fake provider CLI fixtures and injected runner tests
- authenticated Playwright/provider lifecycle specs
- target release-QA runner
- `docs/aoa/guides/remote-cli-auth.md`
- new `testing.armyofagents.org` runbook

Deliver deterministic CI classifications/redaction, protected real-provider campaign, campaign-owned cleanup, and evidence manifests. Acceptance: Codex and Claude subscription Commander flows plus OpenAI and Anthropic API-key ordinary-agent flows pass on the exact deployed SHA, with no sentinel or live secret in any artifact.

## Implementation approval gate

Implementation begins only after approval of these reviewed choices:

1. Three independently releasable slices, deployed in compatibility-first order.
2. Invitation-only non-admin company access for the dedicated testing instance.
3. Personal subscription auth is Commander-only in this release; ordinary unattended agents use company API keys.
4. No founder-facing direct smoke endpoint; real execution proof uses a disposable, bounded normal-heartbeat QA campaign.
5. Provider status is three independent rows, never one aggregate Ready state.
