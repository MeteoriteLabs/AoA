// DE-18, admission + session arms — the dominant PRODUCTION `target_revoked`
// denials, now durably recorded. The register's DE-18 row named exactly these as
// the open follow-on: "the admission/session target_revoked arms … remain
// unaudited". Each arm below drives the REAL refusing path over embedded
// PostgreSQL under the non-owner `aoa_app` role and asserts the durable row's
// WHO/TENANT/RESOURCE/WHY separately. Observed RED against the unchanged wiring
// before the sinks landed.
//
// Windows CI can't start embedded-postgres on the runneradmin runner (Issue
// #114) — gated; opt in with AOA_RUN_WIN_INTEGRATION=1.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  setupJobControlFixture,
  auth,
  pollRequest,
  workerHello,
  sha256,
  ORG,
  TARGET,
  WORKER,
  type JobControlFixture,
} from "./helpers/job-control-fixture.js";

const integration = describe.skipIf(
  process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1",
);

interface DenialRow {
  action: string;
  actor_type: string;
  actor_id: string;
  company_id: string | null;
  organization_id: string | null;
  entity_type: string;
  entity_id: string;
  details: Record<string, unknown>;
}

integration("DE-18 admission/session target_revoked denial audit", () => {
  let fx: JobControlFixture;

  beforeAll(async () => {
    fx = await setupJobControlFixture("de18adm");
  }, 240_000);

  afterAll(async () => {
    await fx?.teardown();
  }, 60_000);

  beforeEach(async () => {
    await fx.resetRuntimeRows();
    await fx.admin`DELETE FROM activity_log WHERE action LIKE ${"security.denied.%"}`;
  });

  async function denialRows(): Promise<DenialRow[]> {
    return await fx.admin<DenialRow[]>`
      SELECT action, actor_type, actor_id, company_id, organization_id,
             entity_type, entity_id, details
      FROM activity_log WHERE action LIKE ${"security.denied.%"}
      ORDER BY created_at ASC`;
  }

  // ---- POLL admission arm (job-leasing.ts:poll) ----------------------------

  it("DE-18 CLAUSE (poll): a superseded target generation is refused target_revoked AND leaves one row keyed to DE-18 naming the generation conjunct", async () => {
    await fx.seedPlacedJob(9101);
    await fx.admin`UPDATE execution_targets SET device_generation = 2 WHERE id = ${TARGET}`;
    await expect(
      fx.leasing.poll({ auth: auth("de18-p1"), request: pollRequest("de18-p1") }),
    ).rejects.toMatchObject({ code: "target_revoked" });
    const rows = await denialRows();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.action).toBe("security.denied.worker_poll_authority");
    // ★ A GENERATION conjunct failed → DE-18, and details.failed names it.
    expect(row.details.reason).toBe("poll_generation_superseded");
    expect(row.details.crossing).toBe("DE-18");
    expect(row.details.failed).toContain("target_generation_drift");
    // WHO — the refused worker; TENANT — organization axis only (no lease resolved).
    expect(row.actor_type).toBe("system");
    expect(row.actor_id).toBe(WORKER);
    expect(row.organization_id).toBe(ORG);
    expect(row.company_id).toBeNull();
    // RESOURCE — the superseded target.
    expect(row.entity_type).toBe("execution_target");
    expect(row.entity_id).toBe(TARGET);
    expect(row.details.operation).toBe("lease_poll");
  }, 60_000);

  it("DE-18 discrimination (poll): a NON-generation authority failure (stale heartbeat) writes NO row — it serves no crossing's audit clause (Codex P2 x4 on PR #448)", async () => {
    await fx.seedPlacedJob(9105);
    // Age the worker + target liveness past maxHeartbeatAgeMs (default 300s) while
    // leaving every generation conjunct intact, so `authorityCurrent` fails ONLY on
    // the heartbeat freshness check — not a generation change, not a lease fence,
    // so neither DE-18 nor DE-04 applies and nothing is recorded.
    await fx.admin`UPDATE workers SET last_seen_at = clock_timestamp() - interval '1 hour' WHERE id = ${WORKER}`;
    await fx.admin`UPDATE execution_targets SET last_seen_at = clock_timestamp() - interval '1 hour' WHERE id = ${TARGET}`;
    await expect(
      fx.leasing.poll({ auth: auth("de18-p5"), request: pollRequest("de18-p5") }),
    ).rejects.toMatchObject({ code: "target_revoked" });
    expect(await denialRows()).toHaveLength(0);
  }, 60_000);

  it("poll: a post-authority data-integrity refusal (unparseable stored hello) writes NO row — no applicable crossing", async () => {
    await fx.seedPlacedJob(9102);
    const hash = sha256(JSON.stringify(workerHello()));
    await fx.admin`UPDATE workers SET profile_snapshot = ${"{}"}::jsonb, profile_hash = ${hash} WHERE id = ${WORKER}`;
    await expect(
      fx.leasing.poll({ auth: auth("de18-p2"), request: pollRequest("de18-p2") }),
    ).rejects.toMatchObject({ code: "target_revoked" });
    expect(await denialRows()).toHaveLength(0);
  }, 60_000);

  it("poll: a post-authority data-integrity refusal (unreadable current target) writes NO row — no applicable crossing", async () => {
    await fx.seedPlacedJob(9103);
    await fx.admin`UPDATE execution_targets SET registered_profile = ${"{}"}::jsonb WHERE id = ${TARGET}`;
    await expect(
      fx.leasing.poll({ auth: auth("de18-p3"), request: pollRequest("de18-p3") }),
    ).rejects.toMatchObject({ code: "target_revoked" });
    expect(await denialRows()).toHaveLength(0);
  }, 60_000);

  it("ANTI-VACUITY: a healthy poll (offer or no_work) writes ZERO security.denied rows", async () => {
    await fx.seedPlacedJob(9104);
    const res = await fx.leasing.poll({ auth: auth("de18-p4"), request: pollRequest("de18-p4") });
    expect(["offer", "no_work"]).toContain(res.outcome);
    expect(await denialRows()).toHaveLength(0);
  }, 60_000);

  // NOTE: the `registerProofBoundHeartbeat` refusal arm is a documented FOLLOW-ON,
  // not covered here (Codex P2 x3 on PR #448) — its six boolean-write refusal
  // branches need a per-branch generation re-read to split DE-18 vs DE-04, so
  // auditing them is deferred rather than shipped as a crossing-guessing partial.
});
