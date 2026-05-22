import { createAppAuth } from "@octokit/auth-app";
import { eq } from "drizzle-orm";
import { githubInstallations, type Db, type GitHubInstallation, type NewGitHubInstallation } from "@armyofagents/db";

// ---------------------------------------------------------------------------
// Install URL
// ---------------------------------------------------------------------------

/**
 * Returns the GitHub URL where users click to install the GitHub App on their
 * org or personal account.
 *
 * Uses the App installation page URL — NOT the OAuth authorize URL. After the
 * user clicks Install, GitHub calls the App's configured Setup URL with:
 *   ?installation_id=X&setup_action=install&state=<companyId>
 *
 * `state` is the AoA company ID so the callback knows which company to link.
 *
 * Requires GITHUB_APP_SLUG env var (visible in App settings:
 *   https://github.com/settings/apps/{slug}).
 *
 * For localhost: GitHub allows http://localhost as a redirect in App settings —
 * no tunnelling required for development.
 */
export function getInstallUrl(state: string): string {
  const slug = process.env.GITHUB_APP_SLUG;
  if (!slug) {
    throw new Error("GITHUB_APP_SLUG must be set to generate a GitHub App install URL");
  }
  return `https://github.com/apps/${slug}/installations/new?state=${encodeURIComponent(state)}`;
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

export async function getInstallation(
  db: Db,
  companyId: string,
): Promise<GitHubInstallation | null> {
  const rows = await db
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.companyId, companyId))
    .limit(1);

  const row = rows[0] ?? null;
  if (!row) return null;
  // Suspended installations are treated as absent
  if (row.suspendedAt != null) return null;
  return row;
}

export async function saveInstallation(
  db: Db,
  args: {
    companyId: string;
    installationId: string;
    accountLogin: string;
    accountType: string;
    githubHost?: string;
  },
): Promise<GitHubInstallation> {
  const values: NewGitHubInstallation = {
    companyId: args.companyId,
    installationId: args.installationId,
    accountLogin: args.accountLogin,
    accountType: args.accountType,
    githubHost: args.githubHost ?? "github.com",
    updatedAt: new Date(),
  };

  // Upsert: delete existing row first (uniqueness is on company_id), then insert.
  await db.delete(githubInstallations).where(eq(githubInstallations.companyId, args.companyId));
  const [row] = await db.insert(githubInstallations).values(values).returning();
  if (!row) throw new Error("Insert failed: no row returned from github_installations");
  return row;
}

export async function removeInstallation(db: Db, companyId: string): Promise<void> {
  await db.delete(githubInstallations).where(eq(githubInstallations.companyId, companyId));
}

// ---------------------------------------------------------------------------
// Token minting
// ---------------------------------------------------------------------------

/**
 * Mint a short-lived installation access token (~1h) for the given
 * installation ID. Tokens are NOT cached — callers should cache or
 * refresh as needed (Octokit's createAppAuth handles expiry automatically
 * when called per-request).
 */
export async function mintInstallationToken(installationId: string): Promise<string> {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY_PEM;

  if (!appId || !privateKey) {
    throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY_PEM must be set to use GitHub App auth");
  }

  const auth = createAppAuth({ appId, privateKey });
  const { token } = await auth({ type: "installation", installationId });
  return token;
}
