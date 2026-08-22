/**
 * REL-004 Lane D (D2/D2a arm 2) — reclaiming a KILLED provider's paused snapshots.
 *
 * This arm destroys user-visible state, so its safety cases lead.
 *
 * Why it is opt-in (`"reclaim": true` on the switch entry) rather than implied by the switch:
 * warm leases are paused at the end of EVERY Commander turn, warm is default-on, and
 * `findResumablePausedLease` has no age bound — so the paused population IS the in-use
 * population. A plain deny-list that destroyed it would irreversibly delete the snapshot of a
 * conversation a human is mid-way through, inside that tenant's own BYO E2B account, with no
 * notification anywhere on the destroy path. That would also invert the kill-switch module's own
 * first line: "a deny-list over a placement dimension, NOT an identity revocation".
 *
 * Why it is provider-SCOPED rather than a global cutoff of zero: `listPausedLeasesOlderThan`
 * applies one cutoff to the whole result set, so `cutoff = killed ? now : ttl` would zero-grace
 * every paused external-provider lease on the instance the moment ANY switch exists — including a
 * `desktop` switch that names no legacy lease at all.
 */

import { describe, expect, it, vi } from "vitest";
import type { EnvironmentService } from "../services/environments.js";
import { sweepIdleWarmSandboxes } from "../services/warm-sandbox-reaper.js";

const CO = "00000000-0000-0000-0000-000000000001";
const ENV = "00000000-0000-0000-0000-000000000010";

function pausedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "lease-fresh",
    companyId: CO,
    environmentId: ENV,
    provider: "e2b",
    providerLeaseId: "e2b-fresh",
    status: "paused",
    leasePolicy: "reuse_by_agent",
    // Paused seconds ago — well inside the idle TTL, i.e. an IN-USE snapshot.
    pausedAt: new Date(Date.now() - 30 * 1000).toISOString(),
    releasedAt: null,
    metadata: { provider: "e2b", providerMetadata: { remoteCwd: "/workspace" } },
    ...overrides,
  };
}

function switches(entries: unknown[]) {
  return { schema: 1, switches: entries };
}

function harness(input: { document?: unknown; fresh?: unknown[] }) {
  const releaseProvider = vi.fn(async () => ({ cleanupStatus: "success" as const }));
  const listPausedLeasesForProvider = vi.fn(async () => input.fresh ?? []);
  const environments = {
    get: vi.fn(async () => ({ id: ENV, companyId: CO, name: "warm", driver: "sandbox", config: { provider: "e2b", template: "base" } })),
    releaseLease: vi.fn(async () => ({ ...pausedRow(), status: "expired" })),
    expireLeaseIfPaused: vi.fn(async (id: string) => ({ ...pausedRow(), id, status: "expired" })),
    listPausedLeasesOlderThan: vi.fn(async () => []),
    listPausedLeasesForProvider,
    listTerminalUncleanedLeases: vi.fn(async () => []),
    claimTerminalUncleaned: vi.fn(async () => null),
    listLiveAndPausedProviderLeasesForCompany: vi.fn(),
    acquireLease: vi.fn(),
    releaseLeasesForRun: vi.fn(),
  } as unknown as EnvironmentService;

  return {
    environments, releaseProvider, listPausedLeasesForProvider,
    run: () => sweepIdleWarmSandboxes({} as never, {
      environments,
      sandboxProviders: [{ provider: "e2b", acquireLease: vi.fn(), releaseLease: releaseProvider, execute: vi.fn() }],
      runtimeProviderKeys: { resolveCredential: vi.fn(async () => "sk-e2b") },
      getExperimental: async () => ({ enableWarmSandboxReaper: true, warmSandboxIdleTtlMinutes: 30 }),
      readKillSwitchDocument: async () => input.document,
    }),
  };
}

describe("REL-004 Lane D/D2a — a plain kill switch must NOT destroy", () => {
  it("reclaims NOTHING for a killed provider with no reclaim intent", async () => {
    const h = harness({
      document: switches([{ dimension: "provider", value: "e2b", reason: "provider incident" }]),
      fresh: [pausedRow()],
    });
    await h.run();
    expect(h.listPausedLeasesForProvider).not.toHaveBeenCalled();
    expect(h.releaseProvider).not.toHaveBeenCalled();
  });

  it("reclaims NOTHING when the document is unreadable — inverted from leasing", async () => {
    // Leasing fails CLOSED here. A reaper must fail OPEN: force-killing VMs because a database
    // read blipped is the worst outcome available.
    for (const document of [{ schema: 2, switches: [] }, "garbage", { schema: 1, switches: [7] }]) {
      const h = harness({ document, fresh: [pausedRow()] });
      await h.run();
      expect(h.releaseProvider, JSON.stringify(document)).not.toHaveBeenCalled();
    }
  });

  it("reclaims NOTHING when the policy READ ITSELF throws", async () => {
    // Found by mutation testing (R2). An unreadable DOCUMENT and a throwing READER are different
    // paths, and only the second models the case that actually matters: the database is briefly
    // unavailable. Fail-open is the entire safety property of this arm — a two-second blip must
    // not force-kill a fleet of virtual machines.
    const releaseProvider = vi.fn(async () => ({ cleanupStatus: "success" as const }));
    const environments = {
      get: vi.fn(async () => ({ id: ENV, companyId: CO, name: "warm", driver: "sandbox", config: { provider: "e2b", template: "base" } })),
      releaseLease: vi.fn(),
      expireLeaseIfPaused: vi.fn(async () => ({ ...pausedRow(), status: "expired" })),
      listPausedLeasesOlderThan: vi.fn(async () => []),
      listPausedLeasesForProvider: vi.fn(async () => [pausedRow()]),
      listTerminalUncleanedLeases: vi.fn(async () => []),
      claimTerminalUncleaned: vi.fn(async () => null),
      listLiveAndPausedProviderLeasesForCompany: vi.fn(),
      acquireLease: vi.fn(),
      releaseLeasesForRun: vi.fn(),
    } as unknown as EnvironmentService;

    const result = await sweepIdleWarmSandboxes({} as never, {
      environments,
      sandboxProviders: [{ provider: "e2b", acquireLease: vi.fn(), releaseLease: releaseProvider, execute: vi.fn() }],
      runtimeProviderKeys: { resolveCredential: vi.fn(async () => "sk-e2b") },
      getExperimental: async () => ({ enableWarmSandboxReaper: true, warmSandboxIdleTtlMinutes: 30 }),
      readKillSwitchDocument: async () => { throw new Error("connection reset"); },
    });

    expect(releaseProvider).not.toHaveBeenCalled();
    expect(result.reaped).toBe(0);
    // And the sweep still completes — a policy read failure must not abort the other two arms.
    expect(environments.listTerminalUncleanedLeases).toHaveBeenCalled();
  });

  it("reclaims NOTHING when no switch is set at all", async () => {
    const h = harness({ document: undefined, fresh: [pausedRow()] });
    await h.run();
    expect(h.releaseProvider).not.toHaveBeenCalled();
  });
});

describe("REL-004 Lane D/J1 — an explicit reclaim intent DOES reclaim, scoped to that provider", () => {
  it("kills the killed provider's paused snapshots when reclaim is set", async () => {
    const h = harness({
      document: switches([{ dimension: "provider", value: "e2b", reason: "compromised", reclaim: true }]),
      fresh: [pausedRow()],
    });
    const result = await h.run();
    expect(h.listPausedLeasesForProvider).toHaveBeenCalledTimes(1);
    expect(h.listPausedLeasesForProvider.mock.calls[0]?.[0]).toBe("e2b");
    expect(h.releaseProvider).toHaveBeenCalledTimes(1);
    expect(result.reaped).toBe(1);
  });

  it("scopes the pass to the named provider — a desktop switch reaps no e2b lease", async () => {
    // The naive single-cutoff implementation would zero-grace every provider at once.
    const h = harness({
      document: switches([{ dimension: "provider", value: "desktop", reason: "x", reclaim: true }]),
      fresh: [pausedRow()],
    });
    await h.run();
    expect(h.listPausedLeasesForProvider.mock.calls.map((c) => c[0])).toEqual(["desktop"]);
    // The stub returns the e2b row for any provider; the point is that `desktop` is what was
    // asked for, and a real query scoped to `desktop` matches no e2b lease.
  });

  it("honours a floor grace rather than a literal zero cutoff", async () => {
    // The codebase already refuses zero as an operator intent (normalizeWarmIdleTtlMinutes
    // clamps to [1,1440]); a cutoff of exactly `now` would race a resume that is in flight.
    const h = harness({
      document: switches([{ dimension: "provider", value: "e2b", reason: "x", reclaim: true }]),
      fresh: [pausedRow()],
    });
    await h.run();
    const cutoff = h.listPausedLeasesForProvider.mock.calls[0]?.[1] as Date;
    expect(cutoff).toBeInstanceOf(Date);
    const graceMs = Date.now() - cutoff.getTime();
    expect(graceMs).toBeGreaterThanOrEqual(60 * 1000 - 5_000);
    expect(graceMs).toBeLessThan(5 * 60 * 1000);
  });

  it("ignores a TEMPLATE reclaim — reclaim is a provider-dimension act", async () => {
    const h = harness({
      document: switches([{ dimension: "template", value: "aoa-base", reason: "cve", reclaim: true }]),
      fresh: [pausedRow()],
    });
    await h.run();
    expect(h.releaseProvider).not.toHaveBeenCalled();
  });
});
