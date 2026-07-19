// server/src/services/braindump.ts
//
// WS6 — braindump ingestion service. Owns the full lifecycle: capture,
// idempotent dispatch of the Librarian crew agent, and status resolution.
//
// Dispatch decision (spec: "decide whether the Librarian extracts via its
// own tools or the server invokes the extraction engine and hands it
// candidates — pick one"): the LIBRARIAN EXTRACTS VIA ITS OWN TOOLS. The
// server does not call the extraction engine (extraction.ts) at all for
// braindumps — it dispatches a real crew run (runAoaAgent) with the
// braindump content injected into the trigger prompt (see
// aoa-trigger-prompt.ts's "braindump.ingest" branch), and the Librarian's
// only write tool is `write_memory` (server/src/services/internal-agent/tools/memory-write.ts),
// which already enforces the safe contract end-to-end: source="agent",
// status="pending", sourceContext required, departmentId ownership-checked
// against the running company. Reusing that existing, already-audited
// chokepoint (rather than adding a second server-side path that writes
// memory_items directly) keeps exactly ONE code path capable of turning
// braindump text into memory items.
//
// Status machine: pending -> running -> proposed -> failed. "approved" is
// NOT a stored status here — it's a derived view (see `deriveEffectiveStatus`
// below) computed from whether every currently-linked proposed memory item
// has been approved via the existing founder approval route
// (POST /companies/:companyId/memory/:id/approve, memory.ts:466-511). This
// avoids coupling this service to that route's approval side-effects; the
// approval route remains the ONLY place a memory item's status flips to
// "approved" (Decision boundary — inline founder approval in the future
// LibrarianStep UI must call that route, not a bespoke one, per the WS6 spec).
//
// Idempotency: `submit` is safe to call twice with the same idempotencyKey —
// the second call finds the existing row via the unique
// (companyId, departmentId, idempotencyKey) index and, if the row is still
// "pending" (dispatch never started, e.g. the process crashed before the
// atomic claim), re-attempts dispatch exactly once via the same atomic
// UPDATE...WHERE status='pending' claim used by `retry`. A row already
// "running"/"proposed"/"failed" is returned as-is — never double-dispatched.

import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { agents, aoaAgentTriggers, braindumpCaptures, memoryItems, projects } from "@armyofagents/db";
import { badRequest, notFound } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { runAoaAgent } from "./internal-agent/aoa-agents/runner.js";

const log = logger.child({ svc: "braindump" });

export type BraindumpCaptureRow = typeof braindumpCaptures.$inferSelect;

export interface BraindumpWithEffectiveStatus extends BraindumpCaptureRow {
  /** "approved" when status="proposed", at least one item was proposed, and
   *  every linked memory item has been approved. Otherwise mirrors `status`. */
  effectiveStatus: string;
}

async function resolveLibrarianAgentId(db: Db, companyId: string): Promise<string | null> {
  // Joins through the trigger's config.role rather than agents.name so a
  // marketplace-install conflict-rename (team-installer.ts can rename on
  // collision) never breaks dispatch.
  const [row] = await db
    .select({ id: agents.id })
    .from(agents)
    .innerJoin(aoaAgentTriggers, eq(aoaAgentTriggers.agentId, agents.id))
    .where(
      and(
        eq(agents.companyId, companyId),
        eq(agents.kind, "aoa"),
        sql`${aoaAgentTriggers.config}->>'role' = 'librarian'`,
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/** Best-effort correlation of memory items this Librarian run produced.
 *  Not authoritative (see the schema doc comment) — a query-time snapshot
 *  used only to populate `proposedMemoryItemIds` for display. */
async function correlateProposedMemoryItems(
  db: Db,
  companyId: string,
  departmentId: string,
  librarianAgentId: string,
  runStartedAt: Date,
): Promise<string[]> {
  try {
    // Small clock-skew buffer: the adapter subprocess writes memory_items on
    // its own clock/connection; back off a couple seconds from our own
    // runStartedAt so a item written a moment "before" our timestamp (skew,
    // not truth) is still picked up.
    const since = new Date(runStartedAt.getTime() - 2000);
    const rows = await db
      .select({ id: memoryItems.id })
      .from(memoryItems)
      .where(
        and(
          eq(memoryItems.companyId, companyId),
          eq(memoryItems.departmentId, departmentId),
          eq(memoryItems.source, "agent"),
          eq(memoryItems.createdBy, librarianAgentId),
          gte(memoryItems.createdAt, since),
        ),
      )
      .orderBy(desc(memoryItems.createdAt))
      .limit(100);
    return rows.map((r) => r.id);
  } catch (err) {
    log.warn({ err, companyId, departmentId }, "correlateProposedMemoryItems: best-effort lookup failed");
    return [];
  }
}

/**
 * Atomically claim a row (pending|failed -> running) and dispatch the
 * Librarian over it. No-ops (returns false) if the row isn't in a claimable
 * state — this IS the idempotency guard: concurrent submit+retry calls race
 * safely, only one wins the UPDATE...WHERE...RETURNING.
 */
async function claimAndDispatch(db: Db, companyId: string, id: string): Promise<boolean> {
  const claimed = await db
    .update(braindumpCaptures)
    .set({ status: "running", dispatchStartedAt: new Date(), failureReason: null, updatedAt: new Date() })
    .where(
      and(
        eq(braindumpCaptures.id, id),
        eq(braindumpCaptures.companyId, companyId),
        sql`${braindumpCaptures.status} IN ('pending', 'failed')`,
      ),
    )
    .returning();
  const row = claimed[0];
  if (!row) return false;

  const librarianAgentId = await resolveLibrarianAgentId(db, companyId);
  if (!librarianAgentId) {
    await db
      .update(braindumpCaptures)
      .set({
        status: "failed",
        failureReason: "The Librarian agent is not provisioned for this company yet.",
        dispatchCompletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(braindumpCaptures.id, id));
    return true;
  }

  const [dept] = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(and(eq(projects.id, row.departmentId), eq(projects.companyId, companyId)))
    .limit(1);

  const runStartedAt = new Date();
  try {
    const result = await runAoaAgent(db, librarianAgentId, {
      companyId,
      source: "braindump.ingest",
      role: "librarian",
      departmentId: row.departmentId,
      departmentName: dept?.name,
      braindumpContent: row.content,
    });

    if (result.status === "succeeded") {
      const proposedMemoryItemIds = await correlateProposedMemoryItems(
        db,
        companyId,
        row.departmentId,
        librarianAgentId,
        runStartedAt,
      );
      await db
        .update(braindumpCaptures)
        .set({
          status: "proposed",
          librarianAgentId,
          runId: result.runId ?? null,
          proposedMemoryItemIds,
          dispatchCompletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(braindumpCaptures.id, id));
    } else {
      await db
        .update(braindumpCaptures)
        .set({
          status: "failed",
          librarianAgentId,
          runId: result.runId ?? null,
          failureReason: result.errorMessage ?? "Librarian run failed",
          dispatchCompletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(braindumpCaptures.id, id));
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err, companyId, braindumpId: id }, "claimAndDispatch: runAoaAgent threw");
    await db
      .update(braindumpCaptures)
      .set({
        status: "failed",
        librarianAgentId,
        failureReason: msg,
        dispatchCompletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(braindumpCaptures.id, id));
  }
  return true;
}

async function deriveEffectiveStatus(db: Db, row: BraindumpCaptureRow): Promise<string> {
  if (row.status !== "proposed" || row.proposedMemoryItemIds.length === 0) {
    return row.status;
  }
  const items = await db
    .select({ status: memoryItems.status })
    .from(memoryItems)
    .where(sql`${memoryItems.id} = ANY(${row.proposedMemoryItemIds})`);
  if (items.length === 0) return row.status;
  const allApproved = items.every((i) => i.status === "approved");
  return allApproved ? "approved" : row.status;
}

async function withEffectiveStatus(
  db: Db,
  row: BraindumpCaptureRow,
): Promise<BraindumpWithEffectiveStatus> {
  const effectiveStatus = await deriveEffectiveStatus(db, row);
  return { ...row, effectiveStatus };
}

export function braindumpService(db: Db) {
  return {
    /**
     * Submit a braindump for a department. Idempotent on
     * (companyId, departmentId, idempotencyKey): a repeat call with the same
     * key returns the existing row (dispatching it exactly once — never
     * double-runs the Librarian, never double-proposes memory).
     */
    async submit(
      companyId: string,
      input: { departmentId: string; content: string; idempotencyKey: string },
      createdByUserId?: string | null,
    ): Promise<BraindumpWithEffectiveStatus> {
      const [dept] = await db
        .select({ id: projects.id, type: projects.type })
        .from(projects)
        .where(and(eq(projects.id, input.departmentId), eq(projects.companyId, companyId)))
        .limit(1);
      if (!dept) {
        throw badRequest("departmentId not found in this company");
      }

      const inserted = await db
        .insert(braindumpCaptures)
        .values({
          companyId,
          departmentId: input.departmentId,
          idempotencyKey: input.idempotencyKey,
          content: input.content,
          contentLength: input.content.length,
          status: "pending",
          createdByUserId: createdByUserId ?? null,
        })
        .onConflictDoNothing()
        .returning();

      let row: BraindumpCaptureRow;
      if (inserted[0]) {
        row = inserted[0];
      } else {
        const [existing] = await db
          .select()
          .from(braindumpCaptures)
          .where(
            and(
              eq(braindumpCaptures.companyId, companyId),
              eq(braindumpCaptures.departmentId, input.departmentId),
              eq(braindumpCaptures.idempotencyKey, input.idempotencyKey),
            ),
          )
          .limit(1);
        if (!existing) {
          throw new Error("braindump capture disappeared after insert conflict");
        }
        row = existing;
      }

      // Best-effort synchronous dispatch attempt. No-ops if another caller
      // already claimed it (or it's already running/proposed/failed).
      await claimAndDispatch(db, companyId, row.id);

      const [latest] = await db
        .select()
        .from(braindumpCaptures)
        .where(eq(braindumpCaptures.id, row.id))
        .limit(1);
      return withEffectiveStatus(db, latest ?? row);
    },

    /** Retry a failed (or stuck-pending) capture. Idempotent via the same
     *  atomic claim as `submit`'s dispatch — a retry racing another retry or
     *  the original submit's dispatch only ever runs once. */
    async retry(companyId: string, id: string): Promise<BraindumpWithEffectiveStatus> {
      const [existing] = await db
        .select()
        .from(braindumpCaptures)
        .where(and(eq(braindumpCaptures.id, id), eq(braindumpCaptures.companyId, companyId)))
        .limit(1);
      if (!existing) {
        throw notFound("Braindump capture not found");
      }

      await claimAndDispatch(db, companyId, id);

      const [latest] = await db
        .select()
        .from(braindumpCaptures)
        .where(eq(braindumpCaptures.id, id))
        .limit(1);
      return withEffectiveStatus(db, latest ?? existing);
    },

    async getById(companyId: string, id: string): Promise<BraindumpWithEffectiveStatus | null> {
      const [row] = await db
        .select()
        .from(braindumpCaptures)
        .where(and(eq(braindumpCaptures.id, id), eq(braindumpCaptures.companyId, companyId)))
        .limit(1);
      if (!row) return null;
      return withEffectiveStatus(db, row);
    },

    async listByDepartment(
      companyId: string,
      departmentId: string,
    ): Promise<BraindumpWithEffectiveStatus[]> {
      const rows = await db
        .select()
        .from(braindumpCaptures)
        .where(
          and(
            eq(braindumpCaptures.companyId, companyId),
            eq(braindumpCaptures.departmentId, departmentId),
          ),
        )
        .orderBy(desc(braindumpCaptures.createdAt));
      return Promise.all(rows.map((r) => withEffectiveStatus(db, r)));
    },
  };
}
