import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { getUserProfile, upsertUserProfile } from "../services/user-profiles.js";
import { userProfileRoutes } from "../routes/user-profiles.js";

function fakeDb() {
  let saved: Record<string, unknown> | null = null;
  return {
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoUpdate: async ({ set }: { set: Record<string, unknown> }) => {
          saved = saved ? { ...saved, ...set } : { ...v };
        },
      }),
    }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (saved ? [saved] : []) }) }) }),
  } as any;
}

describe("user profile service (Stage C / C1)", () => {
  it("upserts and returns the global profile", async () => {
    const db = fakeDb();
    const p = await upsertUserProfile(db, "u1", {
      displayName: "Ada",
      socialLinks: [{ type: "github", label: null, url: "https://github.com/ada" }],
    });
    expect(p.userId).toBe("u1");
    expect(p.displayName).toBe("Ada");
    expect(p.socialLinks[0].url).toContain("github");
  });

  it("getUserProfile returns null when none exists", async () => {
    const db = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) } as any;
    expect(await getUserProfile(db, "u1")).toBeNull();
  });

  it("preserves omitted fields on update while applying explicit clears", async () => {
    const db = fakeDb();
    await upsertUserProfile(db, "u1", {
      displayName: "Ada",
      avatarUrl: "https://example.com/ada.png",
      title: "Founder",
      bio: "Builds analytical engines",
      socialLinks: [{ type: "github", label: null, url: "https://github.com/ada" }],
    });

    const updated = await upsertUserProfile(db, "u1", {
      displayName: "Ada Lovelace",
      avatarUrl: null,
    });

    expect(updated).toMatchObject({
      displayName: "Ada Lovelace",
      avatarUrl: null,
      title: "Founder",
      bio: "Builds analytical engines",
    });
    expect(updated.socialLinks).toEqual([
      { type: "github", label: null, url: "https://github.com/ada" },
    ]);
  });
});

describe("user profile route (Stage C / C1)", () => {
  it("GET /user-profile → 401 without a board actor", async () => {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.actor = { type: "none" };
      next();
    });
    app.use("/api", userProfileRoutes({} as any));
    const res = await request(app).get("/api/user-profile");
    expect(res.status).toBe(401);
  });
});
