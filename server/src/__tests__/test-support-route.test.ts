import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzleOperatorStubs, makeTableProxy } from "./helpers/drizzle-mock.js";

vi.mock("drizzle-orm", () => drizzleOperatorStubs());
vi.mock("@armyofagents/db", () => ({ onboardingProgress: makeTableProxy("onboarding_progress") }));

import { testSupportRoutes } from "../routes/test-support.js";

function makeApp(db: unknown, actor: Record<string, unknown> = { type: "board", userId: "local-board" }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as { actor: unknown }).actor = actor as never;
    next();
  });
  app.use("/api", testSupportRoutes(db as never));
  return app;
}

describe("DELETE /api/test/onboarding-progress", () => {
  let deleted: unknown[];
  beforeEach(() => {
    deleted = [];
  });
  const db = () =>
    ({ delete: () => ({ where: async (w: unknown) => { deleted.push(w); } }) }) as never;

  it("401 for a non-board actor", async () => {
    const res = await request(makeApp(db(), { type: "none" })).delete("/api/test/onboarding-progress");
    expect(res.status).toBe(401);
  });

  it("clears the actor's onboarding_progress rows and returns ok", async () => {
    const app = makeApp(db());
    const res = await request(app).delete("/api/test/onboarding-progress");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(deleted).toHaveLength(1);
  });
});
