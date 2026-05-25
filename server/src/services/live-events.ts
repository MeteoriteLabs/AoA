import { EventEmitter } from "node:events";
import type { LiveEvent, LiveEventType } from "@armyofagents/shared";

// Threads v1 Plan 7: the thread.* event types
//   thread.entry.created | thread.scope.changed | thread.phase.changed
//   thread.summary.updated | thread.participant.changed | thread.link.created
//   thread.presence
// are members of LiveEventType (see packages/shared/src/constants.ts
// LIVE_EVENT_TYPES). Each carries a `threadId` in its payload so the
// envelope-RBAC fan-out (filterThreadEventRecipients, below) can scope delivery.

type LiveEventPayload = Record<string, unknown>;
type LiveEventListener = (event: LiveEvent) => void;

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

let nextEventId = 0;

function toLiveEvent(input: {
  companyId: string;
  type: LiveEventType;
  payload?: LiveEventPayload;
}): LiveEvent {
  nextEventId += 1;
  return {
    id: nextEventId,
    companyId: input.companyId,
    type: input.type,
    createdAt: new Date().toISOString(),
    payload: input.payload ?? {},
  };
}

export function publishLiveEvent(input: {
  companyId: string;
  type: LiveEventType;
  payload?: LiveEventPayload;
}) {
  const event = toLiveEvent(input);
  emitter.emit(input.companyId, event);
  return event;
}

export function subscribeCompanyLiveEvents(companyId: string, listener: LiveEventListener) {
  emitter.on(companyId, listener);
  return () => emitter.off(companyId, listener);
}
