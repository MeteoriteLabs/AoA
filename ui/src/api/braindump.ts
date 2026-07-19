// ui/src/api/braindump.ts — WS6 client for the braindump ingestion API
// (server/src/routes/braindump.ts). See server/src/services/braindump.ts for
// the full status-machine + idempotency contract this client relies on.
import { api } from "./client";

/** Stored status. "approved" is NEVER stored — see `effectiveStatus` below. */
export type BraindumpStatus = "pending" | "running" | "proposed" | "failed";

/** `effectiveStatus` is "approved" when status="proposed", at least one item
 *  was proposed, and every linked memory item has since been approved via
 *  the founder approval route. Otherwise it mirrors `status`. */
export type BraindumpEffectiveStatus = BraindumpStatus | "approved";

export interface BraindumpCapture {
  id: string;
  companyId: string;
  departmentId: string;
  idempotencyKey: string;
  content: string;
  contentLength: number;
  status: BraindumpStatus;
  effectiveStatus: BraindumpEffectiveStatus;
  librarianAgentId: string | null;
  runId: string | null;
  proposedMemoryItemIds: string[];
  failureReason: string | null;
  dispatchStartedAt: string | null;
  dispatchCompletedAt: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubmitBraindumpInput {
  departmentId: string;
  content: string;
  idempotencyKey: string;
}

export const braindumpApi = {
  /** Submit (or idempotently resubmit, if `idempotencyKey` repeats) a
   *  braindump for a department. The Librarian dispatch is attempted
   *  synchronously best-effort — the response may already be "proposed" or
   *  "failed", not just "pending"/"running". */
  submit: (companyId: string, input: SubmitBraindumpInput) =>
    api.post<BraindumpCapture>(`/companies/${companyId}/braindumps`, input),

  /** `departmentId` is required server-side (400 without it). */
  listByDepartment: (companyId: string, departmentId: string) =>
    api.get<BraindumpCapture[]>(
      `/companies/${companyId}/braindumps?departmentId=${encodeURIComponent(departmentId)}`,
    ),

  get: (companyId: string, id: string) =>
    api.get<BraindumpCapture>(`/companies/${companyId}/braindumps/${encodeURIComponent(id)}`),

  /** Retry a failed (or stuck-pending) capture. Idempotent. */
  retry: (companyId: string, id: string) =>
    api.post<BraindumpCapture>(`/companies/${companyId}/braindumps/${encodeURIComponent(id)}/retry`, {}),
};

const fallbackSessionIds = new Map<string, string>();

/**
 * Stable per (companyId, browser-tab-session) id, persisted in
 * `sessionStorage` so it survives a component remount (e.g. navigating away
 * from and back to the In-flight Braindump surface within the same
 * onboarding session) without minting a new id on every render. Falls back
 * to an in-memory id (still stable for the lifetime of the page) when
 * `sessionStorage` is unavailable (privacy mode, non-browser test runner).
 */
export function getBraindumpSessionId(companyId: string): string {
  const storageKey = `aoa:braindump-session:${companyId}`;
  try {
    const existing = sessionStorage.getItem(storageKey);
    if (existing) return existing;
    const next = crypto.randomUUID();
    sessionStorage.setItem(storageKey, next);
    return next;
  } catch {
    let id = fallbackSessionIds.get(companyId);
    if (!id) {
      id = crypto.randomUUID();
      fallbackSessionIds.set(companyId, id);
    }
    return id;
  }
}

/**
 * Idempotency key for a department's braindump within the current
 * onboarding session. Stable across resubmits of the SAME (department,
 * session) pair — a double-click on Submit, or a re-render triggered by an
 * unrelated state change, reuses the same `braindump_captures` row instead
 * of creating a duplicate capture / double-dispatching the Librarian
 * (server-side uniqueness is on (companyId, departmentId, idempotencyKey),
 * so the key only needs to be unique per session, not globally).
 */
export function braindumpIdempotencyKey(companyId: string, departmentId: string): string {
  return `${departmentId}:${getBraindumpSessionId(companyId)}`;
}
