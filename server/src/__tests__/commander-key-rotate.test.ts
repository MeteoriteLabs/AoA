import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzleOperatorStubs, makeTableProxy } from "./helpers/drizzle-mock.js";

vi.mock("drizzle-orm", () => drizzleOperatorStubs());
vi.mock("@armyofagents/db", () => ({
  agents: makeTableProxy("agents"),
  internalAgentConfig: makeTableProxy("internal_agent_config"),
}));
vi.mock("../middleware/rbac.js", () => ({ assertRole: vi.fn(async () => {}) }));
vi.mock("../routes/authz.js", () => ({ assertCompanyAccess: vi.fn() }));

/**
 * Stateful secretService mock reproducing the real service contract that made
 * the Codex P1 bite: `create` REJECTS an active duplicate name with a 409, so a
 * founder who saves a bad key then retries with a corrected one used to get
 * permanently wedged. `getByName` finds the existing row and `rotate` succeeds.
 *
 * NOTE: persistCommanderApiKey and the route's `writeSecret` closure are NOT
 * mocked here — this drives the fix end-to-end through the real route.
 */
const secretsMock = vi.hoisted(() => {
  const state = {
    byName: new Map<string, { id: string; name: string; value: string }>(),
    seq: 0,
  };
  const svc = {
    getByName: vi.fn(async (_companyId: string, name: string) => state.byName.get(name) ?? null),
    create: vi.fn(async (_companyId: string, input: { name: string; value: string }) => {
      if (state.byName.has(input.name)) {
        throw Object.assign(new Error(`Secret already exists: ${input.name}`), { status: 409, statusCode: 409 });
      }
      const row = { id: `sec-${++state.seq}`, name: input.name, value: input.value };
      state.byName.set(input.name, row);
      return row;
    }),
    rotate: vi.fn(async (secretId: string, input: { value: string }) => {
      const row = [...state.byName.values()].find((r) => r.id === secretId);
      if (row) row.value = input.value;
      return row ?? null;
    }),
    syncEnvBindingsForTarget: vi.fn(async () => {}),
  };
  return { state, svc };
});
vi.mock("../services/secrets.js", () => ({ secretService: () => secretsMock.svc }));

import { errorHandler } from "../middleware/error-handler.js";
import { commanderKeyRoutes } from "../routes/commander-key.js";

function db() {
  return {
    select: () => ({
      from: (tbl: { _: { name: string } }) => ({
        where: () => ({
          limit: async () =>
            tbl._.name === "internal_agent_config" ? [{ agentId: "cmd" }] : [{ adapterConfig: {} }],
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  } as never;
}
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as { actor: unknown }).actor = { type: "board", userId: "u1" };
    next();
  });
  app.use("/api", commanderKeyRoutes(db()));
  app.use(errorHandler);
  return app;
}
const url = "/api/companies/c1/internal-agent/commander-key";

describe("POST commander-key rotate-on-retry (Codex P1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    secretsMock.state.byName.clear();
    secretsMock.state.seq = 0;
  });

  it("first save creates the Commander secret (no rotate)", async () => {
    const res = await request(makeApp()).post(url).send({ provider: "anthropic", value: "sk-ant-FIRST" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, secretId: "sec-1" });
    expect(secretsMock.svc.create).toHaveBeenCalledTimes(1);
    expect(secretsMock.svc.rotate).not.toHaveBeenCalled();
  });

  it("retry after a bad key ROTATES the existing secret instead of 409ing", async () => {
    const app = makeApp();
    const first = await request(app).post(url).send({ provider: "anthropic", value: "sk-ant-BAD" });
    expect(first.status).toBe(200);
    const firstId = first.body.secretId as string;

    const retry = await request(app).post(url).send({ provider: "anthropic", value: "sk-ant-GOOD" });
    expect(retry.status).toBe(200); // NOT 409
    expect(retry.body).toEqual({ ok: true, secretId: firstId }); // same id → binding stays valid
    expect(secretsMock.svc.create).toHaveBeenCalledTimes(1); // created only once
    expect(secretsMock.svc.rotate).toHaveBeenCalledTimes(1); // rotated on retry
    // the rotate actually updated the resolved value the Commander adapter reads
    expect(secretsMock.svc.rotate).toHaveBeenCalledWith(firstId, expect.objectContaining({ value: "sk-ant-GOOD" }), expect.anything());
    expect(secretsMock.state.byName.get("Commander anthropic API key")?.value).toBe("sk-ant-GOOD");
    // no plaintext key ever leaves in the response
    expect(JSON.stringify(retry.body)).not.toContain("sk-ant-GOOD");
  });

  it("openai retry rotates its own deterministic secret independently", async () => {
    const app = makeApp();
    const first = await request(app).post(url).send({ provider: "openai", value: "sk-oai-1" });
    expect(first.status).toBe(200);
    const retry = await request(app).post(url).send({ provider: "openai", value: "sk-oai-2" });
    expect(retry.status).toBe(200);
    expect(secretsMock.svc.rotate).toHaveBeenCalledTimes(1);
    expect(secretsMock.svc.rotate).toHaveBeenCalledWith(first.body.secretId, expect.objectContaining({ value: "sk-oai-2" }), expect.anything());
  });
});
