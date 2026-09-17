import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { allocateEmbeddedPgPort } from "./helpers/embedded-pg-port.js";
import {
  applyPendingMigrations,
  companies,
  createDb,
  universeLayouts,
  universeLayoutOperations,
  type Db,
} from "@armyofagents/db";
import { insertTestCompany } from "./helpers/insert-test-company.js";
import {
  universeLayoutService,
  type UniverseScope,
} from "../services/universe-layout.js";

/**
 * Real-Postgres proof of the revisioned universe-layout service — the parts a
 * Drizzle mock can't cover: the migration actually creates both tables + FKs +
 * unique indexes, the atomic apply() bumps a revision and journals a receipt,
 * revision gating + receipt dedup give exactly one ack per operation id, layouts
 * are isolated per (company, user, conversation), and deleting a company cascades
 * to its layout + operation rows.
 *
 * Embedded-postgres harness (matches home-board-layout.integration.test.ts). The
 * whole suite (boot included) skips on Windows per Issue #114; on Linux a boot
 * failure throws and reddens the suite (fail-closed) — it never silently skips.
 * To run locally on Windows, temporarily flip to `describe.skipIf(false)`.
 */
type EmbeddedPostgresInstance = {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
};
type EmbeddedPostgresCtor = new (opts: {
  databaseDir: string;
  user: string;
  password: string;
  port: number;
  persistent: boolean;
  initdbFlags?: string[];
}) => EmbeddedPostgresInstance;

let pg: EmbeddedPostgresInstance | null = null;
let dataDir = "";

const rect = { x: 10, y: 20, width: 300, height: 200 };
const openOp = (key: string, title = key) => ({
  type: "open" as const,
  key,
  ref: { kind: "task" as const, id: key },
  rect,
  title,
});

describe.skipIf(process.platform === "win32")(
  "universe layout persistence (real PostgreSQL)",
  () => {
    let db: Db;
    let svc: ReturnType<typeof universeLayoutService>;
    const companyA = randomUUID();
    const companyB = randomUUID();
    const userA = `universe-user-a-${randomUUID()}`;
    const userB = `universe-user-b-${randomUUID()}`;
    const freshScope = (companyId = companyA, userId = userA): UniverseScope => ({
      companyId,
      userId,
      conversationId: `conv-${randomUUID()}`,
    });

    beforeAll(async () => {
      dataDir = await mkdtemp(join(tmpdir(), "aoa-universe-layout-integ-"));
      const port = await allocateEmbeddedPgPort();
      const { default: EmbeddedPostgres } = (await import(
        "embedded-postgres"
      )) as { default: EmbeddedPostgresCtor };
      pg = new EmbeddedPostgres({
        databaseDir: join(dataDir, "db"),
        user: "test",
        password: "test",
        port,
        persistent: false,
        initdbFlags: ["--encoding=UTF8", "--locale=C"],
      });
      await pg.initialise();
      await pg.start();
      const connectionString = `postgres://test:test@localhost:${port}/postgres`;
      await applyPendingMigrations(connectionString);
      db = createDb(connectionString);
      svc = universeLayoutService(db);
      const suffix = () => Math.floor(Math.random() * 9000 + 1000);
      await insertTestCompany(db, {
        id: companyA,
        name: "Universe A",
        issuePrefix: `UNA${suffix()}`,
      });
      await insertTestCompany(db, {
        id: companyB,
        name: "Universe B",
        issuePrefix: `UNB${suffix()}`,
      });
    }, 180_000);

    afterAll(async () => {
      await pg?.stop();
      if (dataDir) await rm(dataDir, { recursive: true, force: true });
    });

    it("get returns an empty document at revision 0 before any write", async () => {
      const snap = await svc.get(freshScope());
      expect(snap.revision).toBe(0);
      expect(snap.document.panels).toHaveLength(0);
    });

    it("apply opens a panel, bumps the revision and reads back the document", async () => {
      const scope = freshScope();
      const ack = await svc.apply(scope, {
        schemaVersion: 1,
        operationId: randomUUID(),
        expectedRevision: 0,
        operations: [openOp("k1", "First")],
      });
      expect(ack.revision).toBe(1);
      const snap = await svc.get(scope);
      expect(snap.revision).toBe(1);
      expect(snap.document.panels).toHaveLength(1);
      expect(snap.document.panels[0]).toMatchObject({
        key: "k1",
        title: "First",
        ref: { companyId: scope.companyId, kind: "task", id: "k1" },
      });
      expect(snap.document.order).toEqual(["k1"]);
    });

    it("a second revision-zero write yields exactly one ack and one conflict", async () => {
      const scope = freshScope();
      const ack = await svc.apply(scope, {
        schemaVersion: 1,
        operationId: randomUUID(),
        expectedRevision: 0,
        operations: [openOp("k1")],
      });
      expect(ack.revision).toBe(1);
      await expect(
        svc.apply(scope, {
          schemaVersion: 1,
          operationId: randomUUID(),
          expectedRevision: 0,
          operations: [openOp("k2")],
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect((await svc.get(scope)).revision).toBe(1);
    });

    it("replaying a patch returns the original ack; a changed payload under a reused id conflicts", async () => {
      const scope = freshScope();
      const patch = {
        schemaVersion: 1,
        operationId: randomUUID(),
        expectedRevision: 0,
        operations: [openOp("k1", "Original")],
      };
      const ack = await svc.apply(scope, patch);
      expect(await svc.apply(scope, patch)).toEqual(ack);
      await expect(
        svc.apply(scope, { ...patch, operations: [openOp("k1", "Changed")] }),
      ).rejects.toMatchObject({ status: 409 });
      expect((await svc.get(scope)).revision).toBe(1);
      const receipt = await svc.getReceipt(scope, patch.operationId);
      expect(receipt).toEqual(ack);
    });

    it("layouts and receipts are isolated per owner and per company", async () => {
      const conversationId = `shared-${randomUUID()}`;
      const scopeA: UniverseScope = { companyId: companyA, userId: userA, conversationId };
      const patch = {
        schemaVersion: 1,
        operationId: randomUUID(),
        expectedRevision: 0,
        operations: [openOp("k1")],
      };
      await svc.apply(scopeA, patch);

      const otherUser: UniverseScope = { companyId: companyA, userId: userB, conversationId };
      const otherCompany: UniverseScope = { companyId: companyB, userId: userA, conversationId };
      for (const scope of [otherUser, otherCompany]) {
        expect((await svc.get(scope)).revision).toBe(0);
        expect((await svc.get(scope)).document.panels).toHaveLength(0);
        // A receipt is reachable only through its own authorized parent layout.
        expect(await svc.getReceipt(scope, patch.operationId)).toBeNull();
      }
      expect((await svc.get(scopeA)).document.panels).toHaveLength(1);
    });

    it("deleting a company cascades to its universe layouts and operation receipts", async () => {
      const cascadeCompany = randomUUID();
      await insertTestCompany(db, {
        id: cascadeCompany,
        name: "Universe Cascade",
        issuePrefix: `UNC${Math.floor(Math.random() * 9000 + 1000)}`,
      });
      const scope: UniverseScope = {
        companyId: cascadeCompany,
        userId: userA,
        conversationId: `conv-${randomUUID()}`,
      };
      await svc.apply(scope, {
        schemaVersion: 1,
        operationId: randomUUID(),
        expectedRevision: 0,
        operations: [openOp("k1")],
      });
      expect(
        await db
          .select()
          .from(universeLayouts)
          .where(eq(universeLayouts.companyId, cascadeCompany)),
      ).toHaveLength(1);

      await db.delete(companies).where(eq(companies.id, cascadeCompany));

      expect(
        await db
          .select()
          .from(universeLayouts)
          .where(eq(universeLayouts.companyId, cascadeCompany)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(universeLayoutOperations)
          .where(and(eq(universeLayoutOperations.companyId, cascadeCompany))),
      ).toHaveLength(0);
    });
  },
);
