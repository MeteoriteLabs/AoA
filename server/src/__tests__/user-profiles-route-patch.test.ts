import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { userProfileRoutes } from "../routes/user-profiles.js";

const profileMocks = vi.hoisted(() => ({
  get: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("../services/user-profiles.js", () => ({
  getUserProfile: profileMocks.get,
  upsertUserProfile: profileMocks.upsert,
}));

function createApp(db: any) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.actor = { type: "board", userId: "u1" };
    next();
  });
  app.use("/api", userProfileRoutes(db));
  return app;
}

describe("PATCH /api/user-profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profileMocks.upsert.mockResolvedValue({
      userId: "u1",
      displayName: "Ada Lovelace",
      avatarUrl: null,
      title: "Founder",
      bio: "Existing bio",
      socialLinks: [],
    });
  });

  it("preserves omission so a display-name patch cannot clear unrelated fields", async () => {
    const db = {};
    const res = await request(createApp(db))
      .patch("/api/user-profile")
      .send({ displayName: "Ada Lovelace" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(profileMocks.upsert).toHaveBeenCalledWith(db, "u1", {
      displayName: "Ada Lovelace",
    });
  });
});
