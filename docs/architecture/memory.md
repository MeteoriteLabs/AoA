---
title: Memory — UI & Retrieval Reference
summary: Memory explorer layout, semantic retrieval configuration, and feedback detector details
---

Deep implementation detail for the memory system. For the data model, lifecycle rules, and approval gates see `CLAUDE.md` §Memory System and the schema at `packages/db/src/schema/memory_items.ts`.

## Memory UI

The memory explorer is a **3-pane layout**:

- **Left pane:** folder tree. Collapsed state shows `MemoryFolderRail` — 5 shortcut icons + 4 layer icons + expand button.
- **Center pane:** item list. Three view modes: **List** (default) / **Table** / **Cards**. View mode persists via `localStorage["aoa:memory:view-mode"]`.
- **Right pane:** item detail. Tabbed — multiple items open simultaneously. Tabs backed by URL (`?tabs=…&active=…`) so deep-links and browser back/forward work correctly.

## Semantic Retrieval

Uses **pgvector** for embedding-based similarity search.

| Property | Value |
|----------|-------|
| Embedding model | OpenAI `text-embedding-3-small` |
| Dimensions | 1536 |
| Similarity metric | Cosine |
| Index type | HNSW (partial — skips NULL embedding rows) |
| Cosine threshold | 0.85 |
| Word-overlap threshold | 0.6 (fallback scoring) |

**Fallback chain:**
1. HNSW index (when pgvector is installed and index exists)
2. Sequential scan (when pgvector installed but index missing)
3. `ilike` text search (when no OpenAI API key — no embeddings generated)

**Background worker (`processEmbeddingQueue`):** processes in batches of 10 items, up to 3 retry attempts tracked per item via `embeddingRetries` counter (no delay between attempts — retries happen on the next queue run).

**pgvector absent entirely:** if the pgvector extension is not installed, the `embedding` column is not queryable. The retrieval code gates vector queries on pgvector availability and falls through to `ilike` text search in that case.

## Memory Feedback Detectors

The `memory_feedback_patterns` table tracks recurring edits made by founders to agent-produced content. Six pattern types are valid in the schema; four have active detector functions:

| Pattern type | Active detector | What it catches |
|-------------|----------------|----------------|
| `tone_correction` | ✅ | Founder consistently rewrites agent tone or voice |
| `format_change` | ✅ | Founder consistently restructures output format |
| `content_addition` | ✅ | Founder consistently adds the same type of missing content |
| `terminology_change` | ✅ | Founder consistently replaces specific terms |
| `content_removal` | — | Founder consistently trims agent output (type valid, no detector yet) |
| `structure_change` | — | Founder consistently reorganizes output structure (type valid, no detector yet) |

Suggestions are generated after **≥3 occurrences** of the same pattern (Decision #46). Detectors read `activity_log` rows with `action = "brief_item.updated"`, following the `brief → debrief → sourceInfo.agentId` chain to resolve which agent produced the original content. Results are grouped by agent in the Memory Feedback UI.
