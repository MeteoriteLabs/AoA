import { api } from "./client";
import {
  discussionsApi,
  type DiscussionListItem,
  type DiscussionDetail,
  type DiscussionListFilters,
  type DiscussionListResponse,
} from "./discussions";

// threads.ts extends the discussions API — threads ARE discussions with extra fields

export interface ThreadFields {
  phase: "discuss" | "scope" | "assign" | "done";
  visibility: "open" | "private";
  ownerUserId: string | null;
  originSource: string | null;
  intent: string[] | null;
  goalId: string | null;
  autonomyLevel: number | null;
  summaryText: string | null;
  summaryNext: string | null;
}

export type ThreadListItem = DiscussionListItem & ThreadFields;
export type ThreadDetail = DiscussionDetail & ThreadFields;

export interface ThreadListResponse
  extends Omit<DiscussionListResponse, "discussions"> {
  discussions: ThreadListItem[];
}

export const threadsApi = {
  list: (companyId: string, filters?: { phase?: string } & DiscussionListFilters) =>
    discussionsApi.list(companyId, filters ?? {}) as Promise<DiscussionListResponse & { discussions: ThreadListItem[] }>,

  detail: (companyId: string, id: string) =>
    discussionsApi.get(companyId, id) as Promise<ThreadDetail>,

  advancePhase: (companyId: string, id: string, phase: string) =>
    api.patch<ThreadDetail>(
      `/companies/${companyId}/discussions/${id}/phase`,
      { phase },
    ),

  claim: (companyId: string, id: string) =>
    api.post<ThreadDetail>(
      `/companies/${companyId}/discussions/${id}/claim`,
      {},
    ),

  transfer: (companyId: string, id: string, toUserId: string) =>
    api.post<ThreadDetail>(
      `/companies/${companyId}/discussions/${id}/transfer`,
      { toUserId },
    ),

  addParticipant: (companyId: string, id: string, userId: string) =>
    api.post<ThreadDetail>(
      `/companies/${companyId}/discussions/${id}/participants`,
      { userId },
    ),

  promoteToGoal: (companyId: string, id: string, goalData: Record<string, unknown>) =>
    api.post<{ threadId: string; goalId: string }>(
      `/companies/${companyId}/discussions/${id}/promote-to-goal`,
      goalData,
    ),

  setVisibility: (companyId: string, id: string, visibility: "open" | "private") =>
    api.patch<ThreadDetail>(
      `/companies/${companyId}/discussions/${id}`,
      { visibility },
    ),

  createLink: (companyId: string, fromId: string, toThreadId: string, kind: string) =>
    api.post<{ id: string; fromThreadId: string; toThreadId: string; kind: string }>(
      `/companies/${companyId}/discussions/${fromId}/links`,
      { toThreadId, kind },
    ),

  listLinks: (companyId: string, id: string) =>
    api.get<{ links: Array<{ id: string; fromThreadId: string; toThreadId: string; kind: string }> }>(
      `/companies/${companyId}/discussions/${id}/links`,
    ),

  spinOff: (companyId: string, id: string, scopeItemId: string, title?: string) =>
    api.post<{ id: string; forkedFromId: string; title: string | null }>(
      `/companies/${companyId}/discussions/${id}/spin-off`,
      { scopeItemId, title },
    ),

  routeItem: (
    companyId: string,
    discussionId: string,
    itemId: string,
    routing: { departmentId?: string; assigneeAgentId?: string; assigneeUserId?: string },
  ) =>
    api.patch<{ itemId: string }>(
      `/companies/${companyId}/discussions/${discussionId}/items/${itemId}/routing`,
      routing,
    ),
};
