import { describe, it, expect, vi } from "vitest";

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

vi.mock("drizzle-orm", () => ({
  and: (..._args: unknown[]) => "and",
  eq: (..._args: unknown[]) => "eq",
}));

import { environmentsService } from "../services/environments.js";

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
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("environmentsService", () => {
  describe("list", () => {
    it("returns empty array when no environments exist", async () => {
      const db = createSequenceDb({ selects: [[]] });
      const svc = environmentsService(db);
      const result = await svc.list(COMPANY);
      expect(result).toEqual([]);
    });

    it("returns all environments for the company", async () => {
      const envs = [makeEnv(), makeEnv({ id: "e2", name: "staging" })];
      const db = createSequenceDb({ selects: [envs] });
      const svc = environmentsService(db);
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
      const svc = environmentsService(db);
      const result = await svc.get(COMPANY, "e1");
      expect(result).toEqual(env);
    });

    it("returns null when not found", async () => {
      const db = createSequenceDb({ selects: [[]] });
      const svc = environmentsService(db);
      const result = await svc.get(COMPANY, "nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("create", () => {
    it("inserts and returns the new environment", async () => {
      const env = makeEnv({ name: "preview", envVars: { PORT: "3000" } });
      const db = createSequenceDb({ inserts: [[env]] });
      const svc = environmentsService(db);
      const result = await svc.create(COMPANY, {
        name: "preview",
        envVars: { PORT: "3000" },
      });
      expect(result).toEqual(env);
      expect(result!.name).toBe("preview");
    });
  });

  describe("update", () => {
    it("updates fields and returns the updated environment", async () => {
      const updated = makeEnv({ name: "prod-updated" });
      const db = createSequenceDb({ updates: [[updated]] });
      const svc = environmentsService(db);
      const result = await svc.update(COMPANY, "e1", { name: "prod-updated" });
      expect(result).toEqual(updated);
      expect(result!.name).toBe("prod-updated");
    });

    it("returns null when environment not found", async () => {
      const db = createSequenceDb({ updates: [[]] });
      const svc = environmentsService(db);
      const result = await svc.update(COMPANY, "nonexistent", { name: "x" });
      expect(result).toBeNull();
    });
  });

  describe("delete", () => {
    it("resolves without error when environment exists", async () => {
      const db = createSequenceDb({ deletes: [[]] });
      const svc = environmentsService(db);
      await expect(svc.delete(COMPANY, "e1")).resolves.toBeUndefined();
    });

    it("resolves without error when environment does not exist", async () => {
      const db = createSequenceDb({ deletes: [[]] });
      const svc = environmentsService(db);
      await expect(svc.delete(COMPANY, "nonexistent")).resolves.toBeUndefined();
    });
  });
});
