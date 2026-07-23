import fs from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { discussions, issues, projects } from "@armyofagents/db";
import { resolveDefaultAgentWorkspaceDir } from "../../../home-paths.js";
import { instanceSettingsService } from "../../instance-settings.js";
import {
  gateProjectExecutionWorkspacePolicy,
  parseIssueExecutionWorkspaceSettings,
  parseProjectExecutionWorkspacePolicy,
  resolveExecutionWorkspaceMode,
} from "../../execution-workspace-policy.js";
import { resolveWorkspaceForRun } from "../../workspace-resolution.js";

/**
 * T5 — crew execution-workspace resolution (Decision #110, clause 7).
 *
 * THE DEFECT. The crew runner never set a workspace, so the adapter's cwd
 * chain (`claude-local/src/server/execute.ts:188`)
 *
 *     const cwd = effectiveWorkspaceCwd || configuredCwd || process.cwd();
 *
 * fell through to `process.cwd()` — the AoA server's OWN repository. Every crew
 * run executed inside this codebase and inherited AoA's `CLAUDE.md`: this
 * project's development instructions, injected into an agent doing the
 * customer's work. D16's tier two ("the workspace repo's own CLAUDE.md is
 * allowed") was satisfied by accident, by the wrong repo.
 *
 * WHAT THIS MIRRORS. Heartbeat resolves the same thing at
 * `heartbeat.ts:2901-2932` (policy inputs → mode → resolver call) →
 * `:3493-3510` (context shape) → `:3516` (`paperclipWorkspaces` hints). This
 * helper reuses heartbeat's own `resolveWorkspaceForRun` (extracted, not
 * copied) and emits the same `context.paperclipWorkspace` shape as heartbeat's
 * isolated-workspaces-DISABLED branch.
 *
 * ⚠️ KEEP IN SYNC. Only the LEAF helpers are shared — the resolver itself
 * (`services/workspace-resolution.ts`) and the four
 * `execution-workspace-policy.ts` parsers. The POLICY-INPUT block below (the
 * instance-flag / issue-settings / project-policy reads feeding
 * `resolveExecutionWorkspaceMode`) is a re-implementation of
 * `heartbeat.ts:2901-2926`, not an extraction. It was left that way
 * deliberately, because the two paths read overlapping-but-different inputs.
 * The known divergences, all intentional:
 *
 *   1. Crew has no issue-assignee adapter overrides, so
 *      `legacyUseProjectWorkspace` is always null here.
 *   2. Crew does not merge `projects.env` into the adapter config.
 *   3. Crew does not run `buildExecutionWorkspaceAdapterConfig`
 *      (`heartbeat.ts:2934-2940`), which strips/normalises
 *      `workspaceStrategy` + `workspaceRuntime` on the adapter config. Inert
 *      today — no adapter reads either while crew stays on the
 *      project-primary strategy — but it becomes real the moment crew
 *      realizes worktrees (W3b).
 *   4. Crew derives its project from the TASK's project or the THREAD's
 *      scope; heartbeat derives it from the issue or the wake context.
 *
 * The cost is that a change to the policy inputs must be made in BOTH places —
 * if you edit either one, check the other. Unifying them is a follow-up, not a
 * drive-by.
 *
 * WHY THAT BRANCH. Crew runs do not realize per-task git worktrees: that is
 * W3b (crew workspaces), and realizing one here would create and persist
 * `execution_workspaces` rows on a path that has none of the reuse, reconcile
 * or cleanup handling heartbeat's isolated branch carries. So a project policy
 * of `isolated_workspace` / `operator_branch` DEGRADES to the project's shared
 * primary workspace for crew, and says so in a warning. Degrading to a shared
 * checkout is strictly better than the previous behaviour (the AoA repo) and
 * matches what org runs do when isolated workspaces are disabled instance-wide.
 *
 * The project policy IS honoured for the choice that matters here — whether the
 * run uses the project's workspace at all (`agent_default` deliberately does
 * not), exactly as heartbeat decides it via `useProjectWorkspace`.
 *
 * WHICH PROJECT. A task run takes `issues.projectId`. A THREAD run (mention,
 * participation, controller, the sweeps — i.e. most crew work) has no task, so
 * it takes the thread's own scope: `discussions.scopeType === "project"` →
 * `scopeId`. That mapping is the same one `crew-context-bundle.ts:96-115` uses
 * to scope memory retrieval, so a thread scoped to a project resolves the same
 * project for its workspace as it does for its context. A thread scoped to a
 * department or a goal, or unscoped, has no project workspace to reach and
 * lands on the agent-home floor. Both lookups are company-scoped, so a
 * caller-supplied id can never select another tenant's row.
 *
 * NEVER RETURNS NOTHING. The per-agent home
 * (`<AOA_HOME>/instances/<id>/workspaces/<agentId>`) is the floor, created
 * eagerly, and is stable across runs for a given agent — so Claude session
 * resume (`heartbeat-session.ts:45-60`, which compares resolved cwds) still
 * matches from one crew run to the next. `source: "agent_home"` is what lets
 * the adapter prefer an explicitly configured `config.cwd` over the floor
 * (`execute.ts:186`), preserving the precedence chain
 * workspace > configured > fallback.
 */
export type CrewExecutionWorkspace = {
  cwd: string;
  source: string;
  mode: string;
  strategy: "project_primary";
  projectId: string | null;
  workspaceId: string | null;
  repoUrl: string | null;
  repoRef: string | null;
  branchName: null;
  worktreePath: null;
  agentHome: string;
};

export type CrewWorkspaceResolution = {
  workspace: CrewExecutionWorkspace;
  workspaceHints: Array<{
    workspaceId: string;
    cwd: string | null;
    repoUrl: string | null;
    repoRef: string | null;
  }>;
  warnings: string[];
};

export async function resolveCrewExecutionWorkspace(
  db: Db,
  input: {
    agent: { id: string; companyId: string };
    issueId: string | null;
    /**
     * The conversational thread this run belongs to (`payload.threadId`, a
     * `discussions.id`). Used only when there is no task: a thread scoped to a
     * project resolves that project's workspace. See WHICH PROJECT above.
     */
    threadId: string | null;
    /** Structurally typed so the runner's pino child logger fits without a pino import. */
    log: { warn: (obj: Record<string, unknown>, msg: string) => void };
  },
): Promise<CrewWorkspaceResolution> {
  const { agent, issueId, threadId, log } = input;
  // Resolved ONCE, above the try, and reused by both exits. Previously the
  // catch re-derived it — so an `fs.mkdir` failure inside the try logged
  // "falling back to the per-agent home" and then immediately re-threw from
  // the identical mkdir, making the warning a lie about what happened next.
  const agentHome = resolveDefaultAgentWorkspaceDir(agent.id);
  // Declared outside so the catch can name WHICH project lookup was in flight.
  let executionProjectId: string | null = null;
  try {
    // ── Policy inputs (re-implements heartbeat.ts:2901-2926 — see KEEP IN
    //    SYNC in the header before editing either) ────────────────────────
    const isolatedWorkspacesEnabled = (await instanceSettingsService(db).getExperimental())
      .enableIsolatedWorkspaces;

    const issueRow = issueId
      ? await db
          .select({
            projectId: issues.projectId,
            executionWorkspaceSettings: issues.executionWorkspaceSettings,
          })
          .from(issues)
          .where(and(eq(issues.id, issueId), eq(issues.companyId, agent.companyId)))
          .then((rows) => rows[0] ?? null)
      : null;

    const issueExecutionWorkspaceSettings = isolatedWorkspacesEnabled
      ? parseIssueExecutionWorkspaceSettings(issueRow?.executionWorkspaceSettings ?? null)
      : null;

    // A task's project wins. Otherwise fall back to the THREAD's scope — the
    // dominant crew shape (mention / participation / controller / sweeps) has
    // no task at all, and without this it could never reach a project
    // workspace no matter how the thread was scoped.
    const threadProjectId =
      !issueRow?.projectId && threadId
        ? await db
            .select({ scopeType: discussions.scopeType, scopeId: discussions.scopeId })
            .from(discussions)
            .where(and(eq(discussions.id, threadId), eq(discussions.companyId, agent.companyId)))
            .then((rows) => {
              const row = rows[0];
              return row?.scopeType === "project" && row.scopeId ? row.scopeId : null;
            })
        : null;

    executionProjectId = issueRow?.projectId ?? threadProjectId;
    const projectRow = executionProjectId
      ? await db
          .select({ executionWorkspacePolicy: projects.executionWorkspacePolicy })
          .from(projects)
          .where(and(eq(projects.id, executionProjectId), eq(projects.companyId, agent.companyId)))
          .then((rows) => rows[0] ?? null)
      : null;

    const projectExecutionWorkspacePolicy = projectRow
      ? gateProjectExecutionWorkspacePolicy(
          parseProjectExecutionWorkspacePolicy(projectRow.executionWorkspacePolicy),
          isolatedWorkspacesEnabled,
        )
      : null;

    const executionWorkspaceMode = resolveExecutionWorkspaceMode({
      projectPolicy: projectExecutionWorkspacePolicy,
      issueSettings: issueExecutionWorkspaceSettings,
      // Crew agents are not issue assignees with adapter overrides; the legacy
      // per-assignee `useProjectWorkspace` flag has no crew equivalent.
      legacyUseProjectWorkspace: null,
    });

    // ── cwd resolution (heartbeat.ts:2927-2932) ────────────────────────
    const resolved = await resolveWorkspaceForRun(
      db,
      agent,
      { issueId, projectId: executionProjectId },
      // Crew has no saved adapter session to resume from (task sessions are an
      // org/heartbeat concept — `agent_task_sessions` rows are written there),
      // so there is no previous cwd to prefer. The agent-home floor is stable
      // across runs on its own.
      null,
      { useProjectWorkspace: executionWorkspaceMode !== "agent_default" },
    );

    const warnings = [...resolved.warnings];
    if (
      executionWorkspaceMode === "isolated_workspace" ||
      executionWorkspaceMode === "operator_branch"
    ) {
      warnings.push(
        `Crew runs do not create isolated worktrees yet; using "${resolved.cwd}" (${resolved.source}) for this run.`,
      );
    }

    await fs.mkdir(agentHome, { recursive: true });

    return {
      workspace: {
        cwd: resolved.cwd,
        source: resolved.source,
        mode: executionWorkspaceMode,
        strategy: "project_primary",
        projectId: resolved.projectId,
        workspaceId: resolved.workspaceId,
        repoUrl: resolved.repoUrl,
        repoRef: resolved.repoRef,
        branchName: null,
        worktreePath: null,
        agentHome,
      },
      workspaceHints: resolved.workspaceHints,
      warnings,
    };
  } catch (err) {
    // Best-effort BUT NEVER "no workspace": returning nothing here would put
    // `process.cwd()` (the AoA repo) back in reach, which is the exact defect
    // this module exists to close. A policy/lookup hiccup degrades to the
    // per-agent home instead of failing the run — the same floor the happy
    // path would have used for a project-less task.
    //
    // If the floor itself cannot be resolved or created (an invalid agent id,
    // an unwritable AOA_HOME) the throw PROPAGATES and the run fails loudly.
    // That is deliberate: failing is correct, silently landing in the server's
    // repository is not.
    log.warn(
      // companyId + the project id in flight are what identify WHICH lookup
      // blew up; agentId/issueId alone cannot distinguish a settings read from
      // a project-policy read.
      { err, companyId: agent.companyId, agentId: agent.id, issueId, threadId, executionProjectId },
      "aoa-runner: crew workspace resolution failed; falling back to the per-agent home",
    );
    await fs.mkdir(agentHome, { recursive: true });
    return {
      workspace: {
        cwd: agentHome,
        source: "agent_home",
        mode: "shared_workspace",
        strategy: "project_primary",
        projectId: executionProjectId,
        workspaceId: null,
        repoUrl: null,
        repoRef: null,
        branchName: null,
        worktreePath: null,
        agentHome,
      },
      workspaceHints: [],
      warnings: [
        `Execution workspace resolution failed; using fallback workspace "${agentHome}" for this run.`,
      ],
    };
  }
}
