import { api } from "./client";
import type {
  GitHubAppStatus,
  GitHubPrCreateRequest,
  GitHubPrCreateResponse,
  GitHubPrSyncResponse,
  GitHubRepoCollaborator,
  GitHubRepoLabel,
  GitHubRepoMilestone,
  GitHubRepoBranch,
  GitHubPrMergeRequest,
  GitHubPrActionResponse,
} from "@armyofagents/shared";

export const githubIntegrationApi = {
  // ── GitHub App auth ───────────────────────────────────────────────────────
  getAppInstallUrl: (companyId: string) =>
    api.get<{ url: string }>(`/companies/${companyId}/github/app/install-url`),

  appStatus: (companyId: string) =>
    api.get<GitHubAppStatus>(`/companies/${companyId}/github/app/status`),

  disconnectApp: (companyId: string) =>
    api.delete<{ removed: boolean }>(`/companies/${companyId}/github/app`),

  // ── Auth ──────────────────────────────────────────────────────────────────
  setPat: (companyId: string, pat: string) =>
    api.post<{ configured: boolean; githubUser: string }>(
      `/companies/${companyId}/github/pat`,
      { pat },
    ),
  removePat: (companyId: string) =>
    api.delete<{ removed: boolean }>(`/companies/${companyId}/github/pat`),
  status: (companyId: string) =>
    api.get<{ configured: boolean; githubUser?: string; createdAt?: string }>(
      `/companies/${companyId}/github/pat/status`,
    ),

  // ── PR create / sync ──────────────────────────────────────────────────────
  syncWorkspacePR: (workspaceId: string, input?: { force?: boolean }) =>
    api.post<GitHubPrSyncResponse>(
      `/execution-workspaces/${workspaceId}/github-pr/sync`,
      input ?? {},
    ),
  createPR: (issueId: string, input: GitHubPrCreateRequest) =>
    api.post<GitHubPrCreateResponse>(`/issues/${issueId}/github-pr`, input),

  // ── Repo metadata (feed CreatePrDialog selects) ───────────────────────────
  getCollaborators: (workspaceId: string) =>
    api.get<GitHubRepoCollaborator[]>(
      `/execution-workspaces/${workspaceId}/github/collaborators`,
    ),
  getLabels: (workspaceId: string) =>
    api.get<GitHubRepoLabel[]>(
      `/execution-workspaces/${workspaceId}/github/labels`,
    ),
  getMilestones: (workspaceId: string) =>
    api.get<GitHubRepoMilestone[]>(
      `/execution-workspaces/${workspaceId}/github/milestones`,
    ),
  getBranches: (workspaceId: string) =>
    api.get<GitHubRepoBranch[]>(
      `/execution-workspaces/${workspaceId}/github/branches`,
    ),

  // ── PR actions ────────────────────────────────────────────────────────────
  mergePr: (workspaceId: string, input: GitHubPrMergeRequest) =>
    api.post<GitHubPrActionResponse>(
      `/execution-workspaces/${workspaceId}/github-pr/merge`,
      input,
    ),
  closePr: (workspaceId: string) =>
    api.post<GitHubPrActionResponse>(
      `/execution-workspaces/${workspaceId}/github-pr/close`,
      {},
    ),
  reopenPr: (workspaceId: string) =>
    api.post<GitHubPrActionResponse>(
      `/execution-workspaces/${workspaceId}/github-pr/reopen`,
      {},
    ),
  requestReview: (workspaceId: string, reviewers: string[]) =>
    api.post<{ success: boolean }>(
      `/execution-workspaces/${workspaceId}/github-pr/request-review`,
      { reviewers },
    ),
};
