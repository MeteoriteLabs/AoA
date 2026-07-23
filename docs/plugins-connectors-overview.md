# Plugins & Connectors — Build Plan & Overview

> **Status:** Planning / strategy. NOT current behavior. This is a research+build
> roadmap for AoA's external integration surface. Pair with `docs/roadmap.md`.
> Architecture context: see the "Plugins", "MCP (Bidirectional)", and
> "Marketplace" sections of `CLAUDE.md` and `docs/api/mcp.md`.

---

## 0. The one idea that makes all of this tractable

Everything below rests on a single standard: **MCP (Model Context Protocol)** —
the open, provider-agnostic protocol for connecting AI to external tools and data.
As of 2026, Claude, ChatGPT, Perplexity, Grok, and Mistral all speak MCP; the
public ecosystem has 10,000+ servers (Claude Connectors Directory ≈ 439 *vetted*;
official MCP Registry ≈ 3,000).

> **MCP is to _tools_ what AoA's adapter registry is to _runtimes_.**
> We are already runtime-agnostic (`claude_local`, `codex_local`, `gemini_local`…).
> MCP lets us be **tool-agnostic** the same way. We build a connector **once** and
> it works regardless of which model drives the agent.

**The build-vs-consume law (read this before adding anything to the list):**

| If the value is… | Then… |
|---|---|
| Commodity API access to a SaaS (Gmail send, Drive list, Jira create) | **CONSUME** an existing MCP server. Do NOT rebuild it. |
| AoA-specific routing/sync (Drive→Memory approval flow, mail→Discussion→Inbox) | **BUILD** it — as an AoA plugin on top of the consumed server. |

So almost nothing is "built inside the core." A connector = **[consumed MCP server
= the hands] + [AoA plugin = the brain that decides where the data lands]**.

---

## 1. The architectural keystone — build this FIRST

> **Refined during the Bucket 1 discussion (see
> `docs/plugins-connectors-bucket1-google.md`).** Verified on `main`: AoA has **no
> outbound MCP client** yet, and the deep first-party integrations (Google, Microsoft)
> need push/granular-scopes/tight control — so they go **direct to the provider SDK**,
> not through a consumed MCP server. That splits this keystone in two:
> - **0a — Connection & OAuth framework:** per-user *and* per-company encrypted token
>   store (github_pat pattern), incremental OAuth, **per-service "act as me"
>   authorization**, and the reusable landing-spot adapters (→Inbox, →Memory-pending,
>   →Task, →Discussion). Needed by **every** connector. Build first.
> - **0b — MCP Connector Host (below):** only for the **long-tail** buckets that
>   consume community MCP servers.

Before the long-tail connectors, build **one reusable capability inside the plugin
runtime**: the **MCP Connector Host** (Bucket 0b).

**What it does (once, for all connectors):**
- Holds a registered MCP **client** (`@modelcontextprotocol/sdk` client half:
  stdio + Streamable HTTP transports + OAuth 2.1 helpers).
- Handles the per-company OAuth handshake; stores tokens **encrypted in
  `company_secrets`** (same pattern as the existing `github_pat`), versioned via
  `company_secret_versions`. **Per-company tokens, never a shared global connection.**
- Bridges a consumed server's tools into `plugin-tool-registry` so org agents and
  Commander can call them, RBAC-scoped via `principal_permission_grants`.
- Provides the **landing-spot adapters** every connector reuses: "write to
  Discussion", "suggest to Memory (pending)", "create Task", "post to Inbox
  (notifications)", "record cost_event".

**Why first:** every connector after this is a *config + glue* exercise, not a new
integration. This is the leverage point. Files to touch:
`server/src/services/plugin-tool-registry.ts`, `plugin-job-coordinator.ts`,
`plugin-secrets-handler.ts`, `plugin-webhooks.ts`.

**Where external data is allowed to land (the AoA spines — never a new silo):**

| External data | Lands in | Rule |
|---|---|---|
| Unstructured messages/email | `discussion_entries` (`inputType: 'mcp'`) → extraction → `discussion_extracted_items` → **Inbox** via `notifications` | Discussion pipeline as designed |
| Docs / knowledge | `memory_items` + `memory_assets` (embedded) | **Critical Rule #6**: agents *suggest* only → `status: 'pending'` for founder approval. Never auto-approve. |
| Tickets / issues | `issues` (Tasks) + `task_dependencies` | Two-way sync |
| Deliverables / files | `artifacts` / `documents` / `task_outputs` | Immutable versions (Rule #7) |
| Money / spend | `cost_events`, `finance_events`, `budget_policies` | Budget surface |
| Calendar / availability | agent heartbeat context + a Commander tool | Read+write tool, not a table |
| Cockpit panels | plugin **UI slots** (`manifest.ui.slots`) | e.g. a Mail panel in Commander |

---

## 2. The catalog, in parts

Each entry: **what it is · where it lands in AoA · existing MCP server to consume ·
verdict · phase**. Phases: **P0** = keystone, **P1** = first wave (highest leverage),
**P2** = fast-follow, **P3** = long tail.

Verdict legend: **Consume** (wrap existing server, thin glue) · **First-party plugin**
(we build+maintain+bundle because it touches a core spine) · **Community** (lives in
marketplace, we don't build).

### PART A — Company-centric (cross-department, every team wants these)

| Plugin | Lands in | Existing MCP server(s) to consume | Verdict | Phase |
|---|---|---|---|---|
| **Mail & Calendar** (Gmail + Outlook/M365) | Discussion→Inbox + Commander panel + Calendar tool | `taylorwilsdon/google_workspace_mcp`, `softeria/ms-365-mcp-server`, or unified `MarimerLLC/calendar-mcp` | **First-party** (see Part D) | **P1** |
| **Google Drive / Docs** ↔ Memory | `memory_items` (pending) + `artifacts` | `taylorwilsdon/google_workspace_mcp` | **First-party** | **P1** |
| **Slack** | Discussion→Inbox; notify-out | official Slack MCP | **First-party** | **P1** |
| **Notion** | Memory + Artifacts | official Notion MCP | Consume | P2 |
| **Web search / research** | agent tool (context) | **Exa** (most-used search server 2026), Tavily, Brave | Consume | **P1** |
| **Documentation lookup** | agent tool | **Context7** (#1 by usage — live docs/memory) | Consume | P2 |
| **Zapier / Make / n8n** (meta-automation) | webhooks ↔ AoA events | Zapier MCP, n8n | Consume | P3 |
| **Microsoft SharePoint / OneDrive** | Memory + Artifacts | `softeria/ms-365-mcp-server` | Consume | P2 |

### PART B — Dev / Engineering-centric (department `function_type: software_development`)

| Plugin | Lands in | Existing MCP server(s) | Verdict | Phase |
|---|---|---|---|---|
| **GitHub** | already native (workspace PR flow) → `task_outputs` | official GitHub MCP | **Already native** — deepen PR/CI surfacing only | — |
| **GitLab / Bitbucket** | `task_outputs` + workspace | GitLab MCP | Consume | P2 |
| **Linear** | `issues` two-way sync | official Linear MCP | **First-party** (deep task sync) | **P1** |
| **Jira** | `issues` two-way sync | Atlassian MCP | First-party | P2 |
| **Sentry / error tracking** | creates Tasks; agent tool | official Sentry MCP | Consume | P2 |
| **Datadog / Grafana / observability** | Tasks + agent tool | Datadog MCP | Consume | P3 |
| **PagerDuty / on-call** | Tasks + Inbox | PagerDuty MCP | Consume | P3 |
| **CI/CD** (CircleCI, Vercel, Netlify, Cloudflare) | `task_outputs` (preview URLs, deploy state) | Vercel/Netlify/Cloudflare MCPs | Consume | P2 |
| **Cloud** (AWS, GCP, Supabase) | agent tool | AWS/Supabase MCPs | Consume | P3 |
| **Databases** (Postgres, Snowflake, BigQuery) | agent tool (read) | official Postgres MCP, etc. | Consume | P2 |
| **Browser automation / E2E** | agent tool; `task_outputs` | **Playwright MCP** (#2 by usage, 30k★) | Consume | P2 |
| **Figma** (design→code handoff) | Artifacts | **Figma Context MCP** (15k★) | Consume | P2 |
| **Filesystem / Git (local)** | agent tool | official Filesystem + Git MCP | Consume | P1 |

### PART C — Department-centric (by department type)

**Sales / CRM**
| Plugin | Lands in | Existing server | Verdict | Phase |
|---|---|---|---|---|
| Salesforce | Tasks + Memory + cost/finance | Salesforce MCP | Consume | P2 |
| HubSpot | Tasks + Discussion | HubSpot MCP | Consume | P2 |
| Pipedrive / Close | Tasks | community MCP | Community | P3 |

**Support / Success**
| Intercom | Discussion→Inbox→Tasks | Intercom MCP | Consume | P2 |
| Zendesk | Discussion→Tasks | Zendesk MCP | Consume | P2 |

**Marketing**
| Google Analytics / GA4 | reports → Artifacts | GA MCP | Consume | P2 |
| HubSpot Marketing / Mailchimp | Discussion + reports | Mailchimp MCP | Consume | P3 |
| SEO (Ahrefs, Semrush) | agent tool / reports | community MCP | Community | P3 |
| Social (Buffer, X, LinkedIn) | Artifacts + scheduling | community MCP | Community | P3 |

**Finance / Ops**
| Stripe | `cost_events` / `finance_events` | official Stripe MCP | Consume | P2 |
| QuickBooks / Xero | finance | community MCP | Consume | P3 |
| Ramp / Brex / Plaid | `cost_events` | community MCP | Community | P3 |

**Design**
| Figma | Artifacts | Figma Context MCP | Consume | P2 |
| Canva | Artifacts | Canva MCP | Consume | P3 |

**Data / Analytics**
| Snowflake / BigQuery / dbt | agent tool + reports | official MCPs | Consume | P3 |
| Vector stores (Pinecone, Weaviate, Chroma) | Memory backing | official MCPs | Consume | P3 |

**People / HR / Legal** (lighter weight)
| Greenhouse / Lever (ATS), DocuSign, Calendly/Cal.com | Tasks + Calendar | community MCPs | Community | P3 |

### PART D — Google Workspace (deep dive: build inside vs plugin)

**Verdict: ONE first-party "Google Workspace" plugin**, consuming
`taylorwilsdon/google_workspace_mcp` (Gmail, Calendar, Drive, Docs, Sheets, Slides,
Tasks, Contacts — with **remote OAuth 2.1 multi-user**, which we need for
multi-tenant). We do NOT build Google API access; we build the AoA glue per service:

| Google service | Build inside as plugin glue? | Where it lands | Notes |
|---|---|---|---|
| **Gmail** | **Yes — first-party glue** | poll job → `discussion_entries (mcp)` → extraction → Inbox; "Mail" UI slot in Commander cockpit | Mail is unstructured → Discussion pipeline by design |
| **Calendar** | **Yes — tool glue** | read/write **tool** for agents + Commander; surfaced into heartbeat context | Agents can check availability / create events mid-run |
| **Drive / Docs** | **Yes — first-party glue** | sync **job** → `memory_items (layer: domain, status: pending)` + `memory_assets`, embedded | **Rule #6**: founder approves before active. Never auto-dump. |
| **Sheets** | Tool only (consume) | agent tool; reports → Artifacts | No special glue needed |
| **Slides** | Tool only (consume) | Artifacts | — |
| **Tasks / Contacts** | Optional (consume) | Tasks / Memory | Low priority |

So: **raw access = consumed. Gmail/Calendar/Drive routing = first-party glue we own.**
Everything is a plugin; nothing forks the core.

### PART E — Mail + Calendar provider strategy (Gmail vs Outlook/M365)

You're right that the two majors are **Gmail and Outlook/Microsoft 365**. Don't build
two parallel integrations — build **one "Mail & Calendar" first-party plugin with a
provider-driver abstraction**:

```
AoA "Mail & Calendar" plugin  (one set of glue: poll→Discussion→Inbox, Calendar tool, UI panel)
        │  provider driver interface (listMessages / sendMessage / listEvents / createEvent)
        ├── Google driver   → consumes taylorwilsdon/google_workspace_mcp
        ├── Microsoft driver→ consumes softeria/ms-365-mcp-server  (200+ Graph tools)
        └── (future) IMAP/ICS→ consumes MarimerLLC/calendar-mcp     (already unifies all three)
```

**Two viable shapes — pick in research stream S1:**
- **Option A (provider drivers):** our abstraction calls provider-specific servers
  (`google_workspace_mcp`, `ms-365-mcp-server`). Max control + best per-provider
  feature coverage. More glue.
- **Option B (single unified server):** consume `MarimerLLC/calendar-mcp`, which
  *already* unifies M365 (multi-tenant) + Outlook.com + Google + IMAP/SMTP + ICS
  behind one server. Far less glue; we inherit its abstraction. Less control.

**Recommendation:** start with **Option B** to ship fast and validate the
Discussion→Inbox and Calendar-tool UX, then migrate hot providers to **Option A**
drivers if we hit feature ceilings. Adding a 3rd provider later = a driver, not a
rebuild.

---

## 3. Top-used in the ecosystem (consume-first reference)

Build-vs-consume sanity check — the most-installed public servers (2026). If it's
here, **consume it**:

| Server | Category | Why it's top | Our use |
|---|---|---|---|
| **Context7** | Docs/memory | #1 by usage; live docs | Dev agent tool (P2) |
| **Playwright** | Browser automation | #2; 30k★ | E2E / web tasks (P2) |
| **GitHub** | Dev | central to dev flow | already native |
| **Exa** | Search | most-used search server | research tool (P1) |
| **Figma Context** | Design | 15k★ | design→code (P2) |
| **claude-task-master** | PM | 28k★ | reference for our task UX |
| **Stripe / Slack / Notion / Linear / Sentry** | SaaS | vetted in Connectors Directory | per Parts A–C |

---

## 4. Suggested research streams (parallelizable)

Each stream is independent — hand to a different person/agent:

- **S0 — MCP Connector Host (keystone).** Build the reusable host: client transport,
  per-company OAuth→`company_secrets`, tool-bridge into `plugin-tool-registry`,
  landing-spot adapters. *Blocks everything; do first.* (P0)
- **S1 — Mail & Calendar.** Decide Option A vs B (Part E). Build provider abstraction,
  Gmail+Outlook drivers, Discussion→Inbox poll job, Calendar tool, Commander UI slot. (P1)
- **S2 — Google Drive/Docs ↔ Memory.** Sync job, `pending` memory suggestion flow,
  embedding, founder approval UX, conflict/dedup (Rule #8: ≥3 occurrences for
  feedback-driven memory). (P1)
- **S3 — Slack.** Inbound (Discussion) + outbound (notify) + slash-command surface. (P1)
- **S4 — Dev connectors wave.** Linear two-way `issues` sync; deepen GitHub PR/CI →
  `task_outputs`; Sentry → Tasks. (P1–P2)
- **S5 — CRM/Support wave.** Salesforce/HubSpot/Intercom/Zendesk → Discussion/Tasks. (P2)
- **S6 — Marketplace surfacing.** How consumed connectors appear in AoA's own
  marketplace catalog (`derivePackages.ts`, `packages/shared/src/marketplace.ts`):
  trust tiers, `requires-api-key`/`requires-cli-tooling` tags, install UX. (P2)
- **S7 — RBAC & security.** Per-connector permission grants
  (`principal_permission_grants`), token rotation, audit (`activity_log`),
  what external MCP callers may/may not see (mirror `use_skill` actor gating). (parallel)

## 5. Sequencing summary

1. **P0:** S0 keystone (MCP Connector Host).
2. **P1 first wave:** Mail & Calendar (S1), Drive↔Memory (S2), Slack (S3), Exa search,
   Linear (S4). These cover the "company cockpit" vision: mail in Inbox, docs in Memory,
   calendar to agents, chat in Discussion.
3. **P2 fast-follow:** Notion, Jira, Sentry, Stripe, Figma, Playwright, CRM/Support,
   marketplace surfacing (S5/S6).
4. **P3 long tail:** mostly **Community** — install from marketplace, we don't build.

---

## Open questions to resolve before P1

1. **Mail/Calendar:** Option A (provider drivers) vs Option B (unified `calendar-mcp`)?
   → Recommendation: B first, A later. Decide in S1.
2. **Hosting consumed servers:** run them as local subprocesses (stdio, per the
   adapter pattern) or remote Streamable HTTP? Affects multi-tenant token isolation.
3. **First-party vs community boundary:** confirm which connectors we bundle+maintain
   (touch Memory/Discussion/Inbox spines) vs leave to the marketplace.
4. **OAuth UX:** where the founder connects accounts — Settings? Per-department?
   Per-agent? (RBAC implications in S7.)
