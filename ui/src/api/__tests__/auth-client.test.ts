import { describe, it, expect, vi, beforeEach } from "vitest";
import { authApi } from "../auth";

describe("authApi.signInSocial (Stage A / A8)", () => {
  beforeEach(() => {
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ url: "https://accounts.google.com/o/oauth2/auth?x=1" }),
    }));
  });

  it("posts to /api/auth/sign-in/social with provider google + credentials", async () => {
    const data = await authApi.signInSocial("google", "/next");
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe("/api/auth/sign-in/social");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body)).toMatchObject({ provider: "google", callbackURL: "/next" });
    expect(data.url).toContain("accounts.google.com");
  });

  it("no longer exports email/password methods", () => {
    expect((authApi as any).signInEmail).toBeUndefined();
    expect((authApi as any).signUpEmail).toBeUndefined();
  });
});

describe("authApi.cancelOwnLoginChallenges", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, cancelled: 0 }),
    })) as typeof fetch;
  });

  it("posts an authenticated empty JSON request to the cancel-all endpoint", async () => {
    await authApi.cancelOwnLoginChallenges();

    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/commander-login/cancel-all",
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }
    );
  });

  it.each([401, 404])(
    "treats %i as already unable to own a server-side challenge",
    async (status) => {
      globalThis.fetch = vi.fn(async () => ({
        ok: false,
        status,
      })) as typeof fetch;

      await expect(authApi.cancelOwnLoginChallenges()).resolves.toBeUndefined();
    }
  );

  it("surfaces unexpected server failures", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 503,
    })) as typeof fetch;

    await expect(authApi.cancelOwnLoginChallenges()).rejects.toThrow(
      "Failed to cancel active sign-in sessions (503)"
    );
  });
});
