import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { authProfileRoutes } from "../routes/auth-profile.js";

const mockUserProfileService = vi.hoisted(() => ({
  load: vi.fn(),
  update: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  userProfileService: () => mockUserProfileService,
}));

function createApp(actor: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", authProfileRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe("auth profile routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /api/auth/get-session returns current user identity", async () => {
    mockUserProfileService.load.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      displayName: "User One",
      avatarUrl: null,
    });

    const app = createApp({
      type: "board",
      userId: "user-1",
      source: "session",
      isInstanceAdmin: false,
    });
    const res = await request(app).get("/api/auth/get-session");

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.session?.userId).toBe("user-1");
    expect(res.body.user?.id).toBe("user-1");
    expect(res.body.user?.email).toBe("user@example.com");
  });

  it("GET /api/auth/get-session rejects non-board actors", async () => {
    const app = createApp({ type: "none", source: "none" });
    const res = await request(app).get("/api/auth/get-session");
    expect(res.status).toBe(401);
  });

  it("GET /api/auth/profile returns current user profile", async () => {
    mockUserProfileService.load.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      displayName: "User One",
      avatarUrl: "https://example.com/a.png",
    });

    const app = createApp({
      type: "board",
      userId: "user-1",
      source: "session",
      isInstanceAdmin: false,
    });
    const res = await request(app).get("/api/auth/profile");

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      id: "user-1",
      email: "user@example.com",
      displayName: "User One",
      avatarUrl: "https://example.com/a.png",
    });
  });

  it("PATCH /api/auth/profile updates displayName", async () => {
    mockUserProfileService.update.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      displayName: "New Name",
      avatarUrl: null,
    });

    const app = createApp({
      type: "board",
      userId: "user-1",
      source: "session",
      isInstanceAdmin: false,
    });
    const res = await request(app)
      .patch("/api/auth/profile")
      .send({ displayName: "New Name" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.displayName).toBe("New Name");
    expect(mockUserProfileService.update).toHaveBeenCalledWith("user-1", {
      displayName: "New Name",
    });
  });

  it("PATCH /api/auth/profile rejects empty displayName", async () => {
    const app = createApp({
      type: "board",
      userId: "user-1",
      source: "session",
      isInstanceAdmin: false,
    });
    const res = await request(app)
      .patch("/api/auth/profile")
      .send({ displayName: "" });

    expect(res.status).toBe(400);
    expect(mockUserProfileService.update).not.toHaveBeenCalled();
  });
});
