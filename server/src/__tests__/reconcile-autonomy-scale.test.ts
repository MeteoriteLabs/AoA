import { describe, it, expect, vi } from "vitest";

// Proxy-mock DB — mirrors the project pattern from backfill-crew-origin-kind.test.ts.
// The function under test calls db.update(<table>).set({ autonomyLevel: 2, updatedAt }).where(...)
// twice (discussions, then internalAgentConfig) and awaits each chain.
function makeReconcileDb(
  discussionsRowCount = 0,
  configRowCount = 0,
) {
  // Build a fresh where-proxy for each call so rowCounts are independent.
  function makeChain(rowCount: number) {
    const whereProxy = {
      then: vi.fn((resolve: (value: { rowCount: number }) => void) => {
        resolve({ rowCount });
        return Promise.resolve({ rowCount });
      }),
    };
    const setProxy = { where: vi.fn().mockReturnValue(whereProxy) };
    return { setProxy, whereProxy };
  }

  let callCount = 0;
  const chains = [
    makeChain(discussionsRowCount),
    makeChain(configRowCount),
  ];

  const db = {
    update: vi.fn().mockImplementation(() => {
      const chain = chains[callCount++ % chains.length];
      return { set: vi.fn().mockReturnValue(chain.setProxy) };
    }),
  };

  return { db };
}

describe("reconcileAutonomyScale", () => {
  it("calls db.update() twice (discussions + internalAgentConfig) and returns both row counts", async () => {
    const { db } = makeReconcileDb(3, 1);

    const { reconcileAutonomyScale } = await import(
      "../services/internal-agent/aoa-agents/reconcile-autonomy-scale.js"
    );

    const result = await reconcileAutonomyScale(db as any);

    expect(db.update).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ discussionsUpdated: 3, configUpdated: 1 });
  });

  it("SET payload for discussions includes autonomyLevel=2 and updatedAt as Date", async () => {
    const { db } = makeReconcileDb(1, 0);

    // Capture set args per call
    const setCalls: Array<{ autonomyLevel?: unknown; updatedAt?: unknown }> = [];
    const origUpdate = db.update;
    let count = 0;

    const rowCounts = [1, 0];
    db.update = vi.fn().mockImplementation(() => {
      const rc = rowCounts[count++ % rowCounts.length];
      const whereProxy = {
        then: vi.fn((resolve: (v: { rowCount: number }) => void) => {
          resolve({ rowCount: rc });
          return Promise.resolve({ rowCount: rc });
        }),
      };
      const setProxy = {
        where: vi.fn().mockReturnValue(whereProxy),
      };
      const updateProxy = {
        set: vi.fn().mockImplementation((args: unknown) => {
          setCalls.push(args as { autonomyLevel?: unknown; updatedAt?: unknown });
          return setProxy;
        }),
      };
      return updateProxy;
    });

    const { reconcileAutonomyScale } = await import(
      "../services/internal-agent/aoa-agents/reconcile-autonomy-scale.js"
    );

    await reconcileAutonomyScale(db as any);

    expect(setCalls.length).toBeGreaterThanOrEqual(1);
    expect(setCalls[0].autonomyLevel).toBe(2);
    expect(setCalls[0].updatedAt).toBeInstanceOf(Date);
  });

  it("idempotent: second run with 0 matching rows returns { discussionsUpdated: 0, configUpdated: 0 }", async () => {
    const { db } = makeReconcileDb(0, 0);

    const { reconcileAutonomyScale } = await import(
      "../services/internal-agent/aoa-agents/reconcile-autonomy-scale.js"
    );

    const result = await reconcileAutonomyScale(db as any);

    expect(result).toEqual({ discussionsUpdated: 0, configUpdated: 0 });
  });

  it("resolves without throwing when both tables return 0 rows", async () => {
    const { db } = makeReconcileDb(0, 0);

    const { reconcileAutonomyScale } = await import(
      "../services/internal-agent/aoa-agents/reconcile-autonomy-scale.js"
    );

    await expect(reconcileAutonomyScale(db as any)).resolves.toEqual({
      discussionsUpdated: 0,
      configUpdated: 0,
    });
  });

  it("handles mixed results: discussions updated, config unchanged", async () => {
    const { db } = makeReconcileDb(5, 0);

    const { reconcileAutonomyScale } = await import(
      "../services/internal-agent/aoa-agents/reconcile-autonomy-scale.js"
    );

    const result = await reconcileAutonomyScale(db as any);

    expect(result.discussionsUpdated).toBe(5);
    expect(result.configUpdated).toBe(0);
  });

  it("handles mixed results: config updated, discussions unchanged", async () => {
    const { db } = makeReconcileDb(0, 2);

    const { reconcileAutonomyScale } = await import(
      "../services/internal-agent/aoa-agents/reconcile-autonomy-scale.js"
    );

    const result = await reconcileAutonomyScale(db as any);

    expect(result.discussionsUpdated).toBe(0);
    expect(result.configUpdated).toBe(2);
  });
});
