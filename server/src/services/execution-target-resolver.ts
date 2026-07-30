// server/src/services/execution-target-resolver.ts
import type { Db } from "@armyofagents/db";
import { executionTargets } from "@armyofagents/db";

export interface ExecutionTargetRow {
  id: string;
  slug: string;
  kind: string;
  trustClass: string;
  status: string;
  organizationId: string | null;
  config?: Record<string, unknown>;
}

// `credentialKind` + `executionTargetSlug` are P4's normalized seam field names.
export function chooseExecutionTargetRow(input: {
  credentialKind: "company_api_key" | "personal_subscription" | null;
  pinnedTargetId: string | null;
  executionTargetSlug: string | null;
  targets: ExecutionTargetRow[];
}): ExecutionTargetRow | null {
  const active = input.targets.filter((t) => t.status === "active");
  if (input.pinnedTargetId) {
    const pinned = active.find((t) => t.id === input.pinnedTargetId);
    if (!pinned) throw new Error(`Pinned execution target ${input.pinnedTargetId} is not available.`);
    if (input.credentialKind === "personal_subscription" && input.executionTargetSlug && pinned.slug !== input.executionTargetSlug) {
      throw new Error("Pinned target does not match the subscription credential's execution target.");
    }
    return pinned;
  }
  if (input.credentialKind === "personal_subscription") {
    if (!input.executionTargetSlug) throw new Error("Personal subscription run has no bound execution target.");
    const match = active.find((t) => t.slug === input.executionTargetSlug && (t.kind === "dedicated_worker" || t.kind === "local_host"));
    if (!match) throw new Error(`No dedicated execution target matches credential target "${input.executionTargetSlug}".`);
    return match;
  }
  // company_api_key (business key) -> shared pool
  const pool = active.find((t) => t.kind === "pooled_gvisor");
  return pool ?? null; // null => caller falls back to local (self-hosted single tenant)
}

export async function resolveExecutionTargetForRun(
  db: Db,
  input: {
    organizationId: string | null;
    companyId: string;
    // credentialKind + executionTargetSlug come straight off P4's resolver seam.
    credentialKind: "company_api_key" | "personal_subscription" | null;
    pinnedTargetId: string | null;
    executionTargetSlug: string | null;
  },
): Promise<ExecutionTargetRow | null> {
  // System/shared targets (organizationId null) + this org's targets are both eligible.
  const rows = (await db
    .select({
      id: executionTargets.id,
      slug: executionTargets.slug,
      kind: executionTargets.kind,
      trustClass: executionTargets.trustClass,
      status: executionTargets.status,
      organizationId: executionTargets.organizationId,
      config: executionTargets.config,
    })
    .from(executionTargets)) as ExecutionTargetRow[];
  const scoped = rows.filter((t) => t.organizationId == null || t.organizationId === input.organizationId);
  return chooseExecutionTargetRow({
    credentialKind: input.credentialKind,
    pinnedTargetId: input.pinnedTargetId,
    executionTargetSlug: input.executionTargetSlug,
    targets: scoped,
  });
}

const HARDENED_ISOLATION = {
  user: "1000:1000",
  capDropAll: true,
  noNewPrivileges: true,
  readOnlyRootfs: true,
  tmpfs: ["/tmp:rw,noexec,nosuid,size=64m", "/home/agent:rw,nosuid,size=256m"],
  memory: "2g",
  cpus: "2",
  pidsLimit: 512,
  ipcPrivate: true,
} as const;

export function executionTargetToAdapterConfig(target: ExecutionTargetRow): Record<string, unknown> | null {
  const cfg = target.config ?? {};
  if (target.kind === "local_host") return null; // local driver, no override
  if (target.kind === "pooled_gvisor" || target.kind === "dedicated_worker") {
    // SECURITY (P5 review, critic gap #1): execution_targets.config is
    // z.record(z.unknown()) and CRUD is org-admin-scoped, so a lower-privileged
    // tenant admin could otherwise author a target whose config WEAKENS the sandbox
    // on shared infra — re-opening the exact SSRF (`--add-host host-gateway` route to
    // the control-plane host) the P5 hardening closed, and turning off cap-drop /
    // read-only. Two invariants enforced here:
    //   (1) allowHostGateway is FORCED false on the sandbox path. The host-gateway
    //       route exists only for the self-hosted LOCAL driver's callback bridge
    //       (kind:"local_host" above, which returns null and never reaches here); a
    //       pooled/dedicated sandbox must never route to the control-plane host.
    //   (2) A TENANT-authored target (organizationId != null) always gets the full
    //       hardened isolation baseline — its config cannot turn off any security
    //       flag. Only OPERATOR-owned system rows (organizationId == null, trusted)
    //       may supply a custom isolation profile.
    // (network egress on `bridge` is governed by the worker-image egress firewall —
    // a documented Gate-B deliverable, not an app-layer control.)
    const operatorOwned = target.organizationId == null;
    return {
      type: "sandbox-docker",
      image: (cfg.image as string) ?? "aoa/agent-base:latest",
      runtime: "runsc",
      network: operatorOwned ? ((cfg.network as string) ?? "none") : "none",
      allowHostGateway: false,
      isolation: operatorOwned ? (cfg.isolation ?? HARDENED_ISOLATION) : HARDENED_ISOLATION,
    };
  }
  return null;
}
