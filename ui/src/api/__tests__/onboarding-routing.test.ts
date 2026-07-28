import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  destinationForJourney,
  fetchJourney,
  getOnboardingProgress,
  advanceOnboarding,
  setFirstRunCompleted,
} from "../onboarding";
import type { PostAuthJourneyResult } from "@armyofagents/shared";

const base = (over: Partial<PostAuthJourneyResult>): PostAuthJourneyResult =>
  ({
    schemaVersion: 1,
    journey: "founder",
    targetCompanyId: null,
    pendingInvitations: [],
    inviteToken: null,
    canCreateCompany: true,
    resumeFirstRunCompanyId: null,
    ...over,
  } as PostAuthJourneyResult);

describe("destinationForJourney (Stage A / A9)", () => {
  it("returning → lobby", () => {
    expect(
      destinationForJourney(
        base({ journey: "returning", targetCompanyId: "c1" })
      )
    ).toBe("/");
  });

  it("founder → onboarding", () => {
    expect(destinationForJourney(base({ journey: "founder" }))).toBe(
      "/onboarding"
    );
  });

  it("invited → join flow with the target company", () => {
    expect(
      destinationForJourney(base({ journey: "invited", targetCompanyId: "c2" }))
    ).toBe("/onboarding/join?company=c2");
  });

  it("routes access-required users to the account rescue screen", () => {
    expect(
      destinationForJourney(
        base({ journey: "access_required", canCreateCompany: false })
      )
    ).toBe("/access-required");
  });
});

describe("onboarding progress client (Stage B / B7)", () => {
  beforeEach(() => {
    (globalThis as any).fetch = vi.fn();
  });

  it("getOnboardingProgress GETs with credentials + companyId", async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ progress: { completedStates: ["AUTHENTICATED"] } }),
    });
    const p = await getOnboardingProgress("c1");
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe("/api/onboarding/progress?companyId=c1");
    expect(init.credentials).toBe("include");
    expect(p).toEqual({ completedStates: ["AUTHENTICATED"] });
  });

  it("getOnboardingProgress returns null when no row", async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ progress: null }),
    });
    expect(await getOnboardingProgress(null)).toBeNull();
  });

  it("advanceOnboarding PATCHes the requested state", async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        progress: { completedStates: ["AUTHENTICATED", "PROFILE_SET"] },
      }),
    });
    const p = await advanceOnboarding({
      companyId: null,
      journey: "founder",
      requestedState: "PROFILE_SET",
    });
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe("/api/onboarding/progress");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toMatchObject({
      journey: "founder",
      requestedState: "PROFILE_SET",
    });
    expect(p?.completedStates).toContain("PROFILE_SET");
  });
});

describe("journey contract negotiation", () => {
  beforeEach(() => {
    (globalThis as any).fetch = vi.fn();
  });

  it("advertises support for the access-required discriminant", async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        schemaVersion: 1,
        journey: "founder",
        targetCompanyId: null,
        pendingInvitations: [],
        inviteToken: null,
        canCreateCompany: true,
        resumeFirstRunCompanyId: null,
      }),
    });

    await expect(fetchJourney()).resolves.toMatchObject({
      journey: "founder",
      canCreateCompany: true,
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/onboarding/journey",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-AOA-Journey-Schema-Version": "1",
        }),
      })
    );
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("verifies a legacy founder through the authoritative profile endpoint", async () => {
    (globalThis.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          journey: "founder",
          targetCompanyId: null,
          pendingInvitations: [],
          inviteToken: null,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "admin-1",
          email: "admin@example.com",
          displayName: "Admin",
          avatarUrl: null,
          isInstanceAdmin: true,
        }),
      });

    await expect(fetchJourney()).resolves.toMatchObject({
      journey: "founder",
      canCreateCompany: true,
    });
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      "/api/auth/profile",
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("fails a legacy non-admin founder closed to access-required", async () => {
    (globalThis.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          journey: "founder",
          targetCompanyId: null,
          pendingInvitations: [],
          inviteToken: null,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "member-1",
          email: "member@example.com",
          displayName: "Member",
          avatarUrl: null,
          isInstanceAdmin: false,
        }),
      });

    await expect(fetchJourney()).resolves.toMatchObject({
      journey: "access_required",
      canCreateCompany: false,
    });
  });

  it.each([
    {
      name: "profile request fails",
      response: { ok: false, status: 500 },
    },
    {
      name: "profile response is malformed",
      response: {
        ok: true,
        json: async () => ({ id: "member-1", isInstanceAdmin: true }),
      },
    },
  ])("fails closed when the legacy founder $name", async ({ response }) => {
    (globalThis.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          journey: "founder",
          targetCompanyId: null,
          pendingInvitations: [],
          inviteToken: null,
        }),
      })
      .mockResolvedValueOnce(response);

    await expect(fetchJourney()).resolves.toMatchObject({
      journey: "access_required",
      canCreateCompany: false,
    });
  });

  it("keeps a legacy invited response on the one-request path", async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        journey: "invited",
        targetCompanyId: "company-1",
        pendingInvitations: [],
        inviteToken: null,
      }),
    });

    await expect(fetchJourney()).resolves.toMatchObject({ journey: "invited" });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("restores company creation for a legacy returning instance admin", async () => {
    (globalThis.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          journey: "returning",
          targetCompanyId: "company-1",
          pendingInvitations: [],
          inviteToken: null,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "admin-1",
          email: "admin@example.com",
          displayName: "Admin",
          avatarUrl: null,
          isInstanceAdmin: true,
        }),
      });

    await expect(fetchJourney()).resolves.toMatchObject({
      journey: "returning",
      canCreateCompany: true,
    });
  });

  it("keeps company creation disabled for a legacy returning non-admin", async () => {
    (globalThis.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          journey: "returning",
          targetCompanyId: "company-1",
          pendingInvitations: [],
          inviteToken: null,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "member-1",
          email: "member@example.com",
          displayName: "Member",
          avatarUrl: null,
          isInstanceAdmin: false,
        }),
      });

    await expect(fetchJourney()).resolves.toMatchObject({
      journey: "returning",
      canCreateCompany: false,
    });
  });

  it("fails a legacy returning capability check closed", async () => {
    (globalThis.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          journey: "returning",
          targetCompanyId: "company-1",
          pendingInvitations: [],
          inviteToken: null,
        }),
      })
      .mockRejectedValueOnce(new Error("profile unavailable"));

    await expect(fetchJourney()).resolves.toMatchObject({
      journey: "returning",
      canCreateCompany: false,
    });
  });

  it("times out a stalled legacy profile capability check and fails closed", async () => {
    vi.useFakeTimers();
    try {
      (globalThis.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            journey: "founder",
            targetCompanyId: null,
            pendingInvitations: [],
            inviteToken: null,
          }),
        })
        .mockImplementationOnce(
          (_url: string, init: { signal: AbortSignal }) =>
            new Promise((_resolve, reject) => {
              init.signal.addEventListener(
                "abort",
                () => reject(new Error("profile request aborted")),
                { once: true }
              );
            })
        );

      const journeyPromise = fetchJourney();
      await vi.advanceTimersByTimeAsync(0);
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(5_000);

      await expect(journeyPromise).resolves.toMatchObject({
        journey: "access_required",
        canCreateCompany: false,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed when the legacy founder profile request rejects", async () => {
    (globalThis.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          journey: "founder",
          targetCompanyId: null,
          pendingInvitations: [],
          inviteToken: null,
        }),
      })
      .mockRejectedValueOnce(new Error("profile unavailable"));

    await expect(fetchJourney()).resolves.toMatchObject({
      journey: "access_required",
      canCreateCompany: false,
    });
  });
});

describe("setFirstRunCompleted (Fix 2 — write the flag at onboarding completion)", () => {
  beforeEach(() => {
    (globalThis as any).fetch = vi.fn();
  });

  it("PATCHes the first-run endpoint with companyId + completed:true", async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        progress: { firstRunCompletedAt: "2026-07-18T00:00:00Z" },
      }),
    });
    await setFirstRunCompleted("c1");
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe("/api/onboarding/first-run");
    expect(init.method).toBe("PATCH");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body)).toEqual({ companyId: "c1", completed: true });
  });

  // The function returns false rather than undefined on failure (453a92b55) so
  // callers can tell a confirmed write from an unconfirmed one and avoid
  // clearing resume state on the latter. It still must never throw.
  it("resolves false without throwing when the server responds with a non-OK status", async () => {
    (globalThis.fetch as any).mockResolvedValue({ ok: false, status: 409 });
    await expect(setFirstRunCompleted("c1")).resolves.toBe(false);
  });

  it("resolves false without throwing when fetch itself rejects", async () => {
    (globalThis.fetch as any).mockRejectedValue(new Error("network down"));
    await expect(setFirstRunCompleted("c1")).resolves.toBe(false);
  });

  it("resolves true when the write is confirmed", async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    await expect(setFirstRunCompleted("c1")).resolves.toBe(true);
  });
});
