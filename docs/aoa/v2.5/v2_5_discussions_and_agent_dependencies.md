---
Feature: v2_5_discussions_and_agent
Doc type: dependencies
Status: draft
Created: 2026-03-24
Last updated: 2026-03-24
Updated by: agent
Depends on: v2_5_discussions_and_agent_architecture.md
---

# V2.5 Discussions & Internal Agent — Dependencies

Library choices, version requirements, and what's new vs. already in the project.

---

## Existing Dependencies (No Changes Needed)

These are already in the project and fully sufficient for v2.5.

### Server (`server/package.json`)

| Package | Current Version | Used By v2.5 |
|---------|----------------|---------------|
| `@anthropic-ai/sdk` | `^0.79.0` | Internal agent Anthropic provider — Messages API with streaming and tool use |
| `openai` | `^6.29.0` | Internal agent OpenAI provider — Chat Completions with streaming and tools; Whisper transcription (already used for voice debrief) |
| `@google/generative-ai` | `^0.24.1` | Internal agent Google provider — generateContent with function calling |
| `drizzle-orm` | `^0.38.4` | All new tables, queries, relations |
| `zod` | `^3.24.2` | Request body validation for new API routes |
| `ws` | `^8.19.0` | WebSocket for new LiveEvent types (discussion.extraction.completed, etc.) |
| `express` | `^5.1.0` | Route middleware, SSE response streaming |
| `multer` | `^2.0.2` | Voice recording file uploads for discussion entries |
| `@aws-sdk/client-s3` | `^3.888.0` | Audio asset storage (voice entries) — same as existing voice debrief |
| `pino` | `^9.6.0` | Structured logging for agent runs, extraction events |
| `better-auth` | `1.4.18` | Auth middleware for new routes — same RBAC pattern |

### Server Dev Dependencies

| Package | Current Version | Used By v2.5 |
|---------|----------------|---------------|
| `vitest` | `^3.0.5` | All v2.5 test suites |
| `supertest` | `^7.0.0` | API endpoint tests |
| `tsx` | `^4.19.2` | Migration scripts, dev execution |

### Database (`packages/db`)

| Package | Notes |
|---------|-------|
| `drizzle-orm` | Schema definitions for 10 new tables |
| `drizzle-kit` | Migration generation (`pnpm db:generate`) |
| `postgres` / `pg` | Driver — no changes |
| pgvector extension | Already enabled for memory embeddings — no changes needed for v2.5 |

### UI (`ui/package.json`)

| Package | Notes |
|---------|-------|
| `react` `^19.0.0` | Agent panel, discussion pages |
| `@tanstack/react-query` | Data fetching for discussions, agent conversations |
| `tailwindcss` | Styling for new components |
| `react-router-dom` | New routes for discussions |

---

## New Dependencies

### Required

**None.** V2.5 does not require any new npm packages. All LLM SDKs, WebSocket, streaming, file upload, and testing libraries are already in the project.

### Recommended (Optional, Not Blocking)

| Package | Purpose | Why Optional |
|---------|---------|-------------|
| `eventsource-parser` | SSE stream parsing utility for frontend agent chat | Can be implemented manually with ~30 lines (ReadableStream + TextDecoder). Only add if the manual implementation becomes complex. |
| `tiktoken` | Accurate token counting for context budget | Currently using `ceil(text.length / 4)` heuristic (per architecture doc). Only needed if heuristic proves too inaccurate. ~2MB wasm module — weight vs. accuracy tradeoff. |

---

## Internal Package Dependencies

V2.5 adds code across multiple workspace packages. Dependency flow:

```
packages/db
  └── New schema files (discussions.ts, internal-agent.ts, workflow-templates.ts)
  └── Exports new tables and relations

packages/shared
  └── New type definitions (discussion types, agent types, workflow types)
  └── New validator schemas (zod)
  └── New constants (extraction types, agent capabilities, trigger sources)

server
  └── Imports from @armyofagents/db (new tables)
  └── Imports from @armyofagents/shared (new types, validators)
  └── New services: discussions.ts, internal-agent/*, workflow-templates.ts
  └── New routes: discussions.ts, internal-agent.ts, workflow-templates.ts
  └── Modified: MCP handlers, search service, inbox/notifications

ui
  └── Imports from @armyofagents/shared (new types)
  └── New pages: Discussions.tsx, DiscussionDetail.tsx
  └── New components: InternalAgentPanel.tsx, DiscussionCaptureModal.tsx
  └── New API clients: discussions.ts, internal-agent.ts
  └── New context: AgentPanelContext.tsx
  └── Modified: Sidebar.tsx, Layout.tsx, BreadcrumbBar.tsx, search
```

---

## Version Compatibility Notes

### LLM SDK Streaming

All three SDKs at their current versions support streaming with tool use:

- **@anthropic-ai/sdk ^0.79.0**: `messages.stream()` with `tool_use` content blocks. Full streaming tool call support since v0.20+.
- **openai ^6.29.0**: `chat.completions.create({ stream: true })` with `tool_calls` in streamed chunks. Stable since v4.
- **@google/generative-ai ^0.24.1**: `generateContentStream()` with `functionCall` parts. Function calling stable since v0.10+.

### Express 5 + SSE

Express 5 (`^5.1.0`) supports SSE via `res.write()` + `res.flush()`. The internal agent chat endpoint will use this pattern (same as Hono's `c.stream()` if the project migrates). Key: set `Content-Type: text/event-stream` and `Cache-Control: no-cache`.

Note: The CLAUDE.md references Hono framework, but the actual codebase uses Express 5.1.0 (`server/package.json`). All v2.5 route handlers, middleware, and SSE streaming use Express patterns (`Router()`, `req`/`res`, `res.write()`).

### Drizzle ORM

No schema syntax changes needed. All v2.5 tables use standard Drizzle patterns already in the codebase (pgTable, uuid, text, integer, jsonb, timestamp, references, index).

---

## System-Level Dependencies

| Dependency | Requirement | Status |
|------------|-------------|--------|
| PostgreSQL | ≥ 14 (for generated columns, better jsonb) | Already required |
| pgvector extension | ≥ 0.5.0 (HNSW index added in migration 0083; sequential-scan fallback if extension missing) | Already installed |
| Node.js | ≥ 20 (for native fetch, ReadableStream) | Already required |
| pnpm | Workspace package manager | Already used |

No new system-level dependencies.

---

## Dependency Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| LLM SDK breaking change | Low | Medium | Pin exact versions; SDKs are mature |
| Provider API deprecation | Low | High | Provider abstraction layer isolates impact |
| pgvector compatibility | Very low | Low | Already proven in V2 |
| Express SSE issues | Low | Medium | Well-documented pattern; fallback to raw `res.write()` |
| Token counting inaccuracy | Medium | Low | Heuristic (length/4) is a 25% estimate; add tiktoken later if needed |

---

## Build & Dev Impact

No changes to build configuration:
- `pnpm build` — same pipeline (tsc + vite)
- `pnpm dev` — same hot reload
- `pnpm test` — vitest runs new test files automatically
- `pnpm db:generate` — picks up new schema files automatically
- `pnpm db:migrate` — applies new migrations

New files follow existing folder conventions, so no tsconfig, vite config, or workspace config changes needed.
