import { test, expect, type APIRequestContext } from "@playwright/test";
import path from "node:path";
import { seedCompany, cleanupTestCompanies } from "./helpers/seed-company";
import {
  AMBIENT_CLAUDE_CONFIG_CONTAMINATION,
  AMBIENT_CLAUDE_CONFIG_POISON,
  AMBIENT_CLAUDE_CREDENTIAL_FILE,
  clearFakeClaudeInvocations,
  readFakeClaudeInvocations,
  seedAmbientClaudeConfigHome,
  writeFakeClaudeControl,
  type FakeClaudeInvocation,
} from "./helpers/fake-claude";
import { jsonOrThrow } from "./helpers/real-crew";

/**
 * D9 — ambient Claude-config isolation for CREW runs, proven at the SPAWN.
 *
 * A crew run used to inherit the operator's whole environment, so the host
 * machine's `~/.claude` (SessionStart hooks, third-party skills, plugins) and
 * the server's ambient ANTHROPIC_API_KEY bled straight into the agent — observed
 * live hijacking a crew run.
 *
 * The unit tests in packages/adapters/claude-local prove the env is BUILT right.
 * They cannot prove the spawn USED it. This spec is the wiring proof: the
 * playwright config poisons the SERVER process with a real ambient
 * CLAUDE_CONFIG_DIR + ANTHROPIC_API_KEY (AMBIENT_CLAUDE_CONFIG_POISON), a real
 * crew run is dispatched through the real adapter, and the assertions read the
 * fake CLI's OWN recorded `process.env`.
 *
 * Dispatch shape: the task is created already ASSIGNED to the crew agent, which
 * enqueues a source="assignment" wakeup carrying payload.issueId — the
 * dispatcher's isTaskDispatch exemption, so the autonomy gate cannot park it.
 * No threadId, so the fake-crew LLM harness (AOA_E2E_FAKE_CREW_LLM=1) declines
 * the turn and the run reaches the REAL claude_local adapter.
 *
 * The run itself is expected to end unhappily (the fake CLI never calls
 * set_task_status, so the runner's silent-stuck guard fires). That is irrelevant
 * here — the assertion is on what the spawn received, and the invocation is
 * recorded before the guard runs.
 *
 * POSITIVE CONTROL. `toBeUndefined()` also passes if the poison simply stopped
 * reaching the server (a reordered webServer env, a dropped spread, someone
 * tidying the ambient block) — the strip, which is the security-relevant half,
 * would then be asserted by an absence that was always absent. So the spec also
 * dispatches an ORG claude_local run: same adapter, same spawn path, isolation
 * flag NOT set. Its invocation must CONTAIN the poison. If the poison ever stops
 * arriving, that control fails loudly instead of the crew assertions rotting
 * into vacuous passes.
 */

type CrewAgent = { id: string; name: string; adapterConfig?: Record<string, unknown> | null };

const CREW_AGENT_NAME = "Scout";
const ORG_AGENT_NAME = "Ambient Control Agent";

/**
 * Per-wait budget. Two sequential waits must BOTH fit inside the 240s test
 * timeout with room for seeding — otherwise a genuinely stuck run is reported as
 * a bare "test timeout" instead of the waitFor's descriptive message, which is
 * exactly when the descriptive message is worth having.
 */
const WAIT_TIMEOUT_MS = 100_000;

async function waitFor<T>(
  probe: () => Promise<T | null> | T | null,
  what: string,
  timeoutMs = 120_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = await probe();
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Force the crew agent onto claude_local, preserving its instruction bundle. */
async function pinCrewAgentToClaude(
  request: APIRequestContext,
  agent: CrewAgent,
): Promise<void> {
  const existing = agent.adapterConfig ?? {};
  await jsonOrThrow(
    await request.patch(`/api/agents/${agent.id}`, {
      data: {
        adapterType: "claude_local",
        adapterConfig: {
          ...existing,
          model: "claude-sonnet-4-5-20250929",
          dangerouslySkipPermissions: true,
        },
      },
    }),
    `pin ${agent.name} to claude_local`,
  );
}

test.describe("crew ambient Claude-config isolation", () => {
  test.setTimeout(240_000);

  test.beforeEach(async ({ request }) => {
    await cleanupTestCompanies(request, /^E2E-CrewIsolation-/);
    // Re-assert the ambient operator config home. The config seeds it at load,
    // but a prior local run (or another spec) could have disturbed it, and a
    // MISSING credential here does not fail loudly in this spec — it makes the
    // crew run refuse to spawn, which reads as a timeout waiting for an
    // invocation rather than "your fixture is gone".
    seedAmbientClaudeConfigHome();
  });

  test("a crew run spawns with a per-run CLAUDE_CONFIG_DIR and no ambient Anthropic key", async ({
    request,
  }) => {
    const company = await seedCompany(request, `E2E-CrewIsolation-${Date.now()}`);

    // The crew is auto-seeded by companyService.create, but only surfaces with
    // ?kind=aoa (the /agents route defaults to kind:"org").
    const crew = await waitFor(async () => {
      const res = await request.get(`/api/companies/${company.id}/agents?kind=aoa`);
      if (!res.ok()) return null;
      const rows = (await res.json()) as CrewAgent[];
      return rows.find((a) => a.name === CREW_AGENT_NAME) ?? null;
    }, `auto-seeded ${CREW_AGENT_NAME} crew agent`, 60_000);

    await pinCrewAgentToClaude(request, crew);

    // The positive control: an ORG claude_local agent. Same adapter, same spawn
    // path, isolation flag never set (heartbeat doesn't pass it).
    const org = await jsonOrThrow<{ agent: { id: string } }>(
      await request.post(`/api/companies/${company.id}/agent-hires`, {
        data: {
          name: ORG_AGENT_NAME,
          role: "general",
          title: ORG_AGENT_NAME,
          adapterType: "claude_local",
          runtimeConfig: {},
          adapterConfig: {},
        },
      }),
      "hire org control agent",
    );

    clearFakeClaudeInvocations();
    writeFakeClaudeControl({ text: "Scouting complete." });

    // Assigned-at-creation → source="assignment" + payload.issueId → the
    // dispatcher's task-dispatch exemption runs it regardless of the autonomy dial.
    // (The org agent's assignment wakes it through heartbeat, same trigger shape.)
    for (const [label, agentId] of [
      ["org control", org.agent.id],
      ["crew", crew.id],
    ] as const) {
      await jsonOrThrow<{ id: string }>(
        await request.post(`/api/companies/${company.id}/issues`, {
          data: {
            title: `Config isolation probe (${label})`,
            description: "Dispatches one run so its spawn env can be inspected.",
            status: "todo",
            priority: "medium",
            workMode: "standard",
            assigneeAgentId: agentId,
          },
        }),
        `create assigned ${label} issue`,
      );
    }

    const invocationFor = (agentId: string) => (): FakeClaudeInvocation | null =>
      readFakeClaudeInvocations().find((inv) => inv.env?.AOA_AGENT_ID === agentId) ?? null;

    // ── Positive control FIRST: the poison genuinely reaches an unisolated spawn.
    const controlSpawn = await waitFor<FakeClaudeInvocation>(
      invocationFor(org.agent.id),
      "a recorded claude invocation for the org control agent",
      WAIT_TIMEOUT_MS,
    );
    const controlEnv = controlSpawn.env!;
    expect(
      controlEnv.CLAUDE_CODE_E2E_OPERATOR_KNOB,
      "ambient poison must reach an UNISOLATED claude spawn — otherwise the crew absence assertions below prove nothing",
    ).toBe(AMBIENT_CLAUDE_CONFIG_POISON.CLAUDE_CODE_E2E_OPERATOR_KNOB);
    // Presence only: the fixture masks secret-shaped VALUES (it would otherwise
    // record a developer's real CLAUDE_CODE_OAUTH_TOKEN). The control's strength
    // comes from the two full-value assertions either side of this one.
    expect(controlEnv.ANTHROPIC_API_KEY).toBeDefined();
    expect(controlEnv.CLAUDE_CONFIG_DIR).toBe(AMBIENT_CLAUDE_CONFIG_POISON.CLAUDE_CONFIG_DIR);
    // …and the operator's config home really does hold the contamination the
    // crew assertions below claim to have excluded. Without this, "no plugins/"
    // could just mean "there were never any plugins/".
    expect(
      controlSpawn.configDirEntries,
      "the ambient operator config home must actually contain contamination",
    ).toEqual(expect.arrayContaining([...AMBIENT_CLAUDE_CONFIG_CONTAMINATION.dirs]));

    // Recorded by the fake CLI itself — the spawn's own inherited environment.
    const invocation = await waitFor<FakeClaudeInvocation>(
      invocationFor(crew.id),
      "a recorded claude invocation for the crew agent",
      WAIT_TIMEOUT_MS,
    );

    const env = invocation.env!;

    // 1. CLAUDE_CONFIG_DIR is the per-run directory, NOT the operator's.
    expect(env.CLAUDE_CONFIG_DIR, "crew run must pin CLAUDE_CONFIG_DIR").toBeTruthy();
    expect(env.CLAUDE_CONFIG_DIR).not.toBe(AMBIENT_CLAUDE_CONFIG_POISON.CLAUDE_CONFIG_DIR);
    expect(path.basename(env.CLAUDE_CONFIG_DIR)).toMatch(/^aoa-claude-config-/);

    // 2. The server's ambient Anthropic key never reaches the child — and neither
    //    does an un-enumerated CLAUDE_* knob (the prefix class, not a denylist).
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.CLAUDE_CODE_E2E_OPERATOR_KNOB).toBeUndefined();

    // 3. 🚨 The agent can still do real work: git/SSH/npm resolve through
    //    HOME/USERPROFILE, and PATH is how the CLI was found at all.
    expect(env.PATH ?? env.Path, "PATH must survive the strip").toBeTruthy();
    const homeish = env.HOME ?? env.USERPROFILE;
    expect(homeish, "HOME/USERPROFILE must survive the strip").toBeTruthy();

    // 4. T3 — the pinned directory is AUTHENTICATED and otherwise EMPTY.
    //
    //    Listed by the fake CLI itself at spawn time: the per-run directory is
    //    removed in the adapter's `finally`, so reading the path from here would
    //    race the cleanup. Exactly one entry is the strongest available form of
    //    "the other nineteen did not come with it" — and, read together with the
    //    control above (which proves the source home is full of contamination),
    //    it is a real exclusion rather than an empty one.
    expect(
      invocation.configDirEntries,
      "the per-run config home must contain the credential and nothing else",
    ).toEqual([AMBIENT_CLAUDE_CREDENTIAL_FILE]);
    for (const name of [
      ...AMBIENT_CLAUDE_CONFIG_CONTAMINATION.files,
      ...AMBIENT_CLAUDE_CONFIG_CONTAMINATION.dirs,
    ]) {
      expect(
        invocation.configDirEntries,
        `${name} must never reach a crew run`,
      ).not.toContain(name);
    }
  });
});
