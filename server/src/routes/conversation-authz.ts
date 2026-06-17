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
 * distinguish "exists" from "forbidden". Founder-equivalents bypass the userId
 * scope ONLY via an interactive board session (local_implicit / instance admin /
 * founder role on a type:"board" actor); MCP and agent tokens are always
 * owner-scoped (see only their own userId's conversations), even when the token
 * was created by a founder. Throws 404 on mismatch.
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
  const isBoard = req.actor.type === "board";
  const isLocalImplicit = isBoard && req.actor.source === "local_implicit";
  // NB: isInstanceAdmin is only ever set on type:"board" actors (auth.ts —
  // loopback/session/board_key); MCP/agent tokens never carry it, so the
  // board gate below cannot silently demote an instance admin. If the actor
  // shape changes, re-examine this gate.
  const isInstanceAdmin = isBoard && req.actor.isInstanceAdmin === true;

  let isFounderRole: boolean;
  if (isLocalImplicit || isInstanceAdmin) {
    isFounderRole = true;
  } else if (isBoard) {
    const role = await permissionService(db).getEffectiveRole(companyId, actor.actorId);
    isFounderRole = role === "founder";
  } else {
    // MCP / agent tokens are NEVER founder-equivalent for conversation
    // ownership — a founder-created MCP key replays the founder's userId
    // (auth.ts → getActorInfo), which would otherwise resolve to "founder"
    // and grant read-anyone. Owner-scope them instead (they see only their
    // own userId's conversations), limiting bearer-token blast radius.
    // Interactive founder read-anyone access is via board sessions only.
    isFounderRole = false;
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
