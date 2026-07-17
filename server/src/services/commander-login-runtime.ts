import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Db } from "@armyofagents/db";
import { commanderLoginChallenges } from "@armyofagents/db";
import { and, eq, sql } from "drizzle-orm";
import { runCodexLogin, resolveSharedCodexHomeDir } from "@armyofagents/adapter-codex-local/server";
import { runClaudeLoginStreaming, resolveClaudeConfigHome } from "@armyofagents/adapter-claude-local/server";
import { terminateByPid } from "../utils/terminate-process.js";
import {
  createCommanderLoginService,
  type ChallengeRow,
  type ChallengeStore,
  type CommanderLoginProvider,
  type CommanderLoginService,
  type LoginRunLike,
} from "./commander-login.js";

/** Route-facing discovery cap — bounds how long `start` waits for the URL. */
const LOGIN_URL_DISCOVERY_MS = 60_000;

/**
 * Provider completion evidence (Codex P1 #9 — do NOT hardcode auth.json for both):
 *  - openai/codex → `<home>/auth.json`
 *  - anthropic/claude → `<home>/.credentials.json` (dogfood-verified filename;
 *    change here if the live CLI writes elsewhere).
 */
function credentialFile(provider: CommanderLoginProvider, authHome: string): string {
  return provider === "openai"
    ? path.join(authHome, "auth.json")
    : path.join(authHome, ".credentials.json");
}

function mapRow(r: typeof commanderLoginChallenges.$inferSelect): ChallengeRow {
  return {
    id: r.id,
    companyId: r.companyId,
    provider: r.provider as CommanderLoginProvider,
    authHome: r.authHome,
    loginUrl: r.loginUrl,
    pid: r.pid,
    pgid: r.pgid,
    status: r.status as ChallengeRow["status"],
    startedByUserId: r.startedByUserId,
    startedAt: r.startedAt,
  };
}

/** Exported for tests (commander-login-runtime-store.test.ts). */
export function drizzleChallengeStore(db: Db): ChallengeStore {
  return {
    async claim({ provider, authHome, row, onExisting }) {
      // Atomic single-flight claim (Codex P1): the (provider, auth_home,
      // status) index is NON-unique, so without mutual exclusion two
      // overlapping starts both see "no pending row" and both insert.
      // Serialized by a transaction-scoped advisory lock on the slot key —
      // same pattern as first-user-bootstrap.ts.
      return await (
        db as unknown as { transaction: <T>(fn: (tx: Db) => Promise<T>) => Promise<T> }
      ).transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`commander-login:${provider}:${authHome}`}))`,
        );
        const [existing] = await tx
          .select()
          .from(commanderLoginChallenges)
          .where(
            and(
              eq(commanderLoginChallenges.provider, provider),
              eq(commanderLoginChallenges.authHome, authHome),
              eq(commanderLoginChallenges.status, "pending"),
            ),
          )
          .orderBy(commanderLoginChallenges.startedAt)
          .limit(1);
        if (existing) {
          // Throws on conflict → transaction rolls back, nothing inserted.
          onExisting(mapRow(existing));
          await tx
            .delete(commanderLoginChallenges)
            .where(eq(commanderLoginChallenges.id, existing.id));
        }
        await tx.insert(commanderLoginChallenges).values({
          id: row.id,
          companyId: row.companyId,
          provider: row.provider,
          authHome: row.authHome,
          loginUrl: row.loginUrl,
          pid: row.pid,
          pgid: row.pgid,
          status: row.status,
          startedByUserId: row.startedByUserId,
          startedAt: row.startedAt,
        });
        return row;
      });
    },
    async get(id) {
      const [r] = await db
        .select()
        .from(commanderLoginChallenges)
        .where(eq(commanderLoginChallenges.id, id))
        .limit(1);
      return r ? mapRow(r) : null;
    },
    async update(id, patch) {
      await db
        .update(commanderLoginChallenges)
        .set({ ...patch, updatedAt: new Date(), finishedAt: patch.status && patch.status !== "pending" ? new Date() : undefined })
        .where(eq(commanderLoginChallenges.id, id));
    },
    async remove(id) {
      await db.delete(commanderLoginChallenges).where(eq(commanderLoginChallenges.id, id));
    },
    async listActive() {
      const rows = await db
        .select()
        .from(commanderLoginChallenges)
        .where(eq(commanderLoginChallenges.status, "pending"));
      return rows.map(mapRow);
    },
  };
}

/**
 * Wire the login lifecycle to Drizzle + the real provider runners. Shared by
 * the route (start/status/cancel) and the boot reaper (index.ts).
 */
export function buildCommanderLoginService(db: Db): CommanderLoginService {
  return createCommanderLoginService({
    store: drizzleChallengeStore(db),
    resolveAuthHome: (provider, env) =>
      provider === "openai" ? resolveSharedCodexHomeDir(env) : resolveClaudeConfigHome(env),
    runLogin: (provider, args): LoginRunLike =>
      provider === "openai"
        ? runCodexLogin({ runId: args.runId, env: args.env, discoveryTimeoutMs: LOGIN_URL_DISCOVERY_MS })
        : runClaudeLoginStreaming({ runId: args.runId, env: args.env, discoveryTimeoutMs: LOGIN_URL_DISCOVERY_MS }),
    credentialPresent: async (provider, authHome) => {
      const stat = await fs.stat(credentialFile(provider, authHome)).catch(() => null);
      return Boolean(stat?.isFile());
    },
    terminate: terminateByPid,
    newId: () => randomUUID(),
    env: () => process.env,
  });
}
