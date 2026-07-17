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
    byName: new Map<string, { id: string; name: string; value: string; status: string }>(),
    seq: 0,
  };
  const svc = {
    getByName: vi.fn(async (_companyId: string, name: string) => state.byName.get(name) ?? null),
    create: vi.fn(async (_companyId: string, input: { name: string; value: string }) => {
      if (state.byName.has(input.name)) {
        throw Object.assign(new Error(`Secret already exists: ${input.name}`), { status: 409, statusCode: 409 });
      }
      const row = { id: `sec-${++state.seq}`, name: input.name, value: input.value, status: "active" };
      state.byName.set(input.name, row);
      return row;
    }),
    rotate: vi.fn(async (secretId: string, input: { value: string }) => {
      // Mirrors the real service: rotate appends a version + value; it NEVER
      // touches status. Reactivation must therefore happen separately.
      const row = [...state.byName.values()].find((r) => r.id === secretId);
      if (row) row.value = input.value;
      return row ?? null;
    }),
    update: vi.fn(async (secretId: string, patch: { status?: string }) => {
      // Canonical status-setting seam (svc.update) used to reactivate a
      // disabled/archived secret back to "active".
      const row = [...state.byName.values()].find((r) => r.id === secretId);
      if (row && patch.status) row.status = patch.status;
      return row ?? null;
    }),
    syncEnvBindingsForTarget: vi.fn(async () => {}),
  };
  return { state, svc };
});
vi.mock("../services/secrets.js", () => ({ secretService: () => secretsMock.svc }));

const mockLogActivity = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../services/activity-log.js", () => ({ logActivity: mockLogActivity }));

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

  it("REACTIVATES a disabled Commander secret before rotating so key-save recovers verification (Codex P2)", async () => {
    const app = makeApp();
    const first = await request(app).post(url).send({ provider: "anthropic", value: "sk-ant-OLD" });
    expect(first.status).toBe(200);
    const secretId = first.body.secretId as string;

    // Founder DISABLED the secret from Settings (status -> "disabled"). getByName
    // still returns it (deletedAt IS NULL), but resolveSecretValue would reject it
    // as "Secret is not active" until reactivated.
    const row = secretsMock.state.byName.get("Commander anthropic API key")!;
    row.status = "disabled";

    const save = await request(app).post(url).send({ provider: "anthropic", value: "sk-ant-NEW" });
    expect(save.status).toBe(200);
    expect(save.body).toEqual({ ok: true, secretId }); // same id -> binding stays valid
    // reactivated via the canonical update() seam, then rotated
    expect(secretsMock.svc.update).toHaveBeenCalledTimes(1);
    expect(secretsMock.svc.update).toHaveBeenCalledWith(secretId, { status: "active" });
    expect(secretsMock.svc.rotate).toHaveBeenCalledWith(secretId, expect.objectContaining({ value: "sk-ant-NEW" }), expect.anything());
    // ORDER: reactivate BEFORE rotate, so the final state is active + newest value
    expect(secretsMock.svc.update.mock.invocationCallOrder[0]).toBeLessThan(
      secretsMock.svc.rotate.mock.invocationCallOrder[0],
    );
    // resolvable end state: active + rotated value
    expect(row.status).toBe("active");
    expect(row.value).toBe("sk-ant-NEW");
  });

  it("reactivates an ARCHIVED Commander secret as well", async () => {
    const app = makeApp();
    const first = await request(app).post(url).send({ provider: "anthropic", value: "sk-ant-1" });
    expect(first.status).toBe(200);
    const secretId = first.body.secretId as string;
    secretsMock.state.byName.get("Commander anthropic API key")!.status = "archived";

    const save = await request(app).post(url).send({ provider: "anthropic", value: "sk-ant-2" });
    expect(save.status).toBe(200);
    expect(secretsMock.svc.update).toHaveBeenCalledWith(secretId, { status: "active" });
    expect(secretsMock.state.byName.get("Commander anthropic API key")?.status).toBe("active");
  });

  it("does NOT write status when the existing secret is already active (idempotent rotate)", async () => {
    const app = makeApp();
    const first = await request(app).post(url).send({ provider: "anthropic", value: "sk-ant-1" });
    expect(first.status).toBe(200);

    const retry = await request(app).post(url).send({ provider: "anthropic", value: "sk-ant-2" });
    expect(retry.status).toBe(200);
    expect(secretsMock.svc.update).not.toHaveBeenCalled(); // no spurious status write
    expect(secretsMock.svc.rotate).toHaveBeenCalledTimes(1);
    expect(secretsMock.state.byName.get("Commander anthropic API key")?.status).toBe("active");
  });
});

describe("POST commander-key audit trail (Codex P2 — AGENTS.md §5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    secretsMock.state.byName.clear();
    secretsMock.state.seq = 0;
  });

  function loggedInput(callIndex: number) {
    return mockLogActivity.mock.calls[callIndex][1] as {
      companyId: string;
      actorType: string;
      actorId: string;
      action: string;
      entityType: string;
      entityId: string;
      details: Record<string, unknown>;
    };
  }

  it("logs commander.key.created (redacted) when the secret is first created", async () => {
    const res = await request(makeApp()).post(url).send({ provider: "anthropic", value: "sk-ant-FIRST" });
    expect(res.status).toBe(200);
    expect(mockLogActivity).toHaveBeenCalledTimes(1);
    const input = loggedInput(0);
    expect(input).toMatchObject({
      companyId: "c1",
      actorType: "user",
      actorId: "u1",
      action: "commander.key.created",
      entityType: "secret",
      entityId: "sec-1",
    });
    expect(input.details).toMatchObject({ provider: "anthropic", secretId: "sec-1", operation: "created" });
    // Redaction proof: the raw key never appears anywhere in the audit entry.
    expect(JSON.stringify(input)).not.toContain("sk-ant-FIRST");
  });

  it("logs commander.key.rotated when an active secret is rotated on retry", async () => {
    const app = makeApp();
    await request(app).post(url).send({ provider: "anthropic", value: "sk-ant-BAD" });
    await request(app).post(url).send({ provider: "anthropic", value: "sk-ant-GOOD" });
    expect(mockLogActivity).toHaveBeenCalledTimes(2);
    const second = loggedInput(1);
    expect(second.action).toBe("commander.key.rotated");
    expect(second.entityId).toBe("sec-1"); // same secret id → stable reference
    expect(second.details).toMatchObject({ provider: "anthropic", secretId: "sec-1", operation: "rotated" });
    expect(JSON.stringify(mockLogActivity.mock.calls)).not.toContain("sk-ant-GOOD");
  });

  it("logs commander.key.reactivated when a disabled secret is reactivated then rotated", async () => {
    const app = makeApp();
    await request(app).post(url).send({ provider: "anthropic", value: "sk-ant-OLD" });
    secretsMock.state.byName.get("Commander anthropic API key")!.status = "disabled";
    await request(app).post(url).send({ provider: "anthropic", value: "sk-ant-NEW" });
    expect(mockLogActivity).toHaveBeenCalledTimes(2);
    const second = loggedInput(1);
    expect(second.action).toBe("commander.key.reactivated");
    expect(second.details).toMatchObject({ operation: "reactivated", provider: "anthropic" });
    expect(JSON.stringify(mockLogActivity.mock.calls)).not.toContain("sk-ant-NEW");
  });
});
