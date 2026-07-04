/**
 * E2E (fake-crew harness Path B): Assist Inbox crew_dispatch approval round-trip
 * — CI-runnable sibling of team-aoa-crew-dispatch-approval.spec.ts.
 *
 * The gated real-crew spec proves the flow with a live CLI (AOA_E2E_REAL_CREW_FLOW=1,
 * skipped in CI). This spec proves the SAME server-side pipeline in normal CI by
 * scripting the fake Adjutant's controller-mode turn via the control file:
 *   mention wakeup → fake queues create_scope_draft (real thread action, real
 *   idempotency key, real freshness) → runner seals + commits → W1b Assist gate
 *   creates the task as planning + ONE crew_dispatch approval → approve →
 *   planning→standard flip.
 * Everything from proposeThreadAction onward is PRODUCTION code — only the LLM
 * turn is fake.
 *
 * Scope note (challenger finding 6): this spec asserts the planning→standard FLIP
 * (Assist) and standard-at-creation (Drive) — NOT the crew RUN that follows. A
 * fake crew turn never calls set_task_status, so a dispatched task trips the
 * runner's silent-stuck guard (task released back to todo, run marked failed).
 * That failed-run noise is harmless to these workMode assertions but means the
 * agent-executes-the-task leg stays covered ONLY by the gated real-crew soak.
 */

import { expect, test } from "@playwright/test";
import { cleanupTestCompanies, seedCompany } from "./helpers/seed-company";
import { jsonOrThrow, poll } from "./helpers/real-crew";
import {
  resetFakeCrewControl,
  writeFakeCrewControl,
} from "./helpers/fake-crew-control";
import {
  createThreadFromUi,
  patchThreadAutonomy,
  sendThreadMessage,
  waitForVisibleAgentEntry,
} from "./helpers/thread-flow";

type CrewDispatchApproval = {
  id: string;
  type: string;
  status: string;
  payload: { taskIds?: string[] };
};

type CrewIssue = { id: string; workMode?: string | null; title?: string };

type AgentRow = { id: string; name: string; kind: string };

// Budget for the fake Adjutant turn to land (server warmup + wakeup + commit).
const AGENT_TURN_TIMEOUT_MS = 120_000;

test.describe("Team AoA — fake-crew Assist crew_dispatch approval round-trip (CI)", () => {
  test.setTimeout(240_000);

  test.beforeEach(async ({ request }) => {
    resetFakeCrewControl();
    await cleanupTestCompanies(request, /^E2E-FakeDispatch-/);
  });

  test.afterEach(() => {
    // The control file is global (workers:1) — ALWAYS reset so later specs get
    // the legacy fake behavior they were written against.
    resetFakeCrewControl();
  });

  test("Assist: fake Adjutant scope → planning task + Inbox approval → approve → dispatched", async ({
    page,
    request,
  }) => {
    // ── 1. Company (crew auto-seeded by companyService.create) at Assist ──────
    const company = await seedCompany(request, `E2E-FakeDispatch-${Date.now()}`);
    // Eng-review fix 1 (challenger finding 1): the /agents route defaults to
    // kind:"org" — the crew agents are ONLY returned with ?kind=aoa (real-crew.ts
    // does exactly this). Without it, this list is empty and the Adjutant lookup
    // below fails deterministically.
    const agents = await jsonOrThrow<AgentRow[]>(
      await request.get(`/api/companies/${company.id}/agents?kind=aoa`),
      "list crew agents",
    );
    const adjutant = agents.find((a) => a.name === "Adjutant");
    expect(adjutant, "auto-seeded Adjutant crew agent").toBeTruthy();

    // ── 2. Script the fake Adjutant's next turn BEFORE triggering it ──────────
    writeFakeCrewControl({
      adjutant: {
        mode: "controller_scope",
        summary: "Build the token endpoint for the auth rewrite",
        proposedTasks: [{ title: "Implement the token endpoint", assigneeRole: "engineer" }],
      },
    });

    // ── 3. Thread at Assist (autonomy 1) + @Adjutant mention trigger ──────────
    await page.goto(`/${company.issuePrefix}/discussions`);
    await expect(page.getByRole("heading", { name: /Discussions/i }).first()).toBeVisible({
      timeout: 15_000,
    });
    const threadId = await createThreadFromUi(
      page,
      `Fake dispatch approval ${Date.now()}`,
      "We need to build the token endpoint for the auth rewrite, including refresh rotation.",
    );
    await patchThreadAutonomy(request, company.id, threadId, 1); // Assist (thread override)
    await sendThreadMessage(page, "@Adjutant please scope this into tracked tasks.");

    // The fake turn posts a visible confirmation entry once it queued the action.
    await waitForVisibleAgentEntry(
      page,
      request,
      company.id,
      threadId,
      adjutant!.id,
      "Adjutant",
      "fake Adjutant queued-scope entry",
      AGENT_TURN_TIMEOUT_MS,
    );

    // ── 4. ONE pending crew_dispatch approval referencing the planning task ───
    const dispatchApproval = await poll<CrewDispatchApproval[]>(
      async () =>
        jsonOrThrow<CrewDispatchApproval[]>(
          await request.get(`/api/companies/${company.id}/approvals?status=pending`),
          "list pending approvals",
        ),
      (approvals) =>
        approvals.some((a) => a.type === "crew_dispatch" && (a.payload.taskIds?.length ?? 0) > 0),
      "pending crew_dispatch approval",
      AGENT_TURN_TIMEOUT_MS,
    ).then((approvals) => approvals.find((a) => a.type === "crew_dispatch")!);

    const taskIds = dispatchApproval.payload.taskIds ?? [];
    expect(taskIds.length, "crew_dispatch approval carries the created task ids").toBe(1);
    const dispatchedTaskId = taskIds[0];

    // ── 5. The task exists on the crew board, parked as planning, with the
    //       CONTROL-FILE title (agent-authored naming path, not a heuristic) ────
    const before = await jsonOrThrow<CrewIssue[]>(
      await request.get(`/api/companies/${company.id}/issues?taskScope=crew`),
      "list crew issues (before)",
    );
    const parked = before.find((i) => i.id === dispatchedTaskId);
    expect(parked?.workMode).toBe("planning");
    expect(parked?.title).toBe("Implement the token endpoint");

    // ── 6. Approve → planning→standard flip (dispatch side-effect) ────────────
    await jsonOrThrow(
      await request.post(`/api/approvals/${dispatchApproval.id}/approve`, {
        data: { decisionNote: null },
      }),
      "approve crew_dispatch",
    );
    const after = await poll<CrewIssue[]>(
      async () =>
        jsonOrThrow<CrewIssue[]>(
          await request.get(`/api/companies/${company.id}/issues?taskScope=crew`),
          "list crew issues (after)",
        ),
      (issues) => issues.find((i) => i.id === dispatchedTaskId)?.workMode === "standard",
      "crew task flipped to standard after approve",
      30_000,
    );
    expect(after.find((i) => i.id === dispatchedTaskId)?.workMode).toBe("standard");
  });

  // Eng-review 2A: Drive (autonomy 2) — the no-human-gate mode. Highest blast
  // radius, so it gets full-pipeline CI coverage too: NO approval is created and
  // the task lands dispatchable (standard) directly.
  //
  // Eng-review fix 7 (challenger finding 7): the create_scope_draft commit gate
  // reads effectiveAutonomy = thread.autonomyLevel ?? company.autonomyLevel
  // (thread-agent-actions.ts). patchThreadAutonomy sets discussions.autonomyLevel
  // (the thread override) for THIS thread, so the gate resolves to Drive from the
  // thread row regardless of company config — the assertion holds off the thread
  // level. (Reconciliation note: patchThreadAutonomy ALSO writes company config to
  // the same level, so it is not thread-ONLY; but the fake harness spawns no stray
  // sweep runs, and the thread override is what this thread's gate reads, so the
  // finding-7 outcome is preserved.)
  test("Drive: fake Adjutant scope → task standard immediately, NO crew_dispatch approval", async ({
    page,
    request,
  }) => {
    const company = await seedCompany(request, `E2E-FakeDispatch-Drive-${Date.now()}`);
    // ?kind=aoa is required — the /agents route defaults to kind:"org" and would
    // return an empty list (mirrors the Assist test's lookup).
    const agents = await jsonOrThrow<AgentRow[]>(
      await request.get(`/api/companies/${company.id}/agents?kind=aoa`),
      "list crew agents",
    );
    const adjutant = agents.find((a) => a.name === "Adjutant");
    expect(adjutant, "auto-seeded Adjutant crew agent").toBeTruthy();

    writeFakeCrewControl({
      adjutant: {
        mode: "controller_scope",
        summary: "Drive-mode scope",
        proposedTasks: [{ title: "Ship the drive-mode task", assigneeRole: "engineer" }],
      },
    });

    await page.goto(`/${company.issuePrefix}/discussions`);
    await expect(page.getByRole("heading", { name: /Discussions/i }).first()).toBeVisible({
      timeout: 15_000,
    });
    const threadId = await createThreadFromUi(
      page,
      `Fake drive dispatch ${Date.now()}`,
      "We need to ship the drive-mode task end to end.",
    );
    await patchThreadAutonomy(request, company.id, threadId, 2); // Drive (thread override)
    await sendThreadMessage(page, "@Adjutant please scope this into tracked tasks.");

    // Wait for the fake turn to actually land BEFORE polling issues — this gives
    // the poll a fast, deterministic bucket (just the post-turn commit) instead
    // of absorbing server warmup + wakeup, and throws early on a failed run.
    await waitForVisibleAgentEntry(
      page,
      request,
      company.id,
      threadId,
      adjutant!.id,
      "Adjutant",
      "fake Adjutant queued-scope entry (drive)",
      AGENT_TURN_TIMEOUT_MS,
    );

    // The task appears ALREADY dispatchable — no planning parking, no approval.
    const issues = await poll<CrewIssue[]>(
      async () =>
        jsonOrThrow<CrewIssue[]>(
          await request.get(`/api/companies/${company.id}/issues?taskScope=crew`),
          "list crew issues (drive)",
        ),
      (rows) => rows.some((i) => i.title === "Ship the drive-mode task" && i.workMode === "standard"),
      "drive-mode task created as standard",
      AGENT_TURN_TIMEOUT_MS,
    );
    expect(issues.find((i) => i.title === "Ship the drive-mode task")?.workMode).toBe("standard");

    const approvals = await jsonOrThrow<CrewDispatchApproval[]>(
      await request.get(`/api/companies/${company.id}/approvals?status=pending`),
      "list pending approvals (drive)",
    );
    expect(
      approvals.filter((a) => a.type === "crew_dispatch"),
      "Drive must NOT raise a crew_dispatch approval",
    ).toHaveLength(0);
  });
});
