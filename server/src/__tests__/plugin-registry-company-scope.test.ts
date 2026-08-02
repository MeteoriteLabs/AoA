import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Db } from "@armyofagents/db";
import { pluginRegistryService } from "../services/plugin-registry.js";

const dialect = new PgDialect();

function capturingDb(rows: unknown[] = []) {
  const captured: Array<{ whereSql: string | null }> = [];
  const db = {
    select() {
      const record = { whereSql: null as string | null };
      captured.push(record);
      const resolved = Promise.resolve(rows);
      const chain: Record<string, any> = {
        from() { return chain; },
        where(condition: unknown) {
          record.whereSql = condition == null ? null : dialect.sqlToQuery(condition as never).sql;
          return chain;
        },
        orderBy() { return chain; },
        then(onFulfilled: (value: unknown[]) => unknown, onRejected?: (reason: unknown) => unknown) {
          return resolved.then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  } as unknown as Db;
  return { db, captured };
}

describe("plugin registry company-scope pushdown", () => {
  it("short-circuits an empty company set without querying", async () => {
    const { db, captured } = capturingDb();

    await expect(pluginRegistryService(db).listInstalledForCompanies([])).resolves.toEqual([]);

    expect(captured).toHaveLength(0);
  });

  it("pushes the accessible company set into installed-list SQL", async () => {
    const { db, captured } = capturingDb();

    await pluginRegistryService(db).listInstalledForCompanies(["company-a", "company-b"]);

    expect(captured[0]?.whereSql).toContain('"plugins"."company_id" in (');
    expect(captured[0]?.whereSql).toContain('"plugins"."status" <>');
  });

  it("pushes both company and lifecycle status into filtered-list SQL", async () => {
    const { db, captured } = capturingDb();

    await pluginRegistryService(db).listByStatusForCompanies("ready", ["company-a"]);

    expect(captured[0]?.whereSql).toContain('"plugins"."company_id" in (');
    expect(captured[0]?.whereSql).toContain('"plugins"."status" =');
  });

  it("preserves the unscoped self-hosted query without a company predicate", async () => {
    const { db, captured } = capturingDb();

    await pluginRegistryService(db).listInstalledForCompanies(undefined);

    expect(captured[0]?.whereSql).toContain('"plugins"."status" <>');
    expect(captured[0]?.whereSql).not.toContain('"plugins"."company_id" in (');
  });
});
