export type AuthSession = {
  session: { id: string; userId: string };
  user: { id: string; email: string | null; name: string | null };
};

function toSession(value: unknown): AuthSession | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const sessionValue = record.session;
  const userValue = record.user;
  if (!sessionValue || typeof sessionValue !== "object") return null;
  if (!userValue || typeof userValue !== "object") return null;
  const session = sessionValue as Record<string, unknown>;
  const user = userValue as Record<string, unknown>;
  if (typeof session.id !== "string" || typeof session.userId !== "string")
    return null;
  if (typeof user.id !== "string") return null;
  return {
    session: { id: session.id, userId: session.userId },
    user: {
      id: user.id,
      email: typeof user.email === "string" ? user.email : null,
      name: typeof user.name === "string" ? user.name : null,
    },
  };
}

async function authPost(
  path: string,
  body: Record<string, unknown>,
  acceptedErrorStatuses: readonly number[] = []
) {
  const res = await fetch(`/api/auth${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok && !acceptedErrorStatuses.includes(res.status)) {
    const message =
      (payload as { error?: { message?: string } | string } | null)?.error &&
      typeof (payload as { error?: { message?: string } | string }).error ===
        "object"
        ? (payload as { error?: { message?: string } }).error?.message ??
          `Request failed: ${res.status}`
        : (payload as { error?: string } | null)?.error ??
          `Request failed: ${res.status}`;
    throw new Error(message);
  }
  return payload;
}

export const authApi = {
  getSession: async (): Promise<AuthSession | null> => {
    const res = await fetch("/api/auth/get-session", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (res.status === 401) return null;
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(`Failed to load session (${res.status})`);
    }
    const direct = toSession(payload);
    if (direct) return direct;
    const nested =
      payload && typeof payload === "object"
        ? toSession((payload as Record<string, unknown>).data)
        : null;
    return nested;
  },

  // Google is the only sign-in provider. This starts the OAuth flow via
  // better-auth and returns the provider URL to redirect the browser to.
  signInSocial: async (
    provider: "google" = "google",
    callbackURL = "/"
  ): Promise<{ url?: string }> => {
    const data = (await authPost("/sign-in/social", {
      provider,
      callbackURL,
    })) as { url?: string } | null;
    return data ?? {};
  },

  signOut: async () => {
    // An expired session is already signed out from the server's perspective.
    await authPost("/sign-out", {}, [401]);
  },

  cancelOwnLoginChallenges: async (): Promise<void> => {
    const res = await fetch("/api/auth/commander-login/cancel-all", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    // A stale/expired browser session can no longer own server-side challenges.
    // Continue to the local cleanup and login screen in that case.
    if (!res.ok && res.status !== 401 && res.status !== 404) {
      throw new Error(
        `Failed to cancel active sign-in sessions (${res.status})`
      );
    }
  },
};
