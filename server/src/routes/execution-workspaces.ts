import { and, eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import type { Db } from "@armyofagents/db";
import { issues, projects, projectWorkspaces, workspaceRuntimeServices } from "@armyofagents/db";
import {
  updateExecutionWorkspaceSchema,
  workspaceRuntimeControlTargetSchema,
  type WorkspaceRuntimeControlTarget,
} from "@armyofagents/shared";
import { validate } from "../middleware/validate.js";
import { executionWorkspaceService, instanceSettingsService, logActivity, workspaceOperationService } from "../services/index.js";
import { parseProjectExecutionWorkspacePolicy } from "../services/execution-workspace-policy.js";
import { mergeExecutionWorkspaceConfig, readExecutionWorkspaceConfig } from "../services/execution-workspaces.js";
import { readProjectWorkspaceRuntimeConfig } from "../services/project-workspace-runtime-config.js";
import {
  buildWorkspaceRuntimeDesiredStatePatch,
  cleanupExecutionWorkspaceArtifacts,
  ensurePersistedExecutionWorkspaceAvailable,
  listConfiguredRuntimeServiceEntries,
  startRuntimeServicesForWorkspaceControl,
  stopRuntimeServicesForExecutionWorkspace,
} from "../services/workspace-runtime.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { assertCanControlWorkspace } from "../services/workspace-authz.js";

export function executionWorkspaceRoutes(db: Db) {
  const router = Router();
  const svc = executionWorkspaceService(db);
  const workspaceOperationsSvc = workspaceOperationService(db);
  const instanceSettings = instanceSettingsService(db);

  async function assertIsolatedWorkspacesEnabled(res: Response): Promise<boolean> {
    const experimental = await instanceSettings.getExperimental();
    if (!experimental.enableIsolatedWorkspaces) {
      res.status(404).json({ error: "Execution workspaces are not enabled" });
      return false;
    }
    return true;
  }

  router.get("/companies/:companyId/execution-workspaces", async (req, res) => {
    if (!(await assertIsolatedWorkspacesEnabled(res))) return;
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const filters = {
      projectId: req.query.projectId as string | undefined,
      projectWorkspaceId: req.query.projectWorkspaceId as string | undefined,
      issueId: req.query.issueId as string | undefined,
      status: req.query.status as string | undefined,
      reuseEligible: req.query.reuseEligible === "true",
    };
    if (req.query.summary === "true") {
      const summaries = await svc.listSummaries(companyId, filters);
      res.json(summaries);
      return;
    }
    const workspaces = await svc.list(companyId, filters);
    res.json(workspaces);
  });

  router.get("/execution-workspaces/:id", async (req, res) => {
    if (!(await assertIsolatedWorkspacesEnabled(res))) return;
    const id = req.params.id as string;
    const workspace = await svc.getById(id);
    if (!workspace) {
      res.status(404).json({ error: "Execution workspace not found" });
      return;
    }
    assertCompanyAccess(req, workspace.companyId);
    res.json(workspace);
  });

  router.patch("/execution-workspaces/:id", validate(updateExecutionWorkspaceSchema), async (req, res) => {
    if (!(await assertIsolatedWorkspacesEnabled(res))) return;
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Execution workspace not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    await assertCanControlWorkspace(db, req, {
      companyId: existing.companyId,
      projectId: existing.projectId ?? null,
    });
    const { config: configPatch, ...restBody } = req.body as Record<string, unknown>;
    const patch: Record<string, unknown> = {
      ...restBody,
      ...(req.body.cleanupEligibleAt ? { cleanupEligibleAt: new Date(req.body.cleanupEligibleAt) } : {}),
    };
    if (configPatch !== undefined) {
      patch.metadata = mergeExecutionWorkspaceConfig(
        (req.body.metadata as Record<string, unknown> | null | undefined) ?? existing.metadata,
        configPatch as Record<string, unknown>,
      );
    }
    let workspace = existing;
    let cleanupWarnings: string[] = [];

    if (req.body.status === "archived" && existing.status !== "archived") {
      const readiness = await svc.getCloseReadiness(id);
      if (readiness && readiness.state === "blocked") {
        res.status(409).json({
          error:
            readiness.blockingReasons[0] ?? "Workspace cannot be archived",
          blockingReasons: readiness.blockingReasons,
        });
        return;
      }

      if (existing.mode === "shared_workspace") {
        await db
          .update(issues)
          .set({ executionWorkspaceId: null })
          .where(
            and(
              eq(issues.companyId, existing.companyId),
              eq(issues.executionWorkspaceId, existing.id),
            ),
          );
      }

      const closedAt = new Date();
      const archivedWorkspace = await svc.update(id, {
        ...patch,
        status: "archived",
        closedAt,
        cleanupReason: null,
      });
      if (!archivedWorkspace) {
        res.status(404).json({ error: "Execution workspace not found" });
        return;
      }
      workspace = archivedWorkspace;

      try {
        await stopRuntimeServicesForExecutionWorkspace({
          db,
          executionWorkspaceId: existing.id,
          workspaceCwd: existing.cwd,
        });
        const projectWorkspace = existing.projectWorkspaceId
          ? await db
              .select({
                cwd: projectWorkspaces.cwd,
                cleanupCommand: projectWorkspaces.cleanupCommand,
              })
              .from(projectWorkspaces)
              .where(
                and(
                  eq(projectWorkspaces.id, existing.projectWorkspaceId),
                  eq(projectWorkspaces.companyId, existing.companyId),
                ),
              )
              .then((rows) => rows[0] ?? null)
          : null;
        const projectPolicy = existing.projectId
          ? await db
              .select({
                executionWorkspacePolicy: projects.executionWorkspacePolicy,
              })
              .from(projects)
              .where(and(eq(projects.id, existing.projectId), eq(projects.companyId, existing.companyId)))
              .then((rows) => parseProjectExecutionWorkspacePolicy(rows[0]?.executionWorkspacePolicy))
          : null;
        const cleanupResult = await cleanupExecutionWorkspaceArtifacts({
          workspace: existing,
          projectWorkspace,
          cleanupCommand: existing.config?.cleanupCommand ?? null,
          teardownCommand: existing.config?.teardownCommand ?? projectPolicy?.workspaceStrategy?.teardownCommand ?? null,
          recorder: workspaceOperationsSvc.createRecorder({
            companyId: existing.companyId,
            executionWorkspaceId: existing.id,
          }),
        });
        cleanupWarnings = cleanupResult.warnings;
        const cleanupPatch: Record<string, unknown> = {
          closedAt,
          cleanupReason: cleanupWarnings.length > 0 ? cleanupWarnings.join(" | ") : null,
        };
        if (!cleanupResult.cleaned) {
          cleanupPatch.status = "cleanup_failed";
        }
        if (cleanupResult.warnings.length > 0 || !cleanupResult.cleaned) {
          workspace = (await svc.update(id, cleanupPatch)) ?? workspace;
        }
      } catch (error) {
        const failureReason = error instanceof Error ? error.message : String(error);
        workspace =
          (await svc.update(id, {
            status: "cleanup_failed",
            closedAt,
            cleanupReason: failureReason,
          })) ?? workspace;
        res.status(500).json({
          error: `Failed to archive execution workspace: ${failureReason}`,
        });
        return;
      }
    } else {
      const updatedWorkspace = await svc.update(id, patch);
      if (!updatedWorkspace) {
        res.status(404).json({ error: "Execution workspace not found" });
        return;
      }
      workspace = updatedWorkspace;
    }
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: existing.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "execution_workspace.updated",
      entityType: "execution_workspace",
      entityId: workspace.id,
      details: {
        changedKeys: Object.keys(req.body).sort(),
        ...(cleanupWarnings.length > 0 ? { cleanupWarnings } : {}),
      },
    });
    res.json(workspace);
  });

  router.get("/execution-workspaces/:id/runtime-services", async (req, res) => {
    if (!(await assertIsolatedWorkspacesEnabled(res))) return;
    const id = req.params.id as string;
    const workspace = await svc.getById(id);
    if (!workspace) {
      res.status(404).json({ error: "Execution workspace not found" });
      return;
    }
    assertCompanyAccess(req, workspace.companyId);
    const services = await db
      .select()
      .from(workspaceRuntimeServices)
      .where(
        and(
          eq(workspaceRuntimeServices.companyId, workspace.companyId),
          eq(workspaceRuntimeServices.executionWorkspaceId, id),
        ),
      );
    res.json(services);
  });

  router.get("/execution-workspaces/:id/close-readiness", async (req, res) => {
    if (!(await assertIsolatedWorkspacesEnabled(res))) return;
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Execution workspace not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const readiness = await svc.getCloseReadiness(id);
    if (!readiness) {
      res.status(404).json({ error: "Execution workspace not found" });
      return;
    }
    res.json(readiness);
  });

  router.get("/execution-workspaces/:id/workspace-operations", async (req, res) => {
    if (!(await assertIsolatedWorkspacesEnabled(res))) return;
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Execution workspace not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);

    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 100;
    const operations = await workspaceOperationsSvc.listForExecutionWorkspace(id, { limit });
    res.json(operations);
  });

  async function handleExecutionWorkspaceRuntimeCommand(req: Request, res: Response) {
    if (!(await assertIsolatedWorkspacesEnabled(res))) return;
    const id = req.params.id as string;
    const action = String(req.params.action ?? "").trim().toLowerCase();
    if (action !== "start" && action !== "stop" && action !== "restart" && action !== "run") {
      res.status(400).json({ error: "Invalid action" });
      return;
    }

    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Execution workspace not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    await assertCanControlWorkspace(db, req, {
      companyId: existing.companyId,
      projectId: existing.projectId ?? null,
    });

    const workspaceCwd = existing.cwd;
    if (!workspaceCwd) {
      res.status(422).json({ error: "Execution workspace needs a local path before AoA can run workspace commands" });
      return;
    }

    const projectWorkspace = existing.projectWorkspaceId
      ? await db
          .select({
            id: projectWorkspaces.id,
            cwd: projectWorkspaces.cwd,
            repoUrl: projectWorkspaces.repoUrl,
            repoRef: projectWorkspaces.repoRef,
            defaultRef: projectWorkspaces.defaultRef,
            metadata: projectWorkspaces.metadata,
          })
          .from(projectWorkspaces)
          .where(
            and(
              eq(projectWorkspaces.id, existing.projectWorkspaceId),
              eq(projectWorkspaces.companyId, existing.companyId),
            ),
          )
          .then((rows) => rows[0] ?? null)
      : null;

    const projectWorkspaceRuntime = readProjectWorkspaceRuntimeConfig(
      (projectWorkspace?.metadata as Record<string, unknown> | null) ?? null,
    )?.workspaceRuntime ?? null;

    const effectiveRuntimeConfig = existing.config?.workspaceRuntime ?? projectWorkspaceRuntime ?? null;

    let target: WorkspaceRuntimeControlTarget;
    try {
      target = workspaceRuntimeControlTargetSchema.parse(req.body ?? {});
    } catch (err) {
      res.status(400).json({ error: "Invalid control target", details: err instanceof Error ? err.message : String(err) });
      return;
    }

    const configuredServices = effectiveRuntimeConfig
      ? listConfiguredRuntimeServiceEntries({ workspaceRuntime: effectiveRuntimeConfig })
      : [];

    if (
      target.runtimeServiceId
      && !(existing.runtimeServices ?? []).some((service) => service.id === target.runtimeServiceId)
    ) {
      res.status(404).json({ error: "Runtime service not found for this execution workspace" });
      return;
    }

    const selectedRuntimeServiceId = target.runtimeServiceId ?? null;
    const selectedServiceIndex = target.serviceIndex ?? null;
    if (
      selectedServiceIndex !== null
      && (selectedServiceIndex < 0 || selectedServiceIndex >= configuredServices.length)
    ) {
      res.status(422).json({ error: "Selected runtime service is not defined in this execution workspace runtime config" });
      return;
    }

    if ((action === "start" || action === "restart") && !effectiveRuntimeConfig) {
      res.status(422).json({ error: "Execution workspace has no workspace command configuration or inherited project workspace default" });
      return;
    }

    if (action === "run") {
      res.status(422).json({ error: "Workspace job execution requires a workspaceCommandId (Task 9 — workspace command definitions)" });
      return;
    }

    const actor = getActorInfo(req);
    const actorAgent = {
      id: actor.agentId ?? null,
      name: actor.actorType === "user" ? "Board" : "Agent",
      companyId: existing.companyId,
    };
    const recorder = workspaceOperationsSvc.createRecorder({
      companyId: existing.companyId,
      executionWorkspaceId: existing.id,
    });

    const ensureWorkspaceAvailable = async () =>
      await ensurePersistedExecutionWorkspaceAvailable(
        existing,
        {
          baseCwd: projectWorkspace?.cwd ?? workspaceCwd,
          source: existing.mode === "shared_workspace" ? "project_primary" : "task_session",
          projectId: existing.projectId,
          workspaceId: existing.projectWorkspaceId,
          repoUrl: existing.repoUrl,
          repoRef: existing.baseRef,
        },
        recorder,
      );

    let runtimeServiceCount = existing.runtimeServices?.length ?? 0;
    const stdout: string[] = [];
    const stderr: string[] = [];
    const onLog = async (stream: "stdout" | "stderr", chunk: string) => {
      if (stream === "stdout") stdout.push(chunk);
      else stderr.push(chunk);
    };

    try {
      if (action === "stop" || action === "restart") {
        await stopRuntimeServicesForExecutionWorkspace({
          db,
          executionWorkspaceId: existing.id,
          workspaceCwd,
          runtimeServiceId: selectedRuntimeServiceId,
        });
      }

      if (action === "start" || action === "restart") {
        const availableWorkspace = await ensureWorkspaceAvailable();
        if (!availableWorkspace) {
          res.status(422).json({ error: "Execution workspace needs a local path before AoA can manage local runtime services" });
          return;
        }
        const startedServices = await startRuntimeServicesForWorkspaceControl({
          db,
          actor: actorAgent,
          issue: existing.sourceIssueId
            ? { id: existing.sourceIssueId, identifier: null, title: existing.name }
            : null,
          workspace: availableWorkspace,
          executionWorkspaceId: existing.id,
          config: { workspaceRuntime: effectiveRuntimeConfig },
          adapterEnv: {},
          onLog,
          serviceIndex: selectedServiceIndex,
        });
        runtimeServiceCount = startedServices.length;
      } else {
        runtimeServiceCount = selectedRuntimeServiceId ? Math.max(0, (existing.runtimeServices?.length ?? 1) - 1) : 0;
      }

      const currentDesiredState: "running" | "stopped" =
        existing.config?.desiredState
        ?? ((existing.runtimeServices ?? []).some((service) => service.status === "starting" || service.status === "running")
          ? "running"
          : "stopped");
      const nextRuntimeState = selectedRuntimeServiceId && selectedServiceIndex === null
        ? {
            desiredState: currentDesiredState,
            serviceStates: existing.config?.serviceStates ?? null,
          }
        : buildWorkspaceRuntimeDesiredStatePatch({
            config: { workspaceRuntime: effectiveRuntimeConfig ?? {} },
            currentDesiredState,
            currentServiceStates: existing.config?.serviceStates ?? null,
            action: action as "start" | "stop" | "restart",
            serviceIndex: selectedServiceIndex,
          });
      const metadata = mergeExecutionWorkspaceConfig(existing.metadata as Record<string, unknown> | null, {
        desiredState: nextRuntimeState.desiredState,
        serviceStates: nextRuntimeState.serviceStates,
      });
      await svc.update(existing.id, { metadata });
    } catch (err) {
      res.status(500).json({
        error: "Runtime command failed",
        details: err instanceof Error ? err.message : String(err),
        stdout: stdout.join(""),
        stderr: stderr.join(""),
      });
      return;
    }

    const workspace = await svc.getById(id);
    if (!workspace) {
      res.status(404).json({ error: "Execution workspace not found" });
      return;
    }

    await logActivity(db, {
      companyId: existing.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: `execution_workspace.runtime_${action}`,
      entityType: "execution_workspace",
      entityId: existing.id,
      details: {
        runtimeServiceCount,
        runtimeServiceId: selectedRuntimeServiceId,
        serviceIndex: selectedServiceIndex,
      },
    });

    res.json({
      workspace,
      runtimeServiceCount,
      stdout: stdout.join(""),
      stderr: stderr.join(""),
    });
  }

  router.post("/execution-workspaces/:id/runtime-services/:action", handleExecutionWorkspaceRuntimeCommand);
  router.post("/execution-workspaces/:id/runtime-commands/:action", handleExecutionWorkspaceRuntimeCommand);

  return router;
}
