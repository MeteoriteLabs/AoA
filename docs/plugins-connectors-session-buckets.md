# Plugins & Connectors — Session Buckets (kickoff index)

> **Purpose:** Turn the build plan into **discrete, session-sized buckets**. Spin up
> one focused session per bucket to research → plan → build. Companion to
> `docs/plugins-connectors-overview.md` (read that for the build-vs-consume law,
> the MCP Connector Host keystone, and where data lands in AoA).

**How to use this file:** pick a bucket → open a new session → paste its row + the
"research inputs" list → have that session produce a concrete spec (existing servers
to consume, glue to build, RBAC, UX). Buckets are ordered by dependency and leverage.

---

## The mental model (unchanged, restated)

- **Consume** commodity API access (an existing MCP server = the hands).
- **Build** only AoA-specific routing as a plugin (the brain: where data lands).
- MCP is the **provider-agnostic** layer — one connector works across Claude, GPT,
  Gemini, etc. Any of the 10,000+ public MCP servers our org agents can consume the
  moment the **MCP Connector Host** (Bucket 0) exists.
- **First-party plugin** = we build+bundle+maintain (touches a core spine:
  Memory / Discussion / Inbox / Tasks). **Consume** = thin wrap. **Community** =
  install from marketplace, we don't build.

---

## RESEARCH INPUTS — the sites & repos every bucket session should mine first

These are the "inspiration + reuse" sources. Each bucket session starts by searching
these for its category before deciding build-vs-consume.

| Source | What it is | Best for |
|---|---|---|
| [Official MCP Registry](https://registry.modelcontextprotocol.io/) | Authoritative, ~3,000 servers, OpenAPI spec | Canonical package metadata; programmatic browse |
| [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) | Anthropic reference servers | Gold-standard implementations to copy patterns from |
| [Claude Connectors Directory](https://claude.com/connectors) | ~439 **vetted** connectors, 30 categories | "Safe to consume" shortlist per category |
| [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) (+ [mcpservers.org](https://mcpservers.org/)) | Curated master list (Frank Fiegel) | Broad category sweep |
| [Glama](https://glama.ai/mcp/servers) | Largest directory (~21–37k), Official/Claimed tiers | Volume + trust filtering |
| [Smithery](https://smithery.ai/) | ~7k, app-store UX, one-click hosting + Toolbox router | Hosted/remote servers; runtime routing idea |
| [PulseMCP](https://www.pulsemcp.com/servers) | ~12–18k, hand-reviewed daily | Freshness, official-provider filter |
| [mcp.so](https://mcp.so/explore) | ~19k community-submitted | Long-tail / unofficial tools |
| [mcp.directory](https://mcp.directory/) + [best-of-mcp-servers](https://github.com/tolkonepiu/best-of-mcp-servers) | Usage-ranked | "Most-used" sanity check |
| [awesome-claude-connectors](https://github.com/rdmgator12/awesome-claude-connectors) · [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) · [claudemarketplaces.com](https://claudemarketplaces.com/) | Claude-side directories | Plugin (bundle) patterns |

> **Idea worth stealing (Smithery Toolbox):** a *meta-MCP* that routes an agent to the
> right server at runtime. Relevant to how AoA exposes many connectors to one agent
> without blowing the context budget (ties to `runtimeConfig.contextMode`). Flag for
> Bucket 0.

---

## THE BUCKETS

### Bucket 0 — Foundation / Platform  ⭐ do first, blocks all others
> **Split (refined during Bucket 1 discussion — no outbound MCP client exists on `main`):**
> - **0a — Connection & OAuth framework (the true keystone).** Token store keyed
>   **per-user AND per-company** as appropriate (Gmail/Calendar are per-user; a company
>   integration is per-company), encrypted via the `github_pat`/`company_secrets`
>   pattern; incremental OAuth on the existing login Google app; a **per-service
>   authorization** model ("this agent may act on my Mail/Calendar/Drive"); and the
>   reusable **landing-spot adapters** (→Inbox `notifications`, →Memory-pending,
>   →Task, →Discussion, →cost_event). **Both direct integrations (Google, MS) and
>   MCP-consumed ones need 0a. Build first.**
> - **0b — MCP Connector Host (outbound client bridge).** `@modelcontextprotocol/sdk`
>   client + tool-bridge into `plugin-tool-registry`. **Only for the long-tail buckets
>   (3–14)** that consume community MCP servers. Google (1) and Microsoft (2) skip it
>   and call provider SDKs directly.
- **Verdict:** Build (core platform capability).
- **Consume:** the SDK itself (0b); study `modelcontextprotocol/servers` patterns.
- **Session questions:** subprocess vs remote transport (0b)? per-user vs per-company
  token isolation? meta-router (Smithery-style) to control context? how connectors
  appear in AoA's own marketplace catalog (`derivePackages.ts`)?

### Bucket 1 — Google Workspace  (its own session, per your call)
> **Design agreed — see `docs/plugins-connectors-bucket1-google.md` for the full v1
> spec** (per-user connections, "act as me" per-service authorization, Gmail→Inbox
> AI-first surface with read+send, Calendar tool-first with full view deferred, Drive
> hybrid sync, direct `googleapis` not MCP, CASA on the radar).
- **Scope:** Gmail, Calendar, Drive, Docs, Sheets, Slides, Tasks, Contacts.
- **Verdict:** **One first-party plugin.** Raw access consumed; glue built:
  Gmail→Discussion→Inbox + Commander "Mail" panel; Calendar = agent/Commander tool;
  Drive/Docs→Memory (pending, Rule #6). Sheets/Slides = consume only.
- **Consume:** [`taylorwilsdon/google_workspace_mcp`](https://github.com/taylorwilsdon/google_workspace_mcp)
  (OAuth 2.1 multi-user — needed for multi-tenant). Alts: `aaronsb`, `dguido`.
- **Session questions:** built-in vs plugin (recommend plugin on the Host); OAuth UX
  location; which services get first-party glue vs tool-only.

### Bucket 2 — Microsoft / Teams / Outlook / M365  (separate session)
- **Scope:** Outlook mail+calendar, **Teams** (chat/channels), SharePoint, OneDrive,
  Excel, OneNote, To Do, Contacts. *Genuinely different from Google — Graph API model,
  tenant/admin consent, Teams channel semantics ≠ email.*
- **Verdict:** **One first-party plugin**, same shape as Google; Teams→Discussion like
  Slack; Outlook mail+calendar share the Mail&Calendar abstraction (Bucket 0).
- **Consume:** [`softeria/ms-365-mcp-server`](https://github.com/softeria/ms-365-mcp-server)
  (200+ Graph tools), [`MarimerLLC/calendar-mcp`](https://github.com/MarimerLLC/calendar-mcp)
  (unifies M365 multi-tenant + Outlook.com + Google + IMAP/ICS).
- **Session questions:** Graph admin-consent flow; Teams vs Outlook as separate
  landing spots; is `calendar-mcp` enough to cover BOTH Google + MS mail/calendar
  (Option B in overview §Part E)?

> **Note on Buckets 1+2:** the **Mail & Calendar provider abstraction** spans both.
> Decide in Bucket 0 whether one unified server (`calendar-mcp`) covers Gmail+Outlook,
> or provider-specific drivers. That decision feeds both sessions.

### Bucket 3 — Communication & Chat
- **Scope:** Slack, Discord, Telegram (+ Teams chat cross-refs Bucket 2).
- **Lands in:** `discussion_entries (mcp)` → extraction → Inbox; notify-out.
- **Verdict:** Slack **first-party**; others consume/community.
- **Consume:** official Slack MCP, Discord MCP.

### Bucket 4 — Project Management / Issues
- **Scope:** Linear, Jira, Asana, ClickUp, Trello, Monday, Notion-as-PM.
- **Lands in:** `issues` (Tasks) **two-way sync** + `task_dependencies`.
- **Verdict:** Linear **first-party** (deep sync); rest consume.
- **Consume:** official Linear MCP, Atlassian/Jira MCP; ref: `claude-task-master` (28k★).

### Bucket 5 — Dev / Engineering tooling
- **Scope:** GitHub (deepen PR/CI→`task_outputs`; already native), GitLab/Bitbucket,
  Sentry, Datadog/Grafana, PagerDuty, CI/CD (Vercel/Netlify/Cloudflare/CircleCI),
  cloud (AWS/GCP/Supabase), DBs (Postgres/Snowflake/BigQuery), Playwright, Figma
  handoff, Filesystem/Git.
- **Lands in:** agent tools, `task_outputs`, Tasks.
- **Verdict:** almost all **consume** (mature servers exist).
- **Consume:** GitHub MCP, [Playwright MCP](https://github.com/microsoft/playwright-mcp)
  (#2, 30k★), Sentry MCP, Postgres MCP, Figma Context MCP (15k★).

### Bucket 6 — Knowledge / Docs / Storage
- **Scope:** Notion, Confluence, Dropbox, Box (Drive/OneDrive covered in 1/2).
- **Lands in:** `memory_items` (pending) + `artifacts`.
- **Verdict:** consume.

### Bucket 7 — Search & Research
- **Scope:** Exa, Tavily, Brave, Perplexity, Context7 (docs), web fetch.
- **Lands in:** agent tools (context only).
- **Verdict:** consume.
- **Consume:** [Exa MCP](https://github.com/exa-labs/exa-mcp-server) (most-used search),
  Context7 (#1 overall).

### Bucket 8 — CRM & Sales / Support
- **Scope:** Salesforce, HubSpot, Pipedrive, Close; Intercom, Zendesk.
- **Lands in:** Tasks + Discussion→Inbox; finance cross-ref.
- **Verdict:** consume.

### Bucket 9 — Marketing & Analytics
- **Scope:** GA4, HubSpot Marketing, Mailchimp, Ahrefs/Semrush, social (Buffer/X/LinkedIn).
- **Lands in:** reports→Artifacts, Discussion.
- **Verdict:** mostly community.

### Bucket 10 — Finance & Budget
- **Scope:** Stripe, QuickBooks, Xero, Ramp, Brex, Plaid.
- **Lands in:** `cost_events`, `finance_events`, `budget_policies`.
- **Verdict:** Stripe consume (official MCP); rest consume/community.

### Bucket 11 — Design
- **Scope:** Figma, Canva.
- **Lands in:** `artifacts`.
- **Verdict:** consume (Figma Context MCP, Canva MCP).

### Bucket 12 — Data & Analytics / Vector
- **Scope:** Snowflake, BigQuery, dbt; Pinecone/Weaviate/Chroma (Memory backing).
- **Verdict:** consume.

### Bucket 13 — Automation / Meta-connectors
- **Scope:** Zapier, Make, n8n, Composio, Smithery Toolbox.
- **Lands in:** webhooks ↔ AoA events (`plugin-webhooks`).
- **Verdict:** consume — one bucket to cover "the long tail via aggregators" so we
  don't build 200 niche connectors.

### Bucket 14 — People / HR / Legal (light)
- **Scope:** Greenhouse/Lever (ATS), DocuSign, Calendly/Cal.com.
- **Verdict:** community.

---

## Suggested session order (dependency-aware)

1. **Bucket 0** (Foundation) — unblocks everything.
2. **Buckets 1 & 2** (Google, Microsoft/Teams) — your two flagged sessions; both
   depend on 0's Mail&Calendar decision.
3. **Buckets 3, 4, 5, 7** (Slack, PM, Dev, Search) — the P1 "cockpit" wave.
4. **Buckets 6, 8, 10, 11** — P2 consume-wave.
5. **Buckets 9, 12, 13, 14** — long tail / mostly community.

## Bucket → department mapping (for AoA's department model)

| Department (`function_type`) | Primary buckets |
|---|---|
| software_development | 5, 4, 7 |
| sales | 8, 1/2 (mail) |
| marketing | 9, 6 |
| support | 8, 3 |
| operations | 10, 13, 1/2 |
| design | 11, 6 |
| data | 12, 7 |
| **company-wide (all)** | 0, 1, 2, 3, 7 |
