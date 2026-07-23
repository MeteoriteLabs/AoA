# Bucket 1 — Google Workspace: v1 Design & Decisions

> **Status:** Agreed design, pre-implementation. Grounded in current `main`
> (rebased). Companion to `docs/plugins-connectors-overview.md` and
> `docs/plugins-connectors-session-buckets.md`. This captures the decisions from the
> planning discussion so an implementation session can start from a spec, not a blank
> page.

---

## Grounding — what already exists on `main` (verified)

| Fact | Location | Consequence for this design |
|---|---|---|
| **Google is the ONLY sign-in provider** (better-auth; email/password removed) | `server/src/auth/better-auth.ts` | Every user already has a Google identity — but login requests only `openid/email/profile`. **No Gmail/Calendar/Drive access is granted at login.** |
| OAuth tokens per-user in the `account` table (`accessToken`,`refreshToken`,`scope`,…) | `packages/db/src/schema/auth.ts` | Connections are naturally **per-user**, not per-company. |
| Instance-level Google app (`GOOGLE_CLIENT_ID/SECRET`) | better-auth config | Workspace reuses the **same Google Cloud app**, adds scopes via a separate consent. |
| Encrypted per-company secrets, AES-256-GCM; `github_pat` is the template | `packages/db/src/schema/company_secrets*`, `server/src/routes/github.ts`, `server/src/services/secrets.ts` | Google refresh tokens follow this pattern, **keyed per-user**. |
| Plugin runtime: out-of-process workers, jobs, tool registry, UI slots, scoped secrets | `server/src/services/plugin-*.ts` (26 files) | Everything a first-party Google plugin needs already exists. |
| Inbox backed by `notifications` (+ Inbox.tsx aggregates issues/approvals/etc.) | `packages/db/src/schema/notifications.ts`, `ui/src/pages/Inbox.tsx` | Email + calendar surface here via new notification types + a UI slot. |
| **No outbound MCP client exists** (only AoA-as-MCP-server) | `server/src/mcp/*` | Consuming an external Google MCP server would mean building an MCP client first → **we go direct to `googleapis` instead.** |

---

## Decisions (locked)

| # | Decision | Choice |
|---|---|---|
| G1 | **Packaging** | First-party, **verified, default-installed plugin** — not core, not community-marketplace. Uses the plugin runtime (isolation, per-tenant enable/disable, independent release) while shipping out-of-the-box. |
| G2 | **Google access mechanism** | **Direct `googleapis` SDK** inside the plugin. NOT via a consumed external MCP server (none exists to consume from, and Google needs push/granular-scopes/tight-control). |
| G3 | **Connection scope** | **Per-user.** Each user connects their own Google account (Gmail/Calendar/Drive are personal). Drive may later also target a company Shared Drive. |
| G4 | **OAuth app** | Reuse the **same Google Cloud project/client** as login, but a **separate, incremental consent** triggered when the user opts in — so login stays lean (no mailbox scopes forced on sign-in). |
| G5 | **Connect UX** | **Profile → "Connected Accounts" tab.** Per-service connect (Gmail / Calendar / Drive independently, incremental scopes). Shows per-service status. |
| G6 | **Authorization model** | **"Act as me."** An agent acts on a user's connected account only if that user explicitly authorizes it. **Per-service grants** — a user grants Mail / Calendar / Drive to an agent independently (an agent may run your calendar but never touch your mail). |
| G7 | **Gmail surface** | A dedicated **AI-first email view in the Inbox** (plugin UI slot) — summarize, triage, draft, reply, convert-to-Task. **NOT** routed through the Discussion pipeline. |
| G8 | **Gmail scope** | **Read + send** (v1). Enables an Inbox crew agent to actually reply. Accepts Google restricted-scope review (CASA) — on the radar. |
| G9 | **Calendar surface** | **Tool-first + light UI.** v1 = agent tool + Home "Today/Upcoming" widget + Inbox notifications + a Commander cockpit glance. **Full calendar view deferred to phase 2.** |
| G10 | **Drive access** | **Full-drive read** scope + **write-back** (in *and* out). |
| G11 | **Drive → Memory** | **Hybrid.** User curates specific folders/docs to **sync into Memory** (`memory_items`, `status:'pending'`, embedded, founder-approved per Rule #6). All other docs readable **on-demand** as live context. |

**Explicitly NOT in v1** (deferred, all build on the same connection framework):
- Agents with their **own** Google/email accounts (separate agent identity).
- **Shared department mailboxes** (e.g. `support@`) shared by many agents.
- **Full calendar UI** inside AoA.
- **Domain-wide delegation** (admin-granted Workspace access without per-user consent).

---

## The connection & authorization model (the crux, in plain terms)

1. **You connect your own Google account** in Profile → Connected Accounts. It's yours.
   Powers *your* AI-first Inbox email view and *your* calendar surfaces.
2. **You choose which agent(s) may act on it, per service.** A toggle: "let this agent
   use my — ☐ Mail (read/send) ☐ Calendar (read/write) ☐ Drive (read)." Default: none.
3. **That grant is personal and explicit.** Only agents *you* authorize touch *your*
   account. Nobody's agent silently reads someone else's mail/calendar.

*"Which agent uses it?" → the one you pick.* The per-user connection + per-service grant
**is** the whole permission model. Token storage: per-user, encrypted (github_pat
pattern, keyed by `userId`), refreshed on schedule.

**Personal Gmail vs Workspace account:** identical OAuth flow and APIs — one per-user
consent covers both. Only differences: a Workspace admin can allowlist/block the app,
and Workspace unlocks the (deferred) domain-wide-delegation path.

---

## Per-service specs

### Gmail — AI-first Inbox surface
- **Surface:** dedicated email view in Inbox (plugin UI slot); light signals (e.g. "3
  urgent") drop `notifications` rows into the Inbox roll-up.
- **Actions (tool + UI):** list/search threads, read, summarize, triage/prioritize,
  draft reply, **send** (G8), convert email → Task.
- **Crew agent:** an "Inbox crew agent" a user authorizes to triage/draft/reply **as
  them**.
- **Ingestion:** poll or Gmail watch (Pub/Sub) → surface to Inbox. (Not the Discussion
  extraction pipeline — G7.)

### Calendar — tool-first, light UI
- **Surfaces (v1):** Home "Today/Upcoming" widget · Inbox event notifications ·
  Commander cockpit glance · agent tool. (Full view = phase 2, G9.)
- **Actions (tool):** `list_events(range)`, `get_free_busy`, `create_event`,
  `update_event`, `cancel_event`, `add_attendees`, `find_meeting_slot`.
- **Event creation:** by agents during work ("book the call", "block focus time",
  "put the deadline on the calendar"); by user via Commander/Home quick-add; optional
  Task-due-date → event linkage (phase 2).
- **Heartbeat context:** **slim** — inject only "today's schedule / deadline proximity"
  for time-sensitive tasks, gated by `runtimeConfig.contextMode`. Not always-on.
- **Notification types:** `calendar.reminder`, `calendar.invite_received`,
  `calendar.event_created`, `calendar.conflict`.

### Drive / Docs — hybrid in + out
- **In (context):** on-demand read of any doc as live agent context.
- **In (memory):** curated folders/docs sync → `memory_items` (layer `domain`,
  `status:'pending'`, embedded) → founder approval (Rules #6, #8). Re-sync handles
  staleness.
- **Out:** write AoA artifacts/docs back to Drive (export a report, share a doc).
- **Scope:** full-drive read (G10) → restricted scope → CASA.

### Sheets / Slides
- Consume as tools only; generated outputs → `artifacts`. No special glue in v1.

---

## Data landing map

| Google data | AoA home | Mechanism |
|---|---|---|
| Email threads | **Inbox** (AI-first view) + roll-up | plugin UI slot + `notifications` |
| Calendar events | **Home widget / Inbox / Commander / agent tool** | tool + `notifications` |
| Drive docs (curated) | **Memory** (pending) | sync job → `memory_items` + `memory_assets` |
| Drive docs (ad-hoc) | agent context | on-demand tool read |
| Reports / exports | **Artifacts** / back to Drive | write tool |

---

## Security & compliance
- **Restricted scopes** (`gmail` read+send, `drive` full read) → Google **CASA**
  security assessment (third-party, paid, annual, ~weeks) required before >100 users.
  **Ship in Google testing/unverified mode first** (≤100 users, pilot), verify before GA.
- Tokens: per-user, AES-256-GCM (`local_encrypted`), audited via `secret_access_events`.
- Agent access always mediated by the per-service "act as me" grant (G6).

---

## Dependencies & build order
1. **Bucket 0a — connection/OAuth framework** (per-user token store, incremental
   consent on the login Google app, Connected Accounts tab, per-service grant model,
   landing-spot adapters). **Prereq for everything here.**
2. **Gmail** (Inbox surface + crew agent) — highest-value.
3. **Calendar** (tool + Home widget + notifications).
4. **Drive** (hybrid sync + read/write).
5. **CASA verification** — parallel track, before GA.

> Bucket 0b (the outbound **MCP Connector Host**) is **not** needed for Google — it's
> for the long-tail buckets (3–14) that consume community MCP servers. Google is direct.
