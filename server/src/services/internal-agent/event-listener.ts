// server/src/services/internal-agent/event-listener.ts
// Event-driven triggers for the internal agent — T12
import type { Db } from "@paperclipai/db";
import type { LiveEvent } from "@paperclipai/shared";
import { internalAgentRuns } from "@paperclipai/db";
import { subscribeCompanyLiveEvents } from "../live-events.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface EventTriggerResult {
  eventType: string;
  triggerSource: string;
  payload: Record<string, unknown>;
}

interface EventListenerOptions {
  onTrigger?: (result: EventTriggerResult) => void;
  debounceMs?: number;
}

interface EventListenerHandle {
  unsubscribe: () => void;
}

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_DEBOUNCE_MS = 30_000; // 30 seconds

// ── Event type → trigger mapping ─────────────────────────────────────────────

function mapEventToTrigger(
  event: LiveEvent,
): EventTriggerResult | null {
  const type = event.type as string;
  const payload = (event.payload ?? {}) as Record<string, unknown>;

  switch (type) {
    case "heartbeat.run.status": {
      const status = payload.status as string | undefined;
      // Only trigger on terminal statuses
      if (status === "completed" || status === "failed" || status === "error") {
        return {
          eventType: type,
          triggerSource: "heartbeat_terminal",
          payload,
        };
      }
      return null;
    }

    case "activity.logged": {
      const action = payload.action as string | undefined;
      if (action?.startsWith("issue.") || action?.startsWith("task.")) {
        return {
          eventType: type,
          triggerSource: "task_status_change",
          payload,
        };
      }
      return null;
    }

    case "discussion.entry.created":
      return {
        eventType: type,
        triggerSource: "discussion_entry",
        payload,
      };

    default:
      return null;
  }
}

// ── Debounce key generation ──────────────────────────────────────────────────

function debounceKey(event: LiveEvent): string {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  // Include entity-level specificity so different entities of the same event type
  // can trigger independently (e.g., two different tasks completing within 30s)
  const entityId = (payload.entityId ?? payload.runId ?? payload.entryId ?? "") as string;
  return `${event.type}:${entityId}`;
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createEventListener(
  db: Db,
  companyId: string,
  options: EventListenerOptions = {},
): EventListenerHandle {
  const { onTrigger, debounceMs = DEFAULT_DEBOUNCE_MS } = options;
  const lastFired = new Map<string, number>();

  function handleEvent(event: LiveEvent) {
    const trigger = mapEventToTrigger(event);
    if (!trigger) return;

    // Debounce: skip if same event type fired within window
    const key = debounceKey(event);
    const now = Date.now();
    const lastTime = lastFired.get(key);

    if (lastTime != null && now - lastTime < debounceMs) {
      return; // Debounced — skip
    }

    lastFired.set(key, now);

    // Create run record (fire-and-forget — don't block event processing)
    db.insert(internalAgentRuns)
      .values({
        companyId,
        triggerType: "event",
        triggerSource: trigger.triggerSource,
        status: "completed",
        summary: `Event trigger: ${trigger.eventType}`,
        completedAt: new Date(),
      })
      .returning()
      .catch(() => {
        // Swallow — run logging is best-effort
      });

    // Notify callback
    onTrigger?.(trigger);

    // Trigger extraction for new discussion entries (fire-and-forget)
    if (trigger.triggerSource === "discussion_entry") {
      const eventPayload = (event.payload ?? {}) as Record<string, unknown>;
      const entryId = (eventPayload.entryId ?? "") as string;
      if (entryId) {
        import("../extraction.js")
          .then(({ extractionService }) => {
            extractionService(db)
              .extractFromDiscussionEntry(companyId, entryId)
              .catch(() => {}); // errors handled internally
          })
          .catch(() => {}); // module load error — swallow
      }
    }
  }

  const unsubscribe = subscribeCompanyLiveEvents(companyId, handleEvent);

  return { unsubscribe };
}
