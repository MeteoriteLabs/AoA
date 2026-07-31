import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  applyPendingMigrations,
  authUsers,
  createDb,
  organizationMemberships,
  organizations,
  type Db,
} from "@armyofagents/db";
import { organizationAccessService } from "../services/organization-access.js";
import { createSelfServeOrganization } from "../services/organizations.js";
import { allocateEmbeddedPgPort } from "./helpers/embedded-pg-port.js";

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

// To run locally on Windows, temporarily flip this to `describe.skipIf(false)`.
describe.skipIf(process.platform !== "linux")(
  "createSelfServeOrganization — atomicity (real PostgreSQL)",
  () => {
    let db: Db;
    const ownerUserId = `org-tx-owner-${randomUUID()}`;

    beforeAll(async () => {
      dataDir = await mkdtemp(join(tmpdir(), "aoa-org-tx-"));
      const port = await allocateEmbeddedPgPort();
      const { default: EmbeddedPostgres } = (await import("embedded-postgres")) as {
        default: EmbeddedPostgresCtor;
      };
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
      const conn = `postgres://test:test@localhost:${port}/postgres`;
      await applyPendingMigrations(conn);
      db = createDb(conn);
      // organization_memberships.user_id -> "user"(id) FK: seed a real user so the
      // happy-path owner-membership write satisfies the FK.
      const now = new Date();
      await db.insert(authUsers).values({
        id: ownerUserId,
        name: "Org Tx Owner",
        email: `${ownerUserId}@example.test`,
        createdAt: now,
        updatedAt: now,
      });
    }, 180_000);

    afterAll(async () => {
      try { if (pg) await pg.stop(); } catch { /* ignore */ }
      try { if (dataDir) await rm(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }, 60_000);

    it("rolls back the org insert when the owner-membership write fails (no orphan org)", async () => {
      const before = await db.select().from(organizations);
      const throwingFactory = (): Pick<
        ReturnType<typeof organizationAccessService>,
        "ensureOrgOwner"
      > => ({
        ensureOrgOwner: async () => {
          throw new Error("forced membership failure");
        },
      });
      await expect(
        createSelfServeOrganization(db, { name: "Rollback Co", ownerUserId }, throwingFactory),
      ).rejects.toThrow();
      const after = await db.select().from(organizations);
      // Atomicity: the org row inserted inside the tx is rolled back together with
      // the failed membership write — no orphan tenant remains.
      expect(after.length).toBe(before.length);
      expect(after.find((o) => o.name === "Rollback Co")).toBeUndefined();
    });

    it("commits the org row AND the owner membership together on success", async () => {
      const org = await createSelfServeOrganization(
        db,
        { name: "Atomic Co", ownerUserId },
        organizationAccessService,
      );
      const rows = await db.select().from(organizations).where(eq(organizations.id, org.id));
      expect(rows).toHaveLength(1);
      const membership = await db
        .select()
        .from(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, org.id),
            eq(organizationMemberships.userId, ownerUserId),
          ),
        );
      expect(membership).toHaveLength(1);
      expect(membership[0].role).toBe("owner");
      expect(membership[0].status).toBe("active");
    });
  },
);
