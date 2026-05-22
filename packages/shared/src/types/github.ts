/**
 * Types for GitHub integration — Create Pull Request flow (Task 12 / Bundle F.1 pt2).
 *
 * The server uses the company's stored GitHub PAT (persisted via Task 11's
 * Settings → Integrations → GitHub card) to call Octokit `pulls.create`. The
 * returned PR URL is persisted into the linked execution workspace's
 * `metadata.pr` so the GitPanel can render a link back to it for future
 * reference.
 */

export interface GitHubPrCreateRequest {
  workspaceId: string;
  title: string;
  body: string;
  base: string;
  draft?: boolean;
  /**
   * Explicit head branch override. Used when `workspace.branchName` is null
   * (e.g. `local_fs` shared workspaces where the branch is detected at
   * runtime from git rather than stored in the DB).
   */
  head?: string;
  reviewers?: string[];         // GitHub logins
  labels?: string[];            // label names
  milestoneNumber?: number;     // milestone number (not id)
}

export interface GitHubPrCreateResponse {
  url: string;
  number: number;
  state: "open" | "closed";
  draft: boolean;
}

export interface GitHubPrMetadata {
  url: string;
  number: number;
  state: "open" | "closed" | "merged";
  createdAt: string;
  draft: boolean;
}

export interface GitHubPrSyncMetadata {
  pr: GitHubPrMetadata | null;
  githubLastSyncedAt: string;
  githubSyncError?: string | null;
  noPrFound?: boolean;
}

export interface GitHubPrSyncResponse {
  workspaceId: string;
  repoUrl: string;
  branchName: string;
  baseRef: string | null;
  pr: GitHubPrMetadata | null;
  githubLastSyncedAt: string;
  githubSyncError: string | null;
  cached: boolean;
}

// ---------------------------------------------------------------------------
// Repo metadata — used to populate CreatePrDialog selects
// ---------------------------------------------------------------------------

export interface GitHubRepoCollaborator {
  login: string;
  avatarUrl: string;
}

export interface GitHubRepoLabel {
  id: number;
  name: string;
  color: string; // 6-char hex without '#'
}

export interface GitHubRepoMilestone {
  number: number;
  title: string;
  openIssues: number;
  dueOn: string | null; // ISO date or null
}

// ---------------------------------------------------------------------------
// PR actions
// ---------------------------------------------------------------------------

export type GitHubPrMergeMethod = "merge" | "squash" | "rebase";

export interface GitHubPrMergeRequest {
  mergeMethod: GitHubPrMergeMethod;
}

export interface GitHubPrActionResponse {
  success: boolean;
  prState: "open" | "closed" | "merged";
  prUrl: string;
}
