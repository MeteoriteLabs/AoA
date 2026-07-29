import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Db } from "@armyofagents/db";
import { afterEach, describe, expect, it, vi } from "vitest";

const logActivity = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../services/activity-log.js", () => ({ logActivity }));

import { resolveScopedCliAuthHome } from "../services/cli-auth-topology.js";
import {
  readSafeCredentialEvidence,
  verifyAndBindCommanderSubscriptionCredential,
} from "../services/provider-credentials.js";

const cleanupRoots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  logActivity.mockReset();
  logActivity.mockResolvedValue(undefined);
  await Promise.all(
    cleanupRoots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

async function credentialFixture() {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "aoa-credential-finalize-")
  );
  cleanupRoots.push(root);
  vi.stubEnv("AOA_HOME", root);
  const args = {
    companyId: "company-1",
    userId: "user-1",
    provider: "openai" as const,
    executionTargetId: "target-1",
    actorUserId: "user-1",
  };
  const authHome = resolveScopedCliAuthHome({
    ...args,
    env: process.env,
  });
  const credentialFile = path.join(authHome, "auth.json");
  await fs.mkdir(authHome, { recursive: true });
  await fs.writeFile(credentialFile, '{"tokens":"redacted"}');
  const evidence = await readSafeCredentialEvidence(credentialFile);
  if (!evidence) throw new Error("test credential evidence was not readable");
  return { args, credentialFile, evidence };
}

type FakeDbOptions = {
  existingState?: string | null;
  commanderAgentId?: string | null;
  activeBindings?: Array<{ id: string; credentialId: string }>;
  credentialId?: string | null;
  bindingId?: string | null;
};

function fakeDb(options: FakeDbOptions = {}) {
  const selectResults: unknown[][] = [
    options.existingState ? [{ state: options.existingState }] : [],
    options.commanderAgentId === null
      ? []
      : [{ agentId: options.commanderAgentId ?? "commander-1" }],
    options.activeBindings ?? [],
  ];
  const insertResults: unknown[][] = [
    options.credentialId === null
      ? []
      : [{ id: options.credentialId ?? "credential-1" }],
    options.bindingId === null
      ? []
      : [{ id: options.bindingId ?? "binding-1" }],
  ];
  const insertedValues: Array<Record<string, unknown>> = [];
  const stagedMutations: string[] = [];
  const committedMutations: string[] = [];
  let rolledBack = false;

  const tx = {
    select: vi.fn(() => {
      const result = selectResults.shift() ?? [];
      const awaitedWhere = {
        limit: vi.fn(async () => result),
        then: <TResult1 = unknown[], TResult2 = never>(
          onfulfilled?:
            | ((value: unknown[]) => TResult1 | PromiseLike<TResult1>)
            | null,
          onrejected?:
            | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
            | null
        ) => Promise.resolve(result).then(onfulfilled, onrejected),
      };
      const chain = {
        from: () => chain,
        innerJoin: () => chain,
        where: () => awaitedWhere,
      };
      return chain;
    }),
    insert: vi.fn(() => ({
      values: (values: Record<string, unknown>) => {
        insertedValues.push(values);
        return {
          onConflictDoUpdate: () => ({
            returning: async () => {
              stagedMutations.push("insert");
              return insertResults.shift() ?? [];
            },
          }),
        };
      },
    })),
    update: vi.fn(() => ({
      set: () => ({
        where: async () => {
          stagedMutations.push("update");
          return [];
        },
      }),
    })),
    execute: vi.fn(async () => {
      stagedMutations.push("lock");
    }),
  };

  const db = {
    transaction: vi.fn(async <T>(callback: (transaction: typeof tx) => Promise<T>) => {
      try {
        const value = await callback(tx);
        committedMutations.push(...stagedMutations);
        return value;
      } catch (error) {
        rolledBack = true;
        throw error;
      }
    }),
  };

  return {
    db: db as unknown as Db,
    tx,
    insertedValues,
    committedMutations,
    get rolledBack() {
      return rolledBack;
    },
  };
}

describe("Commander subscription credential finalization", () => {
  it("verifies fresh evidence, replaces stale bindings, binds Commander, and audits atomically", async () => {
    const fixture = await credentialFixture();
    const harness = fakeDb({
      activeBindings: [{ id: "old-binding", credentialId: "old-credential" }],
    });

    await expect(
      verifyAndBindCommanderSubscriptionCredential(harness.db, {
        ...fixture.args,
        expectedEvidence: fixture.evidence,
      })
    ).resolves.toEqual({
      credentialIds: ["credential-1"],
      bindingIds: ["binding-1"],
    });

    expect(harness.tx.execute).toHaveBeenCalledOnce();
    expect(harness.tx.update).toHaveBeenCalledOnce();
    expect(harness.insertedValues[1]).toMatchObject({
      companyId: "company-1",
      agentId: "commander-1",
      credentialId: "credential-1",
      approvedByUserId: "user-1",
    });
    expect(logActivity).toHaveBeenCalledWith(
      harness.tx,
      expect.objectContaining({
        action: "commander.subscription.verified",
        entityId: "credential-1",
        agentId: "commander-1",
      })
    );
    expect(harness.rolledBack).toBe(false);
    expect(harness.committedMutations).toContain("insert");
  });

  it("rejects missing or stale evidence before opening a transaction", async () => {
    const fixture = await credentialFixture();
    const staleHarness = fakeDb();
    await expect(
      verifyAndBindCommanderSubscriptionCredential(staleHarness.db, {
        ...fixture.args,
        expectedEvidence: "stale-generation",
      })
    ).rejects.toThrow(/fresh challenge evidence/i);
    expect(
      (staleHarness.db as unknown as { transaction: ReturnType<typeof vi.fn> })
        .transaction
    ).not.toHaveBeenCalled();

    await fs.rm(fixture.credentialFile);
    const missingHarness = fakeDb();
    await expect(
      verifyAndBindCommanderSubscriptionCredential(missingHarness.db, {
        ...fixture.args,
        expectedEvidence: fixture.evidence,
      })
    ).rejects.toThrow(/missing or unsafe/i);
    expect(
      (missingHarness.db as unknown as {
        transaction: ReturnType<typeof vi.fn>;
      }).transaction
    ).not.toHaveBeenCalled();
  });

  it.each(["revoked", "suspended"])(
    "requires a fresh provider login before replacing a %s credential",
    async (state) => {
      const fixture = await credentialFixture();
      const harness = fakeDb({ existingState: state });

      await expect(
        verifyAndBindCommanderSubscriptionCredential(harness.db, {
          ...fixture.args,
          expectedEvidence: fixture.evidence,
        })
      ).rejects.toThrow(/fresh provider login/i);
      expect(harness.rolledBack).toBe(true);
      expect(harness.committedMutations).toEqual([]);
    }
  );

  it("rolls back credential promotion when Commander or binding creation is unavailable", async () => {
    const fixture = await credentialFixture();
    const noCommander = fakeDb({ commanderAgentId: null });
    await expect(
      verifyAndBindCommanderSubscriptionCredential(noCommander.db, {
        ...fixture.args,
        expectedEvidence: fixture.evidence,
      })
    ).rejects.toThrow(/without a Commander/i);
    expect(noCommander.rolledBack).toBe(true);
    expect(noCommander.committedMutations).toEqual([]);

    const noBinding = fakeDb({ bindingId: null });
    await expect(
      verifyAndBindCommanderSubscriptionCredential(noBinding.db, {
        ...fixture.args,
        expectedEvidence: fixture.evidence,
      })
    ).rejects.toThrow(/no Commander binding/i);
    expect(noBinding.rolledBack).toBe(true);
    expect(noBinding.committedMutations).toEqual([]);
  });

  it("rolls back credential and binding mutations when the required audit write fails", async () => {
    const fixture = await credentialFixture();
    const harness = fakeDb();
    logActivity.mockRejectedValueOnce(new Error("audit unavailable"));

    await expect(
      verifyAndBindCommanderSubscriptionCredential(harness.db, {
        ...fixture.args,
        expectedEvidence: fixture.evidence,
      })
    ).rejects.toThrow("audit unavailable");
    expect(harness.rolledBack).toBe(true);
    expect(harness.committedMutations).toEqual([]);
  });
});
