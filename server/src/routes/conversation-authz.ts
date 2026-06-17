// server/src/routes/conversation-authz.ts
import type { Request } from "express";
import { and, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { internalAgentConversations } from "@armyofagents/db";
import { permissionService } from "../services/permissions.js";
import { getActorInfo } from "./authz.js";
import { notFound } from "../errors.js";

/**
 * Resolve a Commander conversation the actor is allowed to read, enforcing
 * ownership in the WHERE clause (not a separate 403) so non-owners can't
 * distinguish "exists" from "forbidden". Founder-equivalents (local_implicit
 * board, instance admin, founder role) bypass the userId scope; everyone else
 * is scoped to their own userId. Throws 404 on mismatch.
 *
 * Single-sourced authz: shared by internal-agent.ts (archive/pin/rename/delete/
 * messages) and memory-retrievals.ts (the conversation retrieval-audit endpoint).
 */
export async function loadOwnedConversation(
  db: Db,
  req: Request,
  companyId: string,
  convId: string,
) {
  const actor = getActorInfo(req);
  const isLocalImplicit =
    req.actor.type === "board" && req.actor.source === "local_implicit";
  const isInstanceAdmin =
    req.actor.type === "board" && req.actor.isInstanceAdmin === true;

  let isFounderRole: boolean;
  if (isLocalImplicit || isInstanceAdmin) {
    isFounderRole = true;
  } else {
    const role = await permissionService(db).getEffectiveRole(companyId, actor.actorId);
    isFounderRole = role === "founder";
  }

  const convConditions = [
    eq(internalAgentConversations.id, convId),
    eq(internalAgentConversations.companyId, companyId),
  ];
  if (!isFounderRole) {
    convConditions.push(eq(internalAgentConversations.userId, actor.actorId));
  }

  const [existing] = await db
    .select()
    .from(internalAgentConversations)
    .where(and(...convConditions));

  if (!existing) throw notFound("Conversation not found");
  return existing;
}
