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

export interface PreparedActivityEvent {
  companyId: string;
  payload: {
    actorType: ActivityActorType;
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    agentId: string | null;
    runId: string | null;
    details: Record<string, unknown> | null;
  };
}

/** Persist an activity row without publishing. Use this inside larger transactions. */
export async function insertActivity(db: Db, input: LogActivityInput): Promise<PreparedActivityEvent> {
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
    companyId: input.companyId,
    payload: {
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      agentId: input.agentId ?? null,
      runId: input.runId ?? null,
      details: sanitizedDetails,
    },
  };
}

/** Publish only after the transaction containing insertActivity has committed. */
export function publishActivity(event: PreparedActivityEvent) {
  publishLiveEvent({
    companyId: event.companyId,
    type: "activity.logged",
    payload: event.payload,
  });
}

export async function logActivity(db: Db, input: LogActivityInput) {
  publishActivity(await insertActivity(db, input));
}
