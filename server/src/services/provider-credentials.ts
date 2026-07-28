import fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { Db } from "@armyofagents/db";
import {
  agentProviderCredentialBindings,
  internalAgentConfig,
  providerCredentials,
} from "@armyofagents/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { resolveScopedCliAuthHome } from "./cli-auth-topology.js";
import { logActivity } from "./activity-log.js";

type ScopedSubscriptionCredential = {
  companyId: string;
  userId: string;
  provider: "openai" | "anthropic";
  executionTargetId: string;
};

const CREDENTIAL_FILE_BY_PROVIDER = {
  openai: "auth.json",
  anthropic: ".credentials.json",
} as const;

function resolveCredentialHome(
  args: ScopedSubscriptionCredential & { env?: NodeJS.ProcessEnv },
): string {
  return resolveScopedCliAuthHome({
    env: args.env,
    executionTargetId: args.executionTargetId,
    companyId: args.companyId,
    userId: args.userId,
    provider: args.provider,
  });
}

export async function hasSafeScopedSubscriptionEvidence(
  args: ScopedSubscriptionCredential,
): Promise<boolean> {
  const authHome = resolveCredentialHome(args);
  const credentialFile = path.join(
    authHome,
    args.provider === "openai" ? "auth.json" : ".credentials.json",
  );
  return (await readSafeCredentialEvidence(credentialFile)) !== null;
}

/**
 * Return an opaque generation for one regular credential file without ever
 * accepting a symlink. Identity checks around the open close the lstat/open
 * replacement race; the before/after fstat pair rejects a concurrent rewrite.
 */
export async function readSafeCredentialEvidence(file: string): Promise<string | null> {
  const beforeOpen = await fs.lstat(file).catch(() => null);
  if (!beforeOpen?.isFile() || beforeOpen.isSymbolicLink()) return null;
  const noFollow = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
  const handle = await fs.open(file, constants.O_RDONLY | noFollow).catch(() => null);
  if (!handle) return null;
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== beforeOpen.dev || opened.ino !== beforeOpen.ino) {
      return null;
    }
    const contents = await handle.readFile();
    const afterRead = await handle.stat();
    const afterOpen = await fs.lstat(file).catch(() => null);
    if (
      !afterOpen?.isFile() ||
      afterOpen.isSymbolicLink() ||
      afterOpen.dev !== opened.dev ||
      afterOpen.ino !== opened.ino ||
      afterRead.size !== opened.size ||
      afterRead.mtimeMs !== opened.mtimeMs ||
      afterRead.ctimeMs !== opened.ctimeMs
    ) {
      return null;
    }
    return createHash("sha256")
      .update(`${opened.dev}:${opened.ino}:${opened.size}:${opened.mtimeMs}:${opened.ctimeMs}:`)
      .update(contents)
      .digest("hex");
  } finally {
    await handle.close();
  }
}

/**
 * Promote provider-native evidence and approve it for the configured Commander
 * in one transaction. Without the binding, enabling AOA_SCOPED_CLI_AUTH makes
 * the very next heartbeat fail closed with `binding_missing`.
 */
export async function verifyAndBindCommanderSubscriptionCredential(
  db: Db,
  args: ScopedSubscriptionCredential & {
    actorUserId: string;
    allowRevokedReplacement?: boolean;
    expectedEvidence?: string;
    providerProbeVerified?: boolean;
  },
): Promise<{ credentialIds: string[]; bindingIds: string[] }> {
  const authHome = resolveCredentialHome(args);
  const credentialFile = path.join(authHome, CREDENTIAL_FILE_BY_PROVIDER[args.provider]);
  const evidence = await readSafeCredentialEvidence(credentialFile);
  if (!evidence) {
    throw new Error("Scoped provider credential evidence is missing or unsafe");
  }
  if (args.expectedEvidence !== evidence && args.providerProbeVerified !== true) {
    throw new Error("Fresh challenge evidence or a successful provider probe is required");
  }

  return db.transaction(async (tx) => {
    const txDb = tx as unknown as Db;
    const now = new Date();
    const [existing] = await txDb
      .select({ state: providerCredentials.state })
      .from(providerCredentials)
      .where(
        and(
          eq(providerCredentials.companyId, args.companyId),
          eq(providerCredentials.provider, args.provider),
          eq(providerCredentials.ownerUserId, args.userId),
          eq(providerCredentials.executionTargetId, args.executionTargetId),
          eq(providerCredentials.kind, "personal_subscription"),
        ),
      )
      .limit(1);
    if (
      existing &&
      (existing.state === "revoked" || existing.state === "suspended") &&
      !args.allowRevokedReplacement
    ) {
      throw new Error("Revoked or suspended credentials require a fresh provider login");
    }
    const [credential] = await txDb
      .insert(providerCredentials)
      .values({
        companyId: args.companyId,
        provider: args.provider,
        ownerUserId: args.userId,
        executionTargetId: args.executionTargetId,
        kind: "personal_subscription",
        state: "verified",
        verifiedAt: now,
        revokedAt: null,
        suspendedAt: null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          providerCredentials.companyId,
          providerCredentials.provider,
          providerCredentials.ownerUserId,
          providerCredentials.executionTargetId,
          providerCredentials.kind,
        ],
        set: {
          state: "verified",
          verifiedAt: now,
          revokedAt: null,
          suspendedAt: null,
          updatedAt: now,
        },
      })
      .returning({ id: providerCredentials.id });
    if (!credential) {
      throw new Error("Provider credential finalization returned no credential");
    }
    const credentialIds = [credential.id];

    const [commander] = await txDb
      .select({ agentId: internalAgentConfig.agentId })
      .from(internalAgentConfig)
      .where(eq(internalAgentConfig.companyId, args.companyId))
      .limit(1);
    const agentId = commander?.agentId ?? null;
    if (!agentId) {
      throw new Error("Cannot bind subscription credential without a Commander");
    }
    const bindingIds: string[] = [];

    await txDb.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`provider-binding:${args.companyId}:${agentId}:${args.provider}`}))`,
    );
    const active = await txDb
      .select({
        id: agentProviderCredentialBindings.id,
        credentialId: agentProviderCredentialBindings.credentialId,
      })
      .from(agentProviderCredentialBindings)
      .innerJoin(
        providerCredentials,
        eq(agentProviderCredentialBindings.credentialId, providerCredentials.id),
      )
      .where(
        and(
          eq(agentProviderCredentialBindings.companyId, args.companyId),
          eq(agentProviderCredentialBindings.agentId, agentId),
          eq(providerCredentials.provider, args.provider),
          isNull(agentProviderCredentialBindings.revokedAt),
        ),
      );
    for (const binding of active) {
      if (credentialIds.includes(binding.credentialId)) continue;
      await txDb
        .update(agentProviderCredentialBindings)
        .set({ revokedAt: now, updatedAt: now })
        .where(eq(agentProviderCredentialBindings.id, binding.id));
    }
    for (const credentialId of credentialIds) {
      const [binding] = await txDb
        .insert(agentProviderCredentialBindings)
        .values({
          companyId: args.companyId,
          agentId,
          credentialId,
          approvedByUserId: args.actorUserId,
          approvedAt: now,
          revokedAt: null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            agentProviderCredentialBindings.agentId,
            agentProviderCredentialBindings.credentialId,
          ],
          set: {
            approvedByUserId: args.actorUserId,
            approvedAt: now,
            revokedAt: null,
            updatedAt: now,
          },
        })
        .returning({ id: agentProviderCredentialBindings.id });
      if (binding) bindingIds.push(binding.id);
    }
    if (bindingIds.length !== credentialIds.length) {
      throw new Error("Provider credential finalization returned no Commander binding");
    }

    await logActivity(txDb, {
      companyId: args.companyId,
      actorType: "user",
      actorId: args.actorUserId,
      action: "commander.subscription.verified",
      entityType: "provider_credential",
      entityId: credentialIds[0]!,
      agentId,
      details: {
        provider: args.provider,
        executionTargetId: args.executionTargetId,
        credentialIds,
        bindingIds,
      },
    });
    return { credentialIds, bindingIds };
  });
}

export async function removeScopedSubscriptionCredentialHome(
  args: ScopedSubscriptionCredential & { env?: NodeJS.ProcessEnv },
): Promise<boolean> {
  const root = path.resolve(
    args.env?.AOA_HOME?.trim() || process.env.AOA_HOME?.trim() || path.join(os.homedir(), ".aoa"),
  );
  const authHome = resolveCredentialHome({ ...args, env: { ...process.env, ...args.env, AOA_HOME: root } });
  const entry = await fs.lstat(authHome).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!entry) return false;
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new Error("Credential home is not a regular scoped directory");
  }
  const [realRoot, realHome] = await Promise.all([fs.realpath(root), fs.realpath(authHome)]);
  const expectedParent = path.join(realRoot, "execution-targets");
  if (
    realHome === realRoot ||
    !realHome.startsWith(`${expectedParent}${path.sep}`) ||
    path.basename(realHome) !== args.provider
  ) {
    throw new Error("Credential home escapes the configured AOA data root");
  }
  await fs.rm(realHome, { recursive: true, force: false });
  return true;
}
