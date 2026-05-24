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
    api.patch<ThreadDetail>(
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
};
