import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { Db } from "@armyofagents/db";
import { authSessions, authUsers, onboardingProgress } from "@armyofagents/db";
import { eq } from "drizzle-orm";
import type { Config } from "../config.js";
import { resolveBetterAuthSigningSecret } from "../auth/better-auth.js";

/**
 * Session cookie name for the e2e session mint below. This router is mounted
 * ONLY in local_trusted + the dev escape hatch (see app.ts), where better-auth
 * runs with `useSecureCookies: false` (private exposure, no explicit https
 * base URL — see buildBetterAuthConfig), so the cookie carries no `__Secure-`
 * prefix and the default `better-auth` prefix + `session_token` name apply.
 */
const SESSION_COOKIE_NAME = "better-auth.session_token";

/** Mirrors the better-auth session config in buildBetterAuthConfig (A11: 90d). */
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Test-only routes for e2e isolation. MOUNTED ONLY in local_trusted + the e2e
 * escape hatch (see app.ts) — never in authenticated mode. Each route is
 * self-scoped to req.actor (a spec can only reset its own state).
 */
export function testSupportRoutes(db: Db): Router {
  const router = Router();

  // Clear the acting user's onboarding_progress (user + org layers) so the next
  // spec starts clean.
  router.delete("/test/onboarding-progress", async (req: Request, res: Response) => {
    const actor = req.actor;
    if (actor.type !== "board" || !actor.userId) {
      res.status(401).json({ error: "authentication required" });
      return;
    }
    await db.delete(onboardingProgress).where(eq(onboardingProgress.userId, actor.userId));
    res.json({ ok: true });
  });

  // Mint a SECOND authenticated identity for e2e (N3): upsert a verified
  // better-auth user + a real session row, and return a session cookie that
  // better-auth's own getSession accepts. This is what lets the invited-teammate
  // journey be tested — local_trusted e2e otherwise only has the synthetic
  // local-board actor, and Google (the sole sign-in provider) can't run in CI.
  //
  // Mechanism — deliberately NOT better-auth's internalAdapter.createUser/
  // createSession: those run the app's databaseHooks, whose first-admin
  // bootstrap (RB3/A7) would promote the minted teammate to instance_admin on a
  // fresh e2e instance (the only existing admin is the synthetic local-board
  // row) and demote local-board — silently flipping the teammate's post-auth
  // journey to "returning" via the admin bypass and breaking the very invited
  // semantics under test. Instead we write the exact rows better-auth reads
  // (user + session) with drizzle, and sign the cookie in better-call's signed
  // cookie format: `${token}.${base64(hmacSha256(token, secret))}`, URI-encoded
  // (see better-call crypto.ts signCookieValue / context.ts getSignedCookie —
  // signature must be 44 base64 chars ending "="). The signing secret comes
  // from the SAME resolver the real auth instance uses. Round-trip is proven
  // in test-support-route.test.ts by feeding the minted cookie to a real
  // betterAuth instance's api.getSession.
  //
  // Idempotent per email: re-minting reuses the existing user (re-verifying the
  // email) and issues a fresh session.
  router.post("/test-support/session", async (req: Request, res: Response) => {
    const actor = req.actor;
    if (actor.type !== "board" || !actor.userId) {
      res.status(401).json({ error: "authentication required" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email || !email.includes("@") || email.length > 320) {
      res.status(400).json({ error: "a valid email is required" });
      return;
    }
    const name =
      typeof body.name === "string" && body.name.trim().length > 0
        ? body.name.trim()
        : (email.split("@")[0] ?? "e2e-user");

    const now = new Date();
    // better-auth lowercases emails on write, and this route is the only other
    // writer of these users — a plain equality match is the same lookup
    // better-auth's findUserByEmail performs.
    const existing = await db
      .select({ id: authUsers.id })
      .from(authUsers)
      .where(eq(authUsers.email, email))
      .then((rows) => rows[0] ?? null);

    let userId: string;
    if (existing) {
      userId = existing.id;
      // Re-mint: make sure the identity is in the state the invited flows
      // require (verified email) and carries the requested display name.
      await db
        .update(authUsers)
        .set({ name, displayName: name, emailVerified: true, updatedAt: now })
        .where(eq(authUsers.id, userId));
    } else {
      userId = randomUUID();
      await db.insert(authUsers).values({
        id: userId,
        name,
        email,
        // The invited flows (journey detection, tokenless claim, auto-admit)
        // all gate on a VERIFIED email — mint verified, like a Google sign-in.
        emailVerified: true,
        displayName: name,
        createdAt: now,
        updatedAt: now,
      });
    }

    // A fresh session per mint. Token shape mirrors better-auth's generateId
    // (URL-safe, no "." — the signed-cookie format splits on the last dot).
    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    await db.insert(authSessions).values({
      id: randomUUID(),
      token,
      userId,
      expiresAt,
      createdAt: now,
      updatedAt: now,
      ipAddress: "",
      userAgent: "aoa-e2e-test-support",
    });

    // Same resolver the real better-auth instance uses (env override or the
    // local_trusted dev fallback). The router only mounts in local_trusted, so
    // passing that mode is truthful — the resolver reads nothing else.
    const secret = resolveBetterAuthSigningSecret({
      deploymentMode: "local_trusted",
    } as Pick<Config, "deploymentMode"> as Config);
    const signature = createHmac("sha256", secret).update(token).digest("base64");
    const cookieValue = encodeURIComponent(`${token}.${signature}`);

    res.json({
      userId,
      email,
      cookie: { name: SESSION_COOKIE_NAME, value: cookieValue },
      expiresAt: expiresAt.toISOString(),
    });
  });

  return router;
}
