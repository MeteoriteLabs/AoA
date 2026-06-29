import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { hubItemsService } from "../services/hub-items.js";

const mockPerms = vi.hoisted(() => ({
  getEffectiveRole: vi.fn(),
  getTeamLeadDepartments: vi.fn(),
}));

vi.mock("../services/permissions.js", () => ({
  permissionService: () => mockPerms,
}));

function makeSelectChain(rows: unknown[], captured: { where: unknown[] }) {
  const chain = {
    from: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    where: vi.fn((condition: unknown) => {
      captured.where.push(condition);
      return chain;
    }),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(rows)),
    then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return chain;
}

function makeDb(rows: unknown[] = []) {
  const captured = { where: [] as unknown[] };
  const db = {
    select: vi.fn(() => makeSelectChain(rows, captured)),
  };
  return { db, captured };
}

function renderWhere(condition: unknown) {
  return new PgDialect().sqlToQuery(condition as never).sql.toLowerCase();
}

describe("hubItems lifecycle query semantics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPerms.getEffectiveRole.mockResolvedValue("founder");
    mockPerms.getTeamLeadDepartments.mockResolvedValue([]);
  });

  it("default query hides dismissed and future-snoozed rows for the current user", async () => {
    const { db, captured } = makeDb();
    const svc = hubItemsService(db as never);

    await svc.query("company-1", { actorUserId: "alice", role: "founder" });

    const whereSql = renderWhere(captured.where[0]);
    expect(whereSql).toContain('"hub_item_user_state"."dismissed_at" is null');
    expect(whereSql).toContain('"hub_item_user_state"."snoozed_until" is null');
    expect(whereSql).toContain('"hub_item_user_state"."snoozed_until" <=');
  });

  it("includeSnoozed=true keeps future-snoozed rows in explicit list queries", async () => {
    const { db, captured } = makeDb();
    const svc = hubItemsService(db as never);

    await svc.query("company-1", {
      actorUserId: "alice",
      role: "founder",
      includeSnoozed: true,
    } as never);

    const whereSql = renderWhere(captured.where[0]);
    expect(whereSql).toContain('"hub_item_user_state"."dismissed_at" is null');
    expect(whereSql).not.toContain('"hub_item_user_state"."snoozed_until"');
  });

  it("counts use the same dismissed and future-snoozed visibility filters as the default list", async () => {
    const { db, captured } = makeDb([{ open: 0, unread: 0 }]);
    const svc = hubItemsService(db as never);

    await svc.counts("company-1", "alice", "founder");

    const whereSql = renderWhere(captured.where[0]);
    expect(whereSql).toContain('"hub_item_user_state"."dismissed_at" is null');
    expect(whereSql).toContain('"hub_item_user_state"."snoozed_until" is null');
    expect(whereSql).toContain('"hub_item_user_state"."snoozed_until" <=');
  });
});
