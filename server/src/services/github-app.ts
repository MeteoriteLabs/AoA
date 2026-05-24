import { createHmac, timingSafeEqual } from "node:crypto";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { eq } from "drizzle-orm";
import { githubInstallations, type Db, type GitHubInstallation, type NewGitHubInstallation } from "@armyofagents/db";

// ---------------------------------------------------------------------------
// Signed install-state helpers
// ---------------------------------------------------------------------------

const INSTALL_STATE_TTL_MS = 10 * 60 * 1000; // 10 min

function installStateSecret(): string {
  const s = process.env.BETTER_AUTH_SECRET?.trim() || process.env.AOA_AGENT_JWT_SECRET?.trim();
  if (!s) throw new Error("BETTER_AUTH_SECRET (or AOA_AGENT_JWT_SECRET) must be set to sign the GitHub install state");
  return s;
}

/**
 * Signed, expiring state token binding the GitHub App install flow to a
 * specific company. Prevents a forged callback from rebinding another
 * tenant's installation.
 */
export function signInstallState(companyId: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ c: companyId, e: now + INSTALL_STATE_TTL_MS }), "utf8").toString("base64url");
  const sig = createHmac("sha256", installStateSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

/**
 * Verify a signed state token. Returns the companyId, or null if
 * invalid / expired / tampered.
 */
export function verifyInstallState(state: string, now = Date.now()): string | null {
  const dot = state.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  let expected: string;
  try {
    expected = createHmac("sha256", installStateSecret()).update(payload).digest("base64url");
  } catch {
    return null;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const obj = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { c?: string; e?: number };
    if (!obj.c || typeof obj.e !== "number" || obj.e < now) return null;
    return obj.c;
  } catch {
    return null;
  }
}

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

// ---------------------------------------------------------------------------
// Installation repositories
// ---------------------------------------------------------------------------

/**
 * List all repositories the GitHub App installation can access.
 * Returns [] if no installation is active for the company.
 */
export async function listInstallationRepositories(
  db: Db,
  companyId: string,
): Promise<Array<{ name: string; fullName: string; private: boolean; url: string }>> {
  const installation = await getInstallation(db, companyId);
  if (!installation) return [];

  const token = await mintInstallationToken(installation.installationId);
  const octokit = new Octokit({ auth: token });

  // Paginate — installations on large orgs can have >100 accessible repos, and
  // this helper is contracted to return ALL of them.
  const repos = await octokit.paginate(octokit.apps.listReposAccessibleToInstallation, {
    per_page: 100,
  });

  return repos.map((r) => ({
    name: r.name,
    fullName: r.full_name,
    private: r.private,
    url: r.html_url,
  }));
}
