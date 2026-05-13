import { vi, describe, it, expect, beforeEach } from "vitest";

const { mockEq, mockAnd } = vi.hoisted(() => ({
  mockEq: vi.fn((..._args: unknown[]) => "eq-result"),
  mockAnd: vi.fn((..._args: unknown[]) => "and-result"),
}));

vi.mock("drizzle-orm", () => ({
  eq: mockEq,
  and: mockAnd,
}));

vi.mock("@armyofagents/db", () => {
  const makeTable = (name: string) => {
    const cols: Record<string, symbol> = {};
    return new Proxy({} as Record<string, unknown>, {
      get(_target, prop) {
        if (prop === "_") return { name };
        if (prop === "$inferSelect" || prop === "$inferInsert") return {};
        if (typeof prop === "string") {
          if (!cols[prop]) cols[prop] = Symbol(prop);
          return cols[prop];
        }
        return undefined;
      },
    });
  };
  return {
    environments: makeTable("environments"),
  };
});

import { environmentService } from "../services/environments.js";
import { environments } from "@armyofagents/db";

type MockRow = Record<string, unknown>;

function createSequenceDb(
  config: {
    selects?: MockRow[][];
    inserts?: MockRow[][];
    updates?: MockRow[][];
    deletes?: MockRow[][];
  } = {},
) {
  let selectIdx = 0;
  let insertIdx = 0;
  let updateIdx = 0;
  let deleteIdx = 0;
  const selects = config.selects ?? [];
  const inserts = config.inserts ?? [];
  const updates = config.updates ?? [];
  const deletes = config.deletes ?? [];

  function makeChain(getResult: () => MockRow[]) {
    const chain: Record<string, unknown> = {};
    for (const m of [
      "from",
      "where",
      "values",
      "returning",
      "set",
      "onConflictDoUpdate",
      "orderBy",
    ]) {
      chain[m] = (..._args: unknown[]) => chain;
    }
    chain.then = (resolve: (v: MockRow[]) => unknown) =>
      Promise.resolve(resolve(getResult()));
    return chain;
  }

  return {
    select: (..._args: unknown[]) => makeChain(() => selects[selectIdx++] ?? []),
    insert: (..._args: unknown[]) => makeChain(() => inserts[insertIdx++] ?? []),
    update: (..._args: unknown[]) => makeChain(() => updates[updateIdx++] ?? []),
    delete: (..._args: unknown[]) => makeChain(() => deletes[deleteIdx++] ?? []),
  } as any;
}

const COMPANY = "00000000-0000-0000-0000-000000000001";

function makeEnv(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id: "e1",
    companyId: COMPANY,
    name: "production",
    envVars: {},
    connectionTarget: null,
    target: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("environmentService", () => {
  beforeEach(() => {
    mockEq.mockClear();
    mockAnd.mockClear();
  });

  describe("list", () => {
    it("returns empty array when no environments exist", async () => {
      const db = createSequenceDb({ selects: [[]] });
      const svc = environmentService(db);
      const result = await svc.list(COMPANY);
      expect(result).toEqual([]);
    });

    it("returns all environments for the company", async () => {
      const envs = [makeEnv(), makeEnv({ id: "e2", name: "staging" })];
      const db = createSequenceDb({ selects: [envs] });
      const svc = environmentService(db);
      const result = await svc.list(COMPANY);
      expect(result).toHaveLength(2);
      expect(result[0]!.name).toBe("production");
      expect(result[1]!.name).toBe("staging");
    });
  });

  describe("get", () => {
    it("returns the environment when found", async () => {
      const env = makeEnv();
      const db = createSequenceDb({ selects: [[env]] });
      const svc = environmentService(db);
      const result = await svc.get(COMPANY, "e1");
      expect(result).toEqual(env);
    });

    it("returns null when not found", async () => {
      const db = createSequenceDb({ selects: [[]] });
      const svc = environmentService(db);
      const result = await svc.get(COMPANY, "nonexistent");
      expect(result).toBeNull();
    });

    it("calls eq with correct column references and values", async () => {
      const env = makeEnv();
      const db = createSequenceDb({ selects: [[env]] });
      const svc = environmentService(db);
      await svc.get(COMPANY, "e1");
      expect(mockEq).toHaveBeenCalledWith(environments.id, "e1");
      expect(mockEq).toHaveBeenCalledWith(environments.companyId, COMPANY);
    });
  });

  describe("create", () => {
    it("inserts and returns the new environment", async () => {
      const env = makeEnv({ name: "preview", envVars: { PORT: "3000" } });
      const db = createSequenceDb({ inserts: [[env]] });
      const svc = environmentService(db);
      const result = await svc.create(COMPANY, {
        name: "preview",
        envVars: { PORT: "3000" },
      });
      expect(result).toEqual(env);
      expect(result!.name).toBe("preview");
    });

    it("inserts and returns a target-aware environment", async () => {
      const target = { type: "sandbox-docker", image: "node:22-bookworm" };
      const env = makeEnv({ name: "docker", target });
      const db = createSequenceDb({ inserts: [[env]] });
      const svc = environmentService(db);
      const result = await svc.create(COMPANY, {
        name: "docker",
        envVars: {},
        target,
      });
      expect(result).toEqual(env);
      expect(result!.target).toEqual(target);
    });

    it("returns null when insert returns empty (no row)", async () => {
      const db = createSequenceDb({ inserts: [[]] });
      const svc = environmentService(db);
      const result = await svc.create(COMPANY, { name: "preview", envVars: {} });
      expect(result).toBeNull();
    });
  });

  describe("update", () => {
    it("updates fields and returns the updated environment", async () => {
      const updated = makeEnv({ name: "prod-updated" });
      const db = createSequenceDb({ updates: [[updated]] });
      const svc = environmentService(db);
      const result = await svc.update(COMPANY, "e1", { name: "prod-updated" });
      expect(result).toEqual(updated);
      expect(result!.name).toBe("prod-updated");
    });

    it("updates the execution target", async () => {
      const target = { type: "local" };
      const updated = makeEnv({ target });
      const db = createSequenceDb({ updates: [[updated]] });
      const svc = environmentService(db);
      const result = await svc.update(COMPANY, "e1", { target });
      expect(result!.target).toEqual(target);
    });

    it("returns null when environment not found", async () => {
      const db = createSequenceDb({ updates: [[]] });
      const svc = environmentService(db);
      const result = await svc.update(COMPANY, "nonexistent", { name: "x" });
      expect(result).toBeNull();
    });
  });

  describe("delete", () => {
    it("returns the deleted environment when it exists", async () => {
      const env = makeEnv();
      const db = createSequenceDb({ deletes: [[env]] });
      const svc = environmentService(db);
      const result = await svc.delete(COMPANY, "e1");
      expect(result).toEqual(env);
    });

    it("returns null when environment does not exist", async () => {
      const db = createSequenceDb({ deletes: [[]] });
      const svc = environmentService(db);
      const result = await svc.delete(COMPANY, "nonexistent");
      expect(result).toBeNull();
    });

    it("calls eq with correct column references and values", async () => {
      const env = makeEnv();
      const db = createSequenceDb({ deletes: [[env]] });
      const svc = environmentService(db);
      await svc.delete(COMPANY, "e1");
      expect(mockEq).toHaveBeenCalledWith(environments.id, "e1");
      expect(mockEq).toHaveBeenCalledWith(environments.companyId, COMPANY);
    });
  });
});
