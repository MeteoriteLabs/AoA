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
