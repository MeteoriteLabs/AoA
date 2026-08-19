import { describe, expect, it, vi } from "vitest";
import {
  createDistributedExecutionDrain,
  type DistributedExecutionActiveAttempt,
} from "../services/job-distributed-drain.js";

const ORG_A = "aaaaaaaa-1111-4111-8111-111111111111";
const ORG_B = "bbbbbbbb-2222-4222-8222-222222222222";

function attempt(
  organizationId: string,
  jobId: string,
): DistributedExecutionActiveAttempt {
  return {
    organizationId,
    companyId: "cccccccc-3333-4333-8333-333333333333",
    jobId,
  };
}

describe("CLI-005 flag-disable drain (per-org active-attempt iterator → requestCancellation)", () => {
  it("drains every non-terminal attempt across orgs via fence-revoking requestCancellation", async () => {
    const orgsPages = [[ORG_A, ORG_B], []];
    const listAdmittedOrganizationIds = vi.fn(async () => orgsPages.shift() ?? []);
    const attemptsByOrg: Record<string, DistributedExecutionActiveAttempt[]> = {
      [ORG_A]: [attempt(ORG_A, "job-a1"), attempt(ORG_A, "job-a2")],
      [ORG_B]: [attempt(ORG_B, "job-b1")],
    };
    const listActiveAttempts = vi.fn(async (organizationId: string) => attemptsByOrg[organizationId] ?? []);
    const requestCancellation = vi.fn(async () => ({ status: "queued" as const }));
    const assertRollbackSafe = vi.fn(async () => {});

    const drain = createDistributedExecutionDrain({
      listAdmittedOrganizationIds,
      listActiveAttempts,
      requestCancellation,
      assertRollbackSafe,
    });
    const result = await drain.drainAll();

    expect(requestCancellation).toHaveBeenCalledTimes(3);
    // Every cancellation is graceful (fence-revoking) with a stable reason.
    for (const call of requestCancellation.mock.calls) {
      expect(call[0].graceful).toBe(true);
      expect(typeof call[0].reason).toBe("string");
      expect(call[0].jobId).toBeTruthy();
    }
    expect(result.cancelled).toBe(3);
    expect(result.organizationsScanned).toBe(2);
    expect(result.skippedOrganizations).toEqual([]);
  });

  it("skips an org with a pending authoritative-cost receipt (assertRollbackSafe throws)", async () => {
    const orgsPages = [[ORG_A, ORG_B], []];
    const listAdmittedOrganizationIds = vi.fn(async () => orgsPages.shift() ?? []);
    const listActiveAttempts = vi.fn(async (organizationId: string) => [attempt(organizationId, `job-${organizationId}`)]);
    const requestCancellation = vi.fn(async () => ({ status: "queued" as const }));
    const assertRollbackSafe = vi.fn(async (organizationId: string) => {
      if (organizationId === ORG_A) throw new Error("authoritative cost receipt pending");
    });

    const drain = createDistributedExecutionDrain({
      listAdmittedOrganizationIds,
      listActiveAttempts,
      requestCancellation,
      assertRollbackSafe,
    });
    const result = await drain.drainAll();

    // ORG_A refused → no cancellation + no attempt enumeration for it.
    expect(listActiveAttempts).not.toHaveBeenCalledWith(ORG_A);
    expect(requestCancellation).toHaveBeenCalledTimes(1);
    expect(requestCancellation.mock.calls[0]![0].organizationId).toBe(ORG_B);
    expect(result.skippedOrganizations).toEqual([ORG_A]);
    expect(result.cancelled).toBe(1);
  });

  it("paginates admitted orgs with an advancing cursor", async () => {
    const pages: Record<string, string[]> = {
      "null": [ORG_A],
      [ORG_A]: [ORG_B],
      [ORG_B]: [],
    };
    const listAdmittedOrganizationIds = vi.fn(
      async (input: { afterOrganizationId: string | null }) => pages[String(input.afterOrganizationId)] ?? [],
    );
    const drain = createDistributedExecutionDrain({
      listAdmittedOrganizationIds,
      listActiveAttempts: vi.fn(async () => []),
      requestCancellation: vi.fn(async () => ({ status: "queued" as const })),
      assertRollbackSafe: vi.fn(async () => {}),
    });
    const result = await drain.drainAll();

    expect(listAdmittedOrganizationIds.mock.calls[0]![0].afterOrganizationId).toBeNull();
    expect(listAdmittedOrganizationIds.mock.calls[1]![0].afterOrganizationId).toBe(ORG_A);
    expect(listAdmittedOrganizationIds.mock.calls[2]![0].afterOrganizationId).toBe(ORG_B);
    expect(result.organizationsScanned).toBe(2);
  });

  it("counts only outcomes that reached a cancel-requested/cancelled state", async () => {
    const orgsPages = [[ORG_A], []];
    const drain = createDistributedExecutionDrain({
      listAdmittedOrganizationIds: vi.fn(async () => orgsPages.shift() ?? []),
      listActiveAttempts: vi.fn(async () => [
        attempt(ORG_A, "job-1"),
        attempt(ORG_A, "job-2"),
        attempt(ORG_A, "job-3"),
      ]),
      requestCancellation: vi
        .fn()
        .mockResolvedValueOnce({ status: "queued" })
        .mockResolvedValueOnce({ status: "already_requested" })
        .mockResolvedValueOnce({ status: "not_found" }),
      assertRollbackSafe: vi.fn(async () => {}),
    });
    const result = await drain.drainAll();
    expect(result.cancelled).toBe(2);
  });

  it("a requestCancellation throw on one attempt does NOT abort the sweep (continues + records)", async () => {
    const orgsPages = [[ORG_A, ORG_B], []];
    const requestCancellation = vi
      .fn()
      .mockResolvedValueOnce({ status: "queued" }) // ORG_A job-a1 → cancelled
      .mockRejectedValueOnce(new Error("statement timeout")) // ORG_A job-a2 → throws
      .mockResolvedValueOnce({ status: "queued" }); // ORG_B job-b1 → still reached + cancelled
    const drain = createDistributedExecutionDrain({
      listAdmittedOrganizationIds: vi.fn(async () => orgsPages.shift() ?? []),
      listActiveAttempts: vi.fn(async (organizationId: string) =>
        organizationId === ORG_A
          ? [attempt(ORG_A, "job-a1"), attempt(ORG_A, "job-a2")]
          : [attempt(ORG_B, "job-b1")],
      ),
      requestCancellation,
      assertRollbackSafe: vi.fn(async () => {}),
    });

    let result: Awaited<ReturnType<typeof drain.drainAll>> | undefined;
    await expect(
      (async () => {
        result = await drain.drainAll();
      })(),
    ).resolves.not.toThrow();

    // The throw on ORG_A#2 did not abort the sweep — ORG_B#1 was still reached + cancelled.
    expect(requestCancellation).toHaveBeenCalledTimes(3);
    expect(result?.cancelled).toBe(2); // a1 + b1 (a2 threw, counted as not-cancelled)
    expect(result?.organizationsScanned).toBe(2);
  });
});
