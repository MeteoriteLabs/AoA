---
Feature: v2_5_discussions_and_agent
Doc type: env
Status: draft
Created: 2026-03-24
Last updated: 2026-03-24
Updated by: agent
Depends on: v2_5_discussions_and_agent_architecture.md, v2_5_discussions_and_agent_integration.md
---

# V2.5 Discussions & Internal Agent — Environment Variables

New environment variables, defaults, and configuration notes.

---

## New Environment Variables

### None Required

V2.5 does **not** introduce any new required environment variables. All configuration is stored in the database (`internal_agent_config` table) and managed through the Settings UI.

This is intentional. The existing pattern in AoA stores LLM API keys in the `company_secrets` + `company_secret_versions` tables (encrypted, versioned), not in `.env`. The internal agent reuses this infrastructure via `secretService(db).resolveSecretValue()`.

---

## Existing Variables (Unchanged)

| Variable | Current Value | Used By v2.5 |
|----------|--------------|--------------|
| `DATABASE_URL` | `postgres://paperclip:paperclip@localhost:5432/paperclip` | New tables, queries |
| `PORT` | `3100` | New API routes served on same port |
| `SERVE_UI` | `false` | No change |

---

## Configuration Stored in Database (Not .env)

All v2.5 configuration lives in the `internal_agent_config` table, one row per company:

| Setting | Column | Default | Description |
|---------|--------|---------|-------------|
| Execution mode | `executionMode` | `'api'` | `'api'`, `'cli'`, or `'dual'` |
| LLM provider | `provider` | `'anthropic'` | Which LLM to use for agent |
| Model | `model` | `'claude-sonnet-4-20250514'` | Specific model identifier |
| Autonomy level | `autonomyLevel` | `0` | 0 = full approval |
| Enabled capabilities | `enabledCapabilities` | All 8 | JSON array of capability strings |
| Notification preference | `notificationPreference` | `'realtime'` | `'silent'`, `'digest'`, `'realtime'` |
| Context token budget | `contextTokenBudget` | `8000` | Max tokens for system context |
| Monthly budget (cents) | `budgetMonthlyCents` | `1000` ($10.00) | Monthly spending cap |
| Budget used (cents) | `spentMonthlyCents` | `0` | Resets monthly |
| Proactive interval (min) | `proactiveIntervalMinutes` | `240` | How often proactive checks run |
| Max response tokens | `maxResponseTokens` | `4096` | Per-turn LLM output limit |

**Why database, not .env?**

1. Per-company settings — multi-tenant, each company has its own config
2. Changeable at runtime via Settings UI — no server restart needed
3. LLM API keys are already in the database (`company_secrets` + `company_secret_versions` tables, encrypted)
4. Proactive interval, budget limits, and capabilities need to be adjustable by the founder without touching the server

---

## Optional .env Overrides (Development Only)

These are **not required** and **not in .env.example**. They exist only for local development convenience.

| Variable | Purpose | Default |
|----------|---------|---------|
| `INTERNAL_AGENT_DEFAULT_PROVIDER` | Override default provider for all companies (dev only) | Uses DB config |
| `INTERNAL_AGENT_DEFAULT_MODEL` | Override default model for all companies (dev only) | Uses DB config |
| `INTERNAL_AGENT_DISABLE_PROACTIVE` | Set to `'true'` to disable proactive scheduler globally (useful in tests) | `'false'` |
| `INTERNAL_AGENT_LOG_PROMPTS` | Set to `'true'` to log full prompts to console (debugging only, never in production) | `'false'` |

These are read in `server/src/services/internal-agent/index.ts` with fallback to DB config:

```typescript
const provider = process.env.INTERNAL_AGENT_DEFAULT_PROVIDER || config.provider;
const model = process.env.INTERNAL_AGENT_DEFAULT_MODEL || config.model;
const proactiveDisabled = process.env.INTERNAL_AGENT_DISABLE_PROACTIVE === 'true';
```

---

## .env.example Update

No changes needed to `.env.example`. The current file remains:

```
DATABASE_URL=postgres://paperclip:paperclip@localhost:5432/paperclip
PORT=3100
SERVE_UI=false
```

LLM API keys (ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_AI_API_KEY) are managed through the Settings → Secrets page via the `company_secrets` + `company_secret_versions` tables (encrypted, versioned), not `.env`. The internal agent resolves API keys at runtime using `secretService(db).resolveSecretValue()` with well-known secret names per provider.

**Note:** The existing extraction service (`server/src/services/extraction.ts`) still reads `process.env.ANTHROPIC_API_KEY` directly as a fallback. This is maintained for backward compatibility but new code should use `company_secrets`.
