import type {
  GitHubPrCreateRequest,
  GitHubPrCreateResponse,
} from "@armyofagents/shared";
import { api } from "./client";

export interface GitHubPatStatus {
  configured: boolean;
  githubUser?: string | null;
  createdAt?: string;
}

export interface SetPatResponse {
  configured: true;
  githubUser: string;
}

export interface RemovePatResponse {
  configured: false;
  removed: boolean;
}

export const githubIntegrationApi = {
  setPat: (companyId: string, pat: string) =>
    api.post<SetPatResponse>(`/companies/${companyId}/github/pat`, { pat }),
  removePat: (companyId: string) =>
    api.delete<RemovePatResponse>(`/companies/${companyId}/github/pat`),
  status: (companyId: string) =>
    api.get<GitHubPatStatus>(`/companies/${companyId}/github/pat/status`),
  createPR: (issueId: string, input: GitHubPrCreateRequest) =>
    api.post<GitHubPrCreateResponse>(`/issues/${issueId}/github-pr`, input),
};
