import { Octokit } from "@octokit/rest";
import type { Db } from "@armyofagents/db";
import {
  GITHUB_PAT_SECRET_NAME,
  type GitHubPrCreateResponse,
  type GitHubPrMetadata,
} from "@armyofagents/shared";
import { secretService } from "./secrets.js";

/**
 * Error thrown by the GitHub PR service when we want to surface a specific
 * HTTP-ish status to the route handler. The route maps this straight into
 * `res.status(err.status).json({ error, hint })`.
 */
export class GitHubPrError extends Error {
  public readonly status: number;
  public readonly scopeHint?: string;

  constructor(message: string, status: number, scopeHint?: string) {
    super(message);
    this.name = "GitHubPrError";
    this.status = status;
    this.scopeHint = scopeHint;
  }
}

/**
 * Parse an `owner` + `repo` pair out of a GitHub repo URL. Supports both HTTPS
 * and SSH forms, with or without a trailing `.git` and/or trailing slash.
 */
export function parseGitHubRepoUrl(repoUrl: string): { owner: string; repo: string } {
  const match = repoUrl.match(/github\.com[:/]([^/]+)\/([^/.\s]+?)(?:\.git)?\/?$/);
  if (!match) {
    throw new GitHubPrError(`Invalid GitHub repo URL: ${repoUrl}`, 400);
  }
  return { owner: match[1]!, repo: match[2]! };
}

async function resolveGitHubPat(
  db: Db,
  companyId: string,
  consumerId: string,
): Promise<string> {
  const svc = secretService(db);
  const secretRow = await svc.getByName(companyId, GITHUB_PAT_SECRET_NAME);
  if (!secretRow) {
    throw new GitHubPrError(
      "GitHub PAT not configured",
      412,
      "Go to Settings -> Integrations -> GitHub and connect a personal access token",
    );
  }

  let pat: string;
  try {
    pat = await svc.resolveSecretValue(companyId, secretRow.id, "latest", {
      consumerType: "system",
      consumerId,
      configPath: "github.pat",
      actorType: "system",
    });
  } catch {
    throw new GitHubPrError("GitHub PAT could not be decrypted", 500);
  }
  if (!pat) {
    throw new GitHubPrError("GitHub PAT could not be decrypted", 500);
  }
  return pat;
}

function mapGitHubApiError(err: unknown, owner: string, repo: string): never {
  if (err instanceof GitHubPrError) throw err;
  const status = (err as { status?: number }).status ?? 500;
  if (status === 401) {
    throw new GitHubPrError(
      "GitHub PAT is invalid or expired. Reconnect in Settings -> Integrations.",
      401,
      "Disconnect + reconnect GitHub in Settings -> Integrations",
    );
  }
  if (status === 403) {
    throw new GitHubPrError(
      "PAT lacks required permissions. Reconnect with 'repo' + 'pull_requests: write' scopes.",
      403,
      "Disconnect + reconnect GitHub in Settings -> Integrations with a PAT that has repo + pull_requests:write scope",
    );
  }
  if (status === 404) {
    throw new GitHubPrError(`Repository not found: ${owner}/${repo}`, 404);
  }
  if (status === 422) {
    const msg =
      (err as { response?: { data?: { message?: string } } }).response?.data?.message ??
      "PR creation failed";
    throw new GitHubPrError(msg, 422);
  }
  throw new GitHubPrError("GitHub API error", status);
}

export async function findPullRequestForBranch(
  db: Db,
  args: {
    companyId: string;
    repoUrl: string;
    branchName: string;
  },
): Promise<{ pr: GitHubPrMetadata | null; baseRef: string | null }> {
  const pat = await resolveGitHubPat(db, args.companyId, "github-pr-sync");
  const { owner, repo } = parseGitHubRepoUrl(args.repoUrl);
  const octokit = new Octokit({ auth: pat });

  try {
    const { data } = await octokit.pulls.list({
      owner,
      repo,
      state: "all",
      head: `${owner}:${args.branchName}`,
      per_page: 10,
      sort: "updated",
      direction: "desc",
    });
    const match = data.find((item) => item.head?.ref === args.branchName) ?? null;
    if (!match) {
      return { pr: null, baseRef: null };
    }

    return {
      pr: {
        url: match.html_url,
        number: match.number,
        state: match.merged_at ? "merged" : match.state === "closed" ? "closed" : "open",
        createdAt: new Date().toISOString(),
        draft: match.draft ?? false,
      },
      baseRef: match.base?.ref ?? null,
    };
  } catch (err) {
    mapGitHubApiError(err, owner, repo);
  }
}

/**
 * Create a pull request on GitHub using the company's stored PAT.
 *
 * Throws `GitHubPrError` with a surfaced HTTP status on:
 * - 412 no PAT configured
 * - 401 invalid / expired PAT
 * - 403 PAT lacks required scope
 * - 404 repo not found
 * - 422 PR creation validation failure (surfaces Octokit's message)
 *
 * The happy-path response always reports `state` as `"open"` for newly-created
 * PRs. `"closed"` is included defensively only if GitHub ever returns it.
 */
export async function createPullRequest(
  db: Db,
  args: {
    companyId: string;
    repoUrl: string;
    base: string;
    head: string;
    title: string;
    body: string;
    draft: boolean;
  },
): Promise<GitHubPrCreateResponse> {
  const pat = await resolveGitHubPat(db, args.companyId, "github-pr");
  const { owner, repo } = parseGitHubRepoUrl(args.repoUrl);
  const octokit = new Octokit({ auth: pat });

  try {
    const { data } = await octokit.pulls.create({
      owner,
      repo,
      base: args.base,
      head: args.head,
      title: args.title,
      body: args.body,
      draft: args.draft,
    });
    return {
      url: data.html_url,
      number: data.number,
      state: data.state === "closed" ? "closed" : "open",
      draft: data.draft ?? false,
    };
  } catch (err: unknown) {
    mapGitHubApiError(err, owner, repo);
  }
}
