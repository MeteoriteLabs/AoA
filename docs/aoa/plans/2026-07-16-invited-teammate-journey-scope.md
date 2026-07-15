# Invited-Teammate Onboarding Journey — Design (Track B)

> **Status:** design approved via brainstorm 2026-07-16. Next: implementation plan (writing-plans) → TDD execution.
> **Branch:** `feat/invited-teammate-journey` (off `main` after PR #287 merged the founder onboarding + auth redesign).
> **Predecessor:** `docs/aoa/plans/2026-07-13-onboarding-auth-remaining-phases.md` §Track B (this supersedes that section's framing — see "Reframing" below).

---

## 1. Summary

A guided onboarding journey for an **invited human teammate**. When someone accepts an invite and signs in, they build their **Human Operating Profile** (so agents know how to work with them), see where they're landing, and drop into the company the moment the founder approves — no manual reload. It reuses the existing invite-accept + approval machinery and fills the gaps that leave invited teammates as bare names today.

**Reframing (important):** the roadmap's original Track B framing ("JoinOrg step *creates* the join_request + invite-handoff table + a JOIN_REQUESTED→SETUP_COMPLETE state machine") is partly redundant. Ground-truth exploration confirmed the join_request is already created at invite-accept, approval already grants membership+role+grants, and the journey resolver already returns `returning` post-approval. So Track B is really about a **coherent guided profile experience + a live approval transition + materializing the company human record** — not new plumbing.

## 2. Locked decisions (the design contract)

1. **Fields the teammate fills:** Name (prefilled from Google), Title, Timezone — **required**; Bio, Social links — **optional**. Nothing else.
2. **Capabilities** (Responsibilities / Skills / Preferences / Availability / Resume / Background): **deferred** — seeded as editable stubs, filled later on the Human page or pre-filled by the inviter.
3. **Authority** (role, department, reports-to): **inviter-set** in the invite `defaultsPayload`; the teammate only *sees/confirms* it.
4. **Profile step** is a **shared, journey-agnostic component**, wired **invited-only now** (founder-journey wiring is a later follow-up).
5. **Data flow (§7):** global `user_profiles` written **live** during onboarding; the company-scoped human record is **materialized at approval**. All company-scoped writes stay behind membership (no pre-membership company writes).
6. **Pending → approved transition:** **poll** (~5–10s) the journey endpoint; auto-enter on `returning`. Realtime (SSE) is a later upgrade.
7. **Onboarding is journey-tagged + modular** (existing FlowEngine + step registry); invited = steps tagged `journeys:["invited"]`. Future journeys just add tagged steps.
8. **Out of scope:** the RC3 invite-token handoff table (current URL-token flow stays), realtime transition, capability-doc *content* collection, founder-journey wiring, `JOIN_REQUESTED`/`SETUP_COMPLETE` state driving.

## 3. Current state (ground truth — what already works vs. the gaps)

**Works today:**
- Invite link `/invite/:token` → Google sign-in (token replayed via `?next=`) → accept → creates the `join_request` (`server/src/routes/access.ts` accept handler; `requestingUserId` + `requestEmailSnapshot`, `status='pending_approval'`).
- Founder approval (`access.ts` approve txn) → `ensureMembership` + `setPrincipalGrants` + `applyInviteRole` (role from `invite.defaultsPayload.teamInvite.role`).
- Journey resolver (`server/src/services/post-auth-journey.ts` + `routes/onboarding-journey.ts`) → `invited` with `targetCompanyId` + `pendingInvitations`; post-approval → `returning`.
- Human Operating Profile model: global `user_profiles` (name/avatar/title/bio/socialLinks) + company-scoped `company_user_profiles` (title/timezone/bio/location/social/avatarAsset) + `company_user_capability_documents` (6 standard markdown docs) + `user_roles` + `company_memberships` (reporting chain). Prefilled `HUMAN_TITLE_OPTIONS` + `getTimezoneOptions()` live in `ui/src/pages/HumanDetail.tsx`.

**Gaps this feature fills:**
- Invited onboarding is just `ProfileStep` (global name) → a **static "Request sent" stub** (`InvitedPendingPage`). No guided profile, no live transition.
- **Approval creates NO company profile and seeds NO capability docs** for an invited member (both are lazy-created later, only on first edit/view). Even manual `addMember` skips the `company_user_profiles` insert.
- No live pending→approved transition — the invitee sits on the stub until a manual reload re-resolves the journey to `returning`.

## 4. End-to-end flow

1. Founder invites (existing) → invite carries role/department in `defaultsPayload`.
2. Teammate opens `/invite/:token` → Google sign-in (existing).
3. Accept creates the `join_request` (existing) → **redirect into `/onboarding/join`** (today it stops on InviteLanding's own pending screen; we route it into the guided flow so there is one invited surface).
4. Guided invited onboarding: **HumanProfileStep** (Name / Title / Timezone required; Bio / Social optional) advances `PROFILE_SET` on the user layer.
5. FlowEngine resolves no further invited step → **InvitedPendingStep** (terminal): a "You're joining {Company} as {role}" confirm summary as its header, then **polls** `GET /api/onboarding/journey` every ~5–10s.
6. Founder approves (existing) → approve txn materializes the company human record → next poll returns `returning` → auto-navigate into the company.

## 5. Field set + validation

| Field | Required | Written to (§7) | Source |
|---|---|---|---|
| Name | ✅ | global `user_profiles.displayName` | prefilled from Google |
| Title | ✅ | global `user_profiles.title` → mirrored to company at approval | shared `HUMAN_TITLE_OPTIONS` |
| Timezone | ✅ | carried on join_request → `company_user_profiles.timezone` at approval | shared timezone list (auto-detect + confirm) |
| Bio | — | global `user_profiles.bio` | free text |
| Social links | — | global `user_profiles.socialLinks` | add-your-own |

Submit is blocked until Name + Title + Timezone are set (Name is prefilled, so effectively Title + Timezone are the two the teammate must touch).

## 6. Components

**New:**
- **`HumanProfileStep`** (shared, journey-agnostic; `ui/src/onboarding/steps/`): the 5 fields, using the shared Title/Timezone constants. Registered `journeys:["invited"]`, advancing `PROFILE_SET`. **It supersedes the bare `ProfileStep` for the invited journey** — retag the existing `ProfileStep` to `journeys:["founder"]` so invited uses the richer step and founder is untouched. Writes the global profile, then advances.
- **`InvitedPendingStep`** (the terminal render — replaces the static `InvitedPendingPage`, NOT a registry step, so no `JOIN_REQUESTED` state is needed): shows the "joining {Company} as {role}" confirm summary as its header; polls the journey endpoint; auto-enters on `returning`; renders a terminal **"not approved"** state if the request is rejected (never loops).

**Changed:**
- **`InviteLanding`**: after a successful human accept, route to `/onboarding/join` instead of its inline pending screen.
- **Shared constants**: extract `HUMAN_TITLE_OPTIONS` + `getTimezoneOptions()` (currently in `HumanDetail.tsx`) into a shared module both `HumanDetail` and the onboarding step import — so they can never drift.

## 7. Data model & data flow (decision (a))

- **Global `user_profiles`** (name, title, bio, socialLinks): written **live** during onboarding via the existing `saveUserProfile` (self-owned; already allowed). The founder therefore sees the teammate's identity (name/title/bio/social) at approval time.
- **Company-scoped human record** — materialized **at approval** in the existing approve transaction (`access.ts`), *not* during onboarding:
  - Create `company_user_profiles` (idempotent): copy identity from the invitee's global `user_profiles` + set `timezone` (carried on the `join_request` — a small nullable `profileTimezone`/payload column added to `join_requests`).
  - Seed the 6 standard capability docs (`humanCapabilities.ensureStandardDocuments`) — the same call manual `addMember` already makes at `team.ts`.
- **No new state machine:** `JOIN_REQUESTED`/`SETUP_COMPLETE` stay unused. The `join_request` status + membership are the source of truth; approval → membership → `returning` already drives the transition. The invited FlowEngine advances `PROFILE_SET` on the user layer (as today) and ends on the pending step.

## 8. Backend changes

- **Approval seeding** (`access.ts` approve txn, human branch): after `ensureMembership`/`applyInviteRole`/grants, also (a) upsert `company_user_profiles` from global identity + carried timezone, and (b) `ensureStandardDocuments`. Idempotent; best-effort must NOT fail the approval. **Bonus:** apply the same company-profile insert to manual `addMember` so both paths converge.
- **`join_requests`** gains a nullable column to carry the invitee's timezone (and room for future profile bits) captured at onboarding submit — a small `PATCH` on the existing self-owned join_request, or fold into the accept payload.
- **No new route for the journey poll** — the pending step reuses `GET /api/onboarding/journey`.
- Shared constants extraction is UI-only.

## 9. Edge cases

- Invite **expired/revoked** before approval → onboarding surfaces the reason; no dead loop.
- Request **rejected** → poll detects it → terminal "not approved" screen (no navigate to `/`, which would re-loop).
- **Already a member** on re-visit → resolver returns `returning` → straight into the app.
- **Multiple pending invites** → target the deep-linked (`?company=`) or first company (existing resolver behavior).
- **Abandon mid-profile + return** → FlowEngine resumes at the incomplete step (existing resumable behavior).
- **Poll lifecycle** → stops on unmount; bounded interval; tolerant of transient errors.
- **Approval retry** → all seeding idempotent (upsert + `ensureStandardDocuments` already idempotent).
- **Email mismatch** (invite for A, signed in as B) → existing resolver matching (requestingUserId or verified-email snapshot) governs; unchanged.

## 10. Testing strategy (TDD)

- **UI unit (RTL):** `HumanProfileStep` — required-field gating (submit blocked until Name/Title/Timezone), writes global profile, advances; uses shared constants. `InvitedPendingStep` — polls, auto-navigates on `returning`, renders terminal "not approved" on rejection, stops polling on unmount. `InviteLanding` — routes to `/onboarding/join` after accept.
- **Server:** approve txn materializes `company_user_profiles` + seeds capability stubs idempotently; manual `addMember` convergence; join_request timezone carry.
- **Shared:** constants extraction keeps `HumanDetail` behavior identical (snapshot/values test).
- **e2e (Track D overlap, deferred):** full invited journey with a 2nd (mocked) Google identity — accept → profile → pending → approve → enter. Not blocking; folds into the A12 mocked-Google helper.

## 11. Out of scope / deferred

Capability-doc **content** collection (stubs only); **realtime** transition (poll only); wiring the shared profile step into the **founder** journey; the RC3 **invite-token handoff table** (URL-token flow stays); driving `JOIN_REQUESTED`/`SETUP_COMPLETE`.

## 12. Open follow-ups (post-Track-B)

- Add the shared `HumanProfileStep` to the **founder** journey so founders also get a company Human Operating Profile during onboarding (today lazy-created).
- Capability-doc collection UX (in onboarding and/or inviter-seeded).
- Realtime approval transition over LiveEvents.
- RC3 invite-token handoff table (keep token out of URLs).
- Enrich the founder's approval card with the invitee's profile summary.
