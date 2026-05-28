// server/src/services/internal-agent/service-container.ts
import OpenAI from "openai";
import type { Db } from "@armyofagents/db";
import type { ServiceContainer } from "./types.js";
import { issueService } from "../issues.js";
import { goalService } from "../goals.js";
import { agentService } from "../agents.js";
import { projectService } from "../projects.js";
import { memoryService } from "../memory.js";
import { costService } from "../costs.js";
import { activityService } from "../activity.js";
import { heartbeatService } from "../heartbeat.js";
import { suggestionService } from "../suggestions.js";
import { artifactService } from "../artifacts.js";
import { dependencyService } from "../dependencies.js";
import { secretService } from "../secrets.js";
import { notificationService } from "../notifications.js";
import { discussionService } from "../discussions.js";
import { threadService } from "../threads.js";
import { companyService } from "../companies.js";
import {
  createEmbeddingService,
  type EmbeddingService,
} from "../embeddings.js";
import { logger } from "../../middleware/logger.js";

/**
 * Embedding model used for the synchronous `embedSync` path. Matches the
 * default in `startEmbeddingWorker` so production and tool-time use the
 * same model + dimensions. text-embedding-3-small produces 1536-dim vectors
 * — the same shape the `discussions.summary_embedding` and
 * `memory_items.embedding` columns store.
 */
const SYNC_EMBEDDING_MODEL = "text-embedding-3-small";

/**
 * Lazily-built embedding service used to back `ctx.services.embeddings` in
 * tools like `find_similar_threads`. We deliberately do NOT start a worker
 * here — the background drain loop is already running from `index.ts`
 * (`startEmbeddingWorker`). The container needs only the *service handle*
 * so synchronous `embedSync` calls succeed; the write-behind queue is
 * separately drained by the worker.
 *
 * Why a per-db Map instead of a single module-level singleton:
 *   - Tests build multiple ServiceContainer instances against different
 *     mock `db` handles. A single singleton would alias them.
 *   - Production has exactly one `db` instance, so the Map size is 1 in
 *     practice — no memory pressure.
 *
 * Why memoize at all instead of building per-request:
 *   - Each `new OpenAI(...)` allocates an HTTP keepalive agent + parses
 *     config. ServiceContainer is built per request in `routes/internal-
 *     agent.ts`, so building a fresh service per request would churn.
 *
 * Returns `undefined` when `OPENAI_API_KEY` is missing — tools then surface
 * `EMBEDDINGS_UNAVAILABLE` gracefully (matches the test/dev environment
 * behavior that batch 1 was designed against).
 */
const embeddingServiceCache = new WeakMap<Db, EmbeddingService>();
let warnedMissingKey = false;

function getOrCreateEmbeddingService(db: Db): EmbeddingService | undefined {
  const cached = embeddingServiceCache.get(db);
  if (cached) return cached;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    if (!warnedMissingKey) {
      // Log once per process lifetime to avoid spamming the log on every
      // request. Tools that need the service will surface
      // EMBEDDINGS_UNAVAILABLE; this log explains why.
      logger
        .child({ service: "service-container" })
        .warn(
          "OPENAI_API_KEY is not set — services.embeddings unavailable. " +
            "find_similar_threads + find_similar_memory_hnsw will return EMBEDDINGS_UNAVAILABLE. " +
            "Set OPENAI_API_KEY to enable semantic search from tools.",
        );
      warnedMissingKey = true;
    }
    return undefined;
  }

  const openai = new OpenAI({ apiKey });
  const service = createEmbeddingService(db, {
    async embed(text: string) {
      const r = await openai.embeddings.create({
        model: SYNC_EMBEDDING_MODEL,
        input: text,
      });
      const embedding = r.data[0]?.embedding;
      if (!embedding) {
        throw new Error("OpenAI returned no embedding data");
      }
      return embedding as number[];
    },
  });
  embeddingServiceCache.set(db, service);
  return service;
}

export function createServiceContainer(db: Db): ServiceContainer {
  const companySvc = companyService(db);
  const embeddings = getOrCreateEmbeddingService(db);
  return {
    issues: issueService(db),
    goals: goalService(db),
    agents: agentService(db),
    projects: projectService(db),
    memory: memoryService(db),
    costs: costService(db),
    activity: activityService(db),
    heartbeat: heartbeatService(db),
    suggestions: suggestionService(db),
    artifacts: artifactService(db),
    dependencies: dependencyService(db),
    secrets: secretService(db),
    notifications: notificationService(db),
    discussions: discussionService(db),
    threads: threadService(db),
    companies: {
      get: (id: string) => companySvc.getById(id).then((row) => {
        if (!row) return null;
        return {
          name: row.name ?? null,
          vision: row.vision ?? null,
          mission: row.mission ?? null,
          issuePrefix: row.issuePrefix ?? null,
          stage: null, // companies schema has no stage field
        };
      }),
      update: async (id: string, data: Partial<{ vision: string; mission: string }>) => {
        const row = await companySvc.update(id, data);
        if (!row) throw new Error(`Company ${id} not found`);
        return {
          id: row.id,
          name: row.name ?? null,
          vision: row.vision ?? null,
          mission: row.mission ?? null,
        };
      },
    },
    workflows: null,
    embeddings,
  };
}
