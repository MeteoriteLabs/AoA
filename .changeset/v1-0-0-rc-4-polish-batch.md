---
"aoa": patch
---

Polish batch for v1.0.0-rc.4 — 15 rebrand/UX/a11y findings closed in one pass.

**Rename sweep (Findings C, Q)**
- CLI `aoa` startup banner (`cli/src/utils/banner.ts`) and server startup banner (`server/src/startup-banner.ts`) now spell AOA in block-art instead of PAPERCLIP; tagline reads "Army of Agents — open-source orchestration for zero-human companies".
- CLI help text and onboard prompt — `Start Paperclip` → `Start AoA`, `Run diagnostic checks on your Paperclip setup` → `... AoA setup`.
- Token prefixes: invite tokens `pcp_invite_` → `aoa_invite_`, claim secrets `pcp_claim_` → `aoa_claim_`, MCP API keys `pcp_mcp_` → `aoa_mcp_`. All three verify by hash so existing tokens keep working without migration.
- Plugin namespace: `paperclip.hello-world-example`, `paperclip-file-browser-example`, `paperclip-kitchen-sink-example` → `aoa.*` / `aoa-*`. `pluginRegistryService.getByKey` now falls back to the legacy `paperclip.*` / `paperclip-*` key so existing installed plugins keep loading.
- Plugin example descriptions, kitchen-sink UI section titles ("Paperclip Animation" → "AoA Animation", "Paperclip Domain APIs" → "AoA Domain APIs"), and plugin README install instructions are now AoA-branded.
- Wire-compat / backward-compat identifiers intentionally preserved and documented: `paperclipPlugin` package.json key + `__paperclipPluginBridge__` global (internal plugin-loader protocol), `paperclipai` CLI bin alias, `PAPERCLIP_*` env vars (mirrored to `AOA_*`), `paperclip-feedback-envelope-v2` / `paperclip-feedback-bundle-v2` schemaVersion (new `docs/telemetry.md` section explains why and how to evolve).

**UX / copy (Findings E, O, R)**
- New-routine dialog hint no longer promises "webhooks, or internal runs" — replaced with "Webhook triggers ship in a future release" to match the actual trigger UI (schedule-only today).
- Skills page empty state, when no search filter is active, now explains: "No custom skills yet. Built-in skills (like paperclip-create-agent) are managed by the underlying CLI tool and aren't shown here." The old "No skills match this filter" copy still shows when filtering.
- New-goal dept/project picker: button label "Dept / Project *" → "Depts / Projects (one or more) *" and each row now renders an explicit checkbox (Square / CheckSquare) with `role="checkbox"` + `aria-checked` — the multi-select affordance is no longer hidden behind a single check icon.

**Accessibility (Finding T)**
- Vision/Mission/Values pencil buttons (`IdentityCard` in `Objectives.tsx`) get `aria-label={`Edit ${label}`}` + matching `title`.
- TaskSlideOver: workspace-close `<X>`, Open-in-LLM `<Sparkles>`, and task-more `<MoreHorizontal>` icon buttons get aria-labels.
- `AgentCard` pause/resume + more-actions buttons get context-aware aria-labels using the agent name.
- All four New* dialog headers (`NewAgentDialog`, `NewGoalDialog`, `NewIssueDialog`, `NewProjectDialog`) get aria-labels on their expand/collapse and close icon buttons.

**Backend / API (Findings B, M, V)**
- Explicit 404 handler for the mis-path `GET|POST|... /api/companies/:cid/issues/:id` — responds with `{ error, hint, correctRoute }` pointing callers to the canonical `/api/issues/:id`. Registered *after* the list route so `GET /companies/:cid/issues` and the attachments sub-route are unaffected.
- Budget Policy hard-delete — new `DELETE /api/companies/:cid/budgets/policies/:policyId` route (board-only, company-scoped). Wired into `BudgetPolicyCard` via an optional `onDelete` handler and surfaced on `/TES/budget` with a confirmation prompt.
- Server-side `parentId` filter on issue list — `IssueFilters.parentId?: string | null`. `null` (sent as `?parentId=null`) matches `WHERE parent_id IS NULL`; a UUID matches that parent. TaskSlideOver now uses a dedicated server query for children instead of client-side filtering the full company issue list, which scales as the task count grows.

**Instance settings (Finding W)**
- Heartbeats tab shows a company badge next to each agent row (derived from `companyIssuePrefix`) and a Company filter dropdown in the toolbar (only renders when more than one company has heartbeat agents). "Disable all" now scopes to the filtered view, not the whole instance.

**Docs + guardrails**
- `CLAUDE.md` drift fixes (Finding F): "Extraction failure: Discussion entry marked `processing_failed`" → `failed`; feedback consent modal "2 options: Yes-always / Never" → "3 options: Always allow / Don't allow / Ask each time".
- New CLAUDE.md architecture notes: approval-gate behavior in `local_trusted` mode (Finding I — nothing is auto-approved, the synthetic local-board user is the approver) and the MCP deployment-mode auth contract (Finding P — `local_trusted` accepts unauth'd MCP via the board actor; `cloud_auth` / `authenticated` require a Bearer token matching `mcp_api_keys`).
- New `docs/telemetry.md` "Bundle envelope schemaVersion" section (Finding G) explains that `paperclip-feedback-envelope-v2` is intentional wire-compat, not a rename miss, and what to do if a v3 shape is needed.
- New `brand-check` CI job in `.github/workflows/pr.yml` enforces four targeted patterns on the runtime source trees (`server/src`, `ui/src`, `cli/src`, `packages/plugins/examples`): no `pcp_(invite|mcp|claim)_` token prefixes, no `paperclip.*-example` plugin keys, no PAPERCLIP ASCII banner blocks, no user-visible "Start Paperclip" / "Paperclip dashboard" / "Paperclip plugin API" / "Paperclip setup" strings. Documented allow-list for wire-compat residuals.
