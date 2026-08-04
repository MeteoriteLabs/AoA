import type { Db } from "@armyofagents/db";
import { activityLog } from "@armyofagents/db";
import type { ActivityActorType } from "@armyofagents/shared";
import { publishLiveEvent } from "./live-events.js";
import { sanitizeRecord } from "../redaction.js";
import { assertUnreservedActivityNamespace } from "./activity-namespace.js";

export interface LogActivityInput {
  companyId: string;
  actorType: ActivityActorType;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  agentId?: string | null;
  runId?: string | null;
  details?: Record<string, unknown> | null;
}

export interface PersistedActivity extends Omit<LogActivityInput, "details"> {
  details: Record<string, unknown> | null;
}

/** Persist the mandatory audit row without publishing a pre-commit event. */
export async function insertActivityLog(
  db: Db,
  input: LogActivityInput
): Promise<PersistedActivity> {
  assertUnreservedActivityNamespace(input);
  const sanitizedDetails = input.details ? sanitizeRecord(input.details) : null;
  await db.insert(activityLog).values({
    companyId: input.companyId,
    actorType: input.actorType,
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    agentId: input.agentId ?? null,
    runId: input.runId ?? null,
    details: sanitizedDetails,
  });

  return {
    ...input,
    agentId: input.agentId ?? null,
    runId: input.runId ?? null,
    details: sanitizedDetails,
  };
}

/** Publish only after the surrounding database transaction has committed. */
export function publishActivityLogged(input: PersistedActivity): void {
  publishLiveEvent({
    companyId: input.companyId,
    type: "activity.logged",
    payload: {
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      agentId: input.agentId ?? null,
      runId: input.runId ?? null,
      details: input.details,
    },
  });
}

export async function logActivity(db: Db, input: LogActivityInput) {
  const persisted = await insertActivityLog(db, input);
  publishActivityLogged(persisted);
}
