import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { hubItemsService } from "../services/hub-items.js";
import { publishLiveEvent } from "../services/live-events.js";

const mockPerms = vi.hoisted(() => ({
  getEffectiveRole: vi.fn(),
  getTeamLeadDepartments: vi.fn(),
}));

const mockCounterSnapshots = vi.hoisted(() => ({
  invalidateUser: vi.fn(),
  invalidateCompany: vi.fn(),
}));

vi.mock("../services/live-events.js", () => ({
  publishLiveEvent: vi.fn(),
}));

vi.mock("../services/permissions.js", () => ({
  permissionService: () => mockPerms,
}));

vi.mock("../services/hub-counter-snapshots.js", () => ({
  hubCounterSnapshotsService: () => mockCounterSnapshots,
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

function encodeTestCursor(createdAt: string, id: string) {
  return Buffer.from(JSON.stringify({ createdAt, id }), "utf8").toString("base64url");
}

function makeDb(rows: unknown[] = []) {
  const captured = { where: [] as unknown[] };
  const db = {
    select: vi.fn(() => makeSelectChain(rows, captured)),
  };
  return { db, captured };
}

function makeInsertChain(rows: unknown[]) {
  const chain = {
    values: vi.fn(() => chain),
    onConflictDoUpdate: vi.fn(() => chain),
    returning: vi.fn(() => Promise.resolve(rows)),
  };
  return chain;
}

function makeUpdateChain(rows: unknown[]) {
  const chain = {
    set: vi.fn(() => chain),
    where: vi.fn(() => chain),
    returning: vi.fn(() => Promise.resolve(rows)),
  };
  return chain;
}

function renderWhere(condition: unknown) {
  return new PgDialect().sqlToQuery(condition as never).sql.toLowerCase();
}

function renderWhereQuery(condition: unknown) {
  return new PgDialect().sqlToQuery(condition as never);
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

  it("query searches title, summary, source, scope, and semantic fields with escaped LIKE", async () => {
    const { db, captured } = makeDb();
    const svc = hubItemsService(db as never);

    await svc.query("company-1", {
      actorUserId: "alice",
      role: "founder",
      q: String.raw`100%_ready\ship`,
    } as never);

    const where = renderWhereQuery(captured.where[0]);
    const whereSql = where.sql.toLowerCase();
    expect(whereSql).toContain('lower("notifications"."title") like');
    expect(whereSql).toContain('lower("notifications"."summary") like');
    expect(whereSql).toContain('lower("notifications"."source_type") like');
    expect(whereSql).toContain('lower("notifications"."scope_key") like');
    expect(whereSql).toContain('lower("notifications"."semantic_type") like');
    expect(whereSql).toContain("escape '\\'");
    expect(where.params).toContain(String.raw`%100\%\_ready\\ship%`);
  });

  it("query applies stable keyset cursor predicates", async () => {
    const { db, captured } = makeDb();
    const svc = hubItemsService(db as never);

    await svc.query("company-1", {
      actorUserId: "alice",
      role: "founder",
      cursor: encodeTestCursor("2026-06-30T00:00:00.000Z", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
    } as never);

    const whereSql = renderWhere(captured.where[0]);
    expect(whereSql).toContain('"notifications"."created_at" <');
    expect(whereSql).toContain('"notifications"."created_at" =');
    expect(whereSql).toContain('"notifications"."id" <');
  });

  it("invalidates the actor snapshot after personal state changes", async () => {
    const insertChain = makeInsertChain([{ id: "state-1" }]);
    const { db } = makeDb([
      {
        item: {
          id: "hub-1",
          companyId: "company-1",
          semanticType: "approval_request",
          status: "open",
          scopeKey: null,
          sourceType: null,
          groupKey: null,
          slaAt: null,
        },
        readAt: null,
        snoozedUntil: null,
        dismissedAt: null,
      },
    ]);
    Object.assign(db, { insert: vi.fn(() => insertChain) });
    const svc = hubItemsService(db as never);

    await svc.applyPersonalState({
      companyId: "company-1",
      hubItemId: "hub-1",
      actorUserId: "user-1",
      role: "founder",
      state: { kind: "dismiss" },
    });

    expect(mockCounterSnapshots.invalidateUser).toHaveBeenCalledWith("company-1", "user-1");
    expect(publishLiveEvent).toHaveBeenCalledWith({
      companyId: "company-1",
      type: "hub.counts.changed",
      payload: { reason: "personal_state_changed" },
    });
  });

  it("invalidates company snapshots after shared lifecycle actions", async () => {
    const current = {
      id: "hub-1",
      companyId: "company-1",
      semanticType: "approval_request",
      status: "open",
      version: 1,
      resolvedAt: null,
      archivedAt: null,
      claimedByUserId: null,
      claimedAt: null,
      ownerPool: null,
    };
    const tx = {
      update: vi.fn(() => makeUpdateChain([{ ...current, status: "resolved", version: 2 }])),
      insert: vi
        .fn()
        .mockReturnValueOnce(makeInsertChain([
          { id: "audit-1", undoDeadline: new Date("2026-06-30T10:00:08.000Z") },
        ]))
        .mockReturnValueOnce(makeInsertChain([])),
    };
    const db = {
      select: vi.fn(() => makeSelectChain([current], { where: [] })),
      transaction: vi.fn((callback: (tx: unknown) => Promise<unknown>) => callback(tx)),
    };
    const svc = hubItemsService(db as never);

    await svc.recordLifecycleAction({
      companyId: "company-1",
      hubItemId: "hub-1",
      action: "resolve",
      expectedVersion: 1,
      actorType: "user",
      actorId: "user-1",
      actorIsFounder: true,
      authorityBasis: "founder",
    });

    expect(mockCounterSnapshots.invalidateCompany).toHaveBeenCalledWith("company-1");
    expect(publishLiveEvent).toHaveBeenCalledWith({
      companyId: "company-1",
      type: "hub.item.changed",
      payload: {
        itemId: "hub-1",
        semanticType: "approval_request",
        lane: "waiting_on_you",
        status: "resolved",
        version: 2,
        change: "resolved",
      },
    });
    expect(publishLiveEvent).toHaveBeenCalledWith({
      companyId: "company-1",
      type: "hub.counts.changed",
      payload: { reason: "item_changed" },
    });
  });
});
