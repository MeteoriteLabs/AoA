import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "@armyofagents/shared";
import { errorHandler } from "../middleware/index.js";
import { notificationPreferenceRoutes } from "../routes/notification-preferences.js";

const mockPreferences = vi.hoisted(() => ({
  get: vi.fn(),
  upsert: vi.fn(),
  reset: vi.fn(),
}));

const mockDigest = vi.hoisted(() => ({
  listForUser: vi.fn(),
  ackForUser: vi.fn(),
}));

const mockPerms = vi.hoisted(() => ({
  getEffectiveRole: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../services/index.js", () => ({
  notificationPreferencesService: () => mockPreferences,
  notificationDigestService: () => mockDigest,
  permissionService: () => mockPerms,
  logActivity: mockLogActivity,
}));

const COMPANY_A = "11111111-1111-1111-1111-111111111111";
const COMPANY_B = "55555555-5555-5555-5555-555555555555";

function boardActor(
  overrides: Partial<{
    userId: string;
    companyIds: string[];
    isInstanceAdmin: boolean;
    source: string;
  }> = {},
) {
  return {
    type: "board" as const,
    userId: overrides.userId ?? "user-1",
    source: overrides.source ?? "session",
    companyIds: overrides.companyIds ?? [COMPANY_A],
    isInstanceAdmin: overrides.isInstanceAdmin ?? false,
  };
}

function createApp(actor: unknown = boardActor()) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as { actor: unknown }).actor = actor;
    next();
  });
  app.use("/api", notificationPreferenceRoutes({} as never));
  app.use(errorHandler);
  return app;
}

describe("notification preference routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPreferences.get.mockResolvedValue(DEFAULT_NOTIFICATION_PREFERENCES);
    mockPreferences.upsert.mockResolvedValue({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
    mockPreferences.reset.mockResolvedValue(DEFAULT_NOTIFICATION_PREFERENCES);
    mockDigest.listForUser.mockResolvedValue({ items: [] });
    mockDigest.ackForUser.mockResolvedValue({ acked: 0 });
    mockPerms.getEffectiveRole.mockResolvedValue("team_member");
  });

  it("GET preferences/me returns defaults for the current board user", async () => {
    const app = createApp();

    const res = await request(app).get(
      `/api/companies/${COMPANY_A}/notifications/preferences/me`,
    );

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.rules.length).toBeGreaterThan(0);
    expect(res.body.quietHours.enabled).toBe(false);
    expect(mockPreferences.get).toHaveBeenCalledWith("user-1", COMPANY_A);
  });

  it("PATCH preferences/me rejects duplicate rules", async () => {
    const [first] = DEFAULT_NOTIFICATION_PREFERENCES.rules;
    const app = createApp();

    const res = await request(app)
      .patch(`/api/companies/${COMPANY_A}/notifications/preferences/me`)
      .send({ rules: [first, first] });

    expect(res.status).toBe(400);
    expect(mockPreferences.upsert).not.toHaveBeenCalled();
  });

  it("PATCH preferences/me logs an activity row", async () => {
    const app = createApp();

    const res = await request(app)
      .patch(`/api/companies/${COMPANY_A}/notifications/preferences/me`)
      .send({ digest: { enabled: true, cadence: "daily" } });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockPreferences.upsert).toHaveBeenCalledWith("user-1", COMPANY_A, {
      digest: { enabled: true, cadence: "daily" },
    });
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId: COMPANY_A,
        action: "notification_preferences.updated",
        actorType: "user",
        actorId: "user-1",
      }),
    );
  });

  it("reset restores defaults after an update", async () => {
    const app = createApp();
    await request(app)
      .patch(`/api/companies/${COMPANY_A}/notifications/preferences/me`)
      .send({
        quietHours: { enabled: true, start: "18:00", end: "09:00", timezone: "UTC" },
      })
      .expect(200);

    const res = await request(app)
      .post(`/api/companies/${COMPANY_A}/notifications/preferences/me/reset`)
      .send({});

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.quietHours.enabled).toBe(false);
    expect(mockPreferences.reset).toHaveBeenCalledWith("user-1", COMPANY_A);
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId: COMPANY_A,
        action: "notification_preferences.reset",
      }),
    );
  });

  it("forbids companies outside the current board actor", async () => {
    const app = createApp(boardActor({ companyIds: [COMPANY_B] }));

    const res = await request(app).get(
      `/api/companies/${COMPANY_A}/notifications/preferences/me`,
    );

    expect(res.status).toBe(403);
    expect(mockPreferences.get).not.toHaveBeenCalled();
  });
});
