import { EventEmitter } from "node:events";
import type { LiveEvent, LiveEventType } from "@armyofagents/shared";
import { canViewThread, type ThreadViewer } from "./threads.js";

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

// ── Threads v1 Plan 7: per-thread scoping + envelope-RBAC fan-out ─────────────

/**
 * Pure envelope-RBAC filter. Reuses the Plan 2 canViewThread predicate so a
 * subscriber only survives if they could actually view the thread the event is
 * about. A non-participant never receives even a poke about a private/Unclaimed
 * thread.
 *
 * Subscribers must carry their own RBAC inputs ({ role, hasScopeAccess,
 * isParticipant }). See the CRITICAL AMENDMENT in registerThreadSubscriber:
 * these inputs are recomputed per event at fan-out, never cached.
 */
export function filterThreadEventRecipients<T extends ThreadViewer>(
  thread: { ownerUserId: string | null; visibility: "open" | "private" },
  subscribers: T[],
): T[] {
  return subscribers.filter((s) => canViewThread(thread, s));
}

/**
 * Per-thread subscription registry: Map<threadId, Set<connection>>.
 *
 * The WS handler (server/src/realtime/live-events-ws.ts) owns the actual socket
 * connections and registers/unregisters a connection token here when it receives
 * a `{ subscribe: threadId }` / `{ unsubscribe: threadId }` client message. On a
 * thread.* event, the handler looks up the subscriber set, recomputes each
 * connection's { role, hasScopeAccess, isParticipant } against the live thread
 * row (NOT a cache), runs filterThreadEventRecipients, and sends only to the
 * survivors.
 *
 * Generic over the connection token type so the registry is decoupled from `ws`
 * and unit-testable.
 */
export class ThreadSubscriptionRegistry<Conn> {
  private byThread = new Map<string, Set<Conn>>();
  private byConn = new Map<Conn, Set<string>>();

  /** Subscribe a connection to a thread's events. Idempotent. */
  subscribe(threadId: string, conn: Conn): void {
    let conns = this.byThread.get(threadId);
    if (!conns) {
      conns = new Set();
      this.byThread.set(threadId, conns);
    }
    conns.add(conn);

    let threads = this.byConn.get(conn);
    if (!threads) {
      threads = new Set();
      this.byConn.set(conn, threads);
    }
    threads.add(threadId);
  }

  /** Unsubscribe a connection from a single thread. */
  unsubscribe(threadId: string, conn: Conn): void {
    const conns = this.byThread.get(threadId);
    if (conns) {
      conns.delete(conn);
      if (conns.size === 0) this.byThread.delete(threadId);
    }
    const threads = this.byConn.get(conn);
    if (threads) {
      threads.delete(threadId);
      if (threads.size === 0) this.byConn.delete(conn);
    }
  }

  /** Remove a connection from every thread it was subscribed to (on close). */
  removeConnection(conn: Conn): void {
    const threads = this.byConn.get(conn);
    if (!threads) return;
    for (const threadId of threads) {
      const conns = this.byThread.get(threadId);
      if (conns) {
        conns.delete(conn);
        if (conns.size === 0) this.byThread.delete(threadId);
      }
    }
    this.byConn.delete(conn);
  }

  /** All connections currently subscribed to a thread (empty array if none). */
  subscribers(threadId: string): Conn[] {
    const conns = this.byThread.get(threadId);
    return conns ? Array.from(conns) : [];
  }

  /** Whether a connection is subscribed to a given thread. */
  isSubscribed(threadId: string, conn: Conn): boolean {
    return this.byThread.get(threadId)?.has(conn) ?? false;
  }
}

/** A live event that targets a specific thread (its payload carries threadId). */
export function threadIdOf(event: LiveEvent): string | null {
  const tid = event.payload?.threadId;
  return typeof tid === "string" && tid.length > 0 ? tid : null;
}

const THREAD_EVENT_PREFIX = "thread.";

/** Whether a live event is a per-thread event that needs envelope-RBAC fan-out. */
export function isThreadEvent(event: LiveEvent): boolean {
  return event.type.startsWith(THREAD_EVENT_PREFIX);
}

// ── Threads v1 Plan 7: ephemeral presence + typing ───────────────────────────

/** Default presence TTL — a member is "here" for this long after their last heartbeat. */
export const PRESENCE_TTL_MS = 15_000;

export interface PresenceEntry {
  userId: string;
  lastSeen: number;
  typing?: boolean;
}

/**
 * Pure presence prune: keep only entries seen within ttlMs of `now`. Entries
 * exactly at the boundary are kept. The typing flag rides along untouched.
 */
export function prunePresence(
  entries: PresenceEntry[],
  now: number,
  ttlMs: number,
): PresenceEntry[] {
  return entries.filter((e) => now - e.lastSeen <= ttlMs);
}

/**
 * Ephemeral, in-memory per-thread presence roster. NOT persisted (no DB) — it
 * evaporates on restart, which is correct for "who's looking right now".
 * Keyed by threadId. Updated on a client presence/typing heartbeat and swept by
 * prunePresence. Broadcast goes through the same envelope-RBAC fan-out as other
 * thread.* events (the WS handler owns that), so a viewer never sees presence
 * for a thread they can't see.
 */
export class ThreadPresenceStore {
  private byThread = new Map<string, Map<string, PresenceEntry>>();

  /** Record/refresh a member's presence (and optional typing state) on a thread. */
  touch(threadId: string, userId: string, now: number, typing = false): void {
    let members = this.byThread.get(threadId);
    if (!members) {
      members = new Map();
      this.byThread.set(threadId, members);
    }
    members.set(userId, { userId, lastSeen: now, typing });
  }

  /** Current (unpruned) roster for a thread. */
  list(threadId: string): PresenceEntry[] {
    const members = this.byThread.get(threadId);
    return members ? Array.from(members.values()) : [];
  }

  /**
   * Sweep one thread's roster against the TTL, dropping stale members.
   * Returns the surviving roster (also reflected in the store).
   */
  sweep(threadId: string, now: number, ttlMs = PRESENCE_TTL_MS): PresenceEntry[] {
    const members = this.byThread.get(threadId);
    if (!members) return [];
    const survivors = prunePresence(Array.from(members.values()), now, ttlMs);
    if (survivors.length === 0) {
      this.byThread.delete(threadId);
      return [];
    }
    const next = new Map<string, PresenceEntry>();
    for (const s of survivors) next.set(s.userId, s);
    this.byThread.set(threadId, next);
    return survivors;
  }

  /** All thread ids that currently have any presence (for the sweep interval). */
  threadIds(): string[] {
    return Array.from(this.byThread.keys());
  }

  /** Drop a member from a thread (e.g. on disconnect). Returns survivors. */
  remove(threadId: string, userId: string): PresenceEntry[] {
    const members = this.byThread.get(threadId);
    if (!members) return [];
    members.delete(userId);
    if (members.size === 0) {
      this.byThread.delete(threadId);
      return [];
    }
    return Array.from(members.values());
  }
}

/** Process-wide ephemeral presence store shared by the WS handler. */
export const threadPresence = new ThreadPresenceStore();
