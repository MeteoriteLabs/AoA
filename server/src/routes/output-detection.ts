import { Router } from "express";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { heartbeatRuns, issues } from "@armyofagents/db";
import { confirmDetectedOutputSchema } from "@armyofagents/shared";
import type { DetectedOutput, DetectedOutputForUI } from "@armyofagents/shared";
import { validate } from "../middleware/validate.js";
import { artifactService, logActivity } from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function outputDetectionRoutes(db: Db) {
  const router = Router();
  const artifactSvc = artifactService(db);

  // ── List detected outputs for a task (aggregated from all runs) ──────
  router.get("/issues/:issueId/detected-outputs", async (req, res) => {
    const issueId = req.params.issueId as string;

    // Verify issue exists and check access
    const issue = await db
      .select({ companyId: issues.companyId })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0] ?? null);

    if (!issue) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    assertCompanyAccess(req, issue.companyId);

    // Query runs that have detected outputs for this issue
    const runs = await db
      .select({
        id: heartbeatRuns.id,
        detectedOutputs: heartbeatRuns.detectedOutputs,
        finishedAt: heartbeatRuns.finishedAt,
      })
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.companyId, issue.companyId),
          isNotNull(heartbeatRuns.detectedOutputs),
          sql`${heartbeatRuns.contextSnapshot}->>'issueId' = ${issueId}`,
        ),
      );

    // Flatten into a single list, preserving each item's index within its run
    const result: DetectedOutputForUI[] = [];
    for (const run of runs) {
      const outputs = run.detectedOutputs as unknown as DetectedOutput[] | null;
      if (!outputs) continue;
      for (let i = 0; i < outputs.length; i++) {
        result.push({
          ...outputs[i],
          runId: run.id,
          runFinishedAt: run.finishedAt?.toISOString() ?? null,
          outputIndex: i,
        });
      }
    }

    res.json(result);
  });

  // ── List detected outputs for a specific run ────────────────────────
  router.get("/heartbeat-runs/:runId/detected-outputs", async (req, res) => {
    const runId = req.params.runId as string;

    const run = await db
      .select({
        companyId: heartbeatRuns.companyId,
        detectedOutputs: heartbeatRuns.detectedOutputs,
        finishedAt: heartbeatRuns.finishedAt,
      })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId))
      .then((rows) => rows[0] ?? null);

    if (!run) {
      res.status(404).json({ error: "Heartbeat run not found" });
      return;
    }
    assertCompanyAccess(req, run.companyId);

    const outputs = (run.detectedOutputs as unknown as DetectedOutput[] | null) ?? [];
    const result: DetectedOutputForUI[] = outputs.map((o, i) => ({
      ...o,
      runId,
      runFinishedAt: run.finishedAt?.toISOString() ?? null,
      outputIndex: i,
    }));

    res.json(result);
  });

  // ── Confirm a detected output → create artifact/version ─────────────
  router.post(
    "/heartbeat-runs/:runId/detected-outputs/:index/confirm",
    validate(confirmDetectedOutputSchema),
    async (req, res) => {
      const runId = req.params.runId as string;
      const index = parseInt(req.params.index as string, 10);

      if (!Number.isFinite(index) || index < 0) {
        res.status(400).json({ error: "Invalid output index" });
        return;
      }

      const run = await db
        .select({
          companyId: heartbeatRuns.companyId,
          agentId: heartbeatRuns.agentId,
          detectedOutputs: heartbeatRuns.detectedOutputs,
          contextSnapshot: heartbeatRuns.contextSnapshot,
        })
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, runId))
        .then((rows) => rows[0] ?? null);

      if (!run) {
        res.status(404).json({ error: "Heartbeat run not found" });
        return;
      }
      assertCompanyAccess(req, run.companyId);

      const outputs = run.detectedOutputs as unknown as DetectedOutput[] | null;
      if (!outputs || index >= outputs.length) {
        res.status(404).json({ error: "Detected output not found at index" });
        return;
      }

      const output = outputs[index];
      if (output.status !== "pending") {
        res.status(409).json({ error: `Output already ${output.status}` });
        return;
      }

      if (!output.assetId) {
        res.status(422).json({ error: "Output has no stored asset" });
        return;
      }

      const actor = getActorInfo(req);
      const fileUrl = `/api/assets/${output.assetId}/content`;
      const { artifactId, title, type, changelog } = req.body;
      const issueId = (run.contextSnapshot as Record<string, unknown> | null)?.issueId as
        | string
        | undefined;

      let confirmedArtifactId: string;
      let confirmedVersionId: string;

      if (artifactId) {
        // Add version to existing artifact
        const version = await artifactSvc.addVersion(artifactId, {
          source: "agent",
          sourceDetail: run.agentId,
          changelog: changelog ?? `Captured from agent output: ${output.filename}`,
          fileUrl,
        });
        confirmedArtifactId = artifactId;
        confirmedVersionId = version.id;
      } else {
        // Create new artifact with initial version
        const artifact = await artifactSvc.create(run.companyId, actor.actorId, {
          title: title ?? output.filename,
          type: type ?? inferArtifactType(output),
          source: "agent",
          sourceDetail: run.agentId,
          changelog: changelog ?? `Captured from agent output: ${output.filename}`,
          fileUrl,
        });
        confirmedArtifactId = artifact.id;
        confirmedVersionId = artifact.versions[0]?.id ?? artifact.id;

        // Link to task if issue has no artifact yet
        if (issueId) {
          const issue = await db
            .select({ artifactId: issues.artifactId })
            .from(issues)
            .where(eq(issues.id, issueId))
            .then((rows) => rows[0] ?? null);

          if (issue && !issue.artifactId) {
            await db
              .update(issues)
              .set({ artifactId: confirmedArtifactId, updatedAt: new Date() })
              .where(eq(issues.id, issueId));
          }
        }
      }

      // Update the JSONB array item
      const updatedOutputs = [...outputs];
      updatedOutputs[index] = {
        ...output,
        status: "confirmed",
        confirmedArtifactId,
        confirmedVersionId,
      };

      await db
        .update(heartbeatRuns)
        .set({
          detectedOutputs: updatedOutputs as unknown as Array<Record<string, unknown>>,
          updatedAt: new Date(),
        })
        .where(eq(heartbeatRuns.id, runId));

      await logActivity(db, {
        companyId: run.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "artifact.output_confirmed",
        entityType: "artifact",
        entityId: confirmedArtifactId,
        details: {
          runId,
          filename: output.filename,
          versionId: confirmedVersionId,
        },
      });

      res.status(200).json({
        artifactId: confirmedArtifactId,
        versionId: confirmedVersionId,
        status: "confirmed",
      });
    },
  );

  // ── Dismiss a detected output ───────────────────────────────────────
  router.post("/heartbeat-runs/:runId/detected-outputs/:index/dismiss", async (req, res) => {
    const runId = req.params.runId as string;
    const index = parseInt(req.params.index as string, 10);

    if (!Number.isFinite(index) || index < 0) {
      res.status(400).json({ error: "Invalid output index" });
      return;
    }

    const run = await db
      .select({
        companyId: heartbeatRuns.companyId,
        detectedOutputs: heartbeatRuns.detectedOutputs,
      })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId))
      .then((rows) => rows[0] ?? null);

    if (!run) {
      res.status(404).json({ error: "Heartbeat run not found" });
      return;
    }
    assertCompanyAccess(req, run.companyId);

    const outputs = run.detectedOutputs as unknown as DetectedOutput[] | null;
    if (!outputs || index >= outputs.length) {
      res.status(404).json({ error: "Detected output not found at index" });
      return;
    }

    const output = outputs[index];
    if (output.status !== "pending") {
      res.status(409).json({ error: `Output already ${output.status}` });
      return;
    }

    const updatedOutputs = [...outputs];
    updatedOutputs[index] = { ...output, status: "dismissed" };

    await db
      .update(heartbeatRuns)
      .set({
        detectedOutputs: updatedOutputs as unknown as Array<Record<string, unknown>>,
        updatedAt: new Date(),
      })
      .where(eq(heartbeatRuns.id, runId));

    res.status(200).json({ status: "dismissed" });
  });

  return router;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inferArtifactType(output: DetectedOutput): string {
  const ext = output.filename.split(".").pop()?.toLowerCase();

  const codeExts = new Set([
    "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rs", "go", "java",
    "c", "cpp", "h", "hpp", "rb", "php", "swift", "kt", "scala", "sh",
    "bash", "zsh", "ps1", "sql", "vue", "svelte",
  ]);
  const docExts = new Set(["md", "mdx", "txt", "csv", "html", "htm"]);
  const designExts = new Set(["svg", "png", "jpg", "jpeg", "gif", "webp", "ico", "fig"]);
  const presentationExts = new Set(["pptx", "ppt", "key"]);

  if (output.artifactType) return output.artifactType;
  if (ext && codeExts.has(ext)) return "code";
  if (ext && docExts.has(ext)) return "document";
  if (ext && designExts.has(ext)) return "design";
  if (ext && presentationExts.has(ext)) return "presentation";
  if (ext === "pdf" || ext === "docx") return "document";
  if (ext === "xlsx") return "report";

  return "other";
}
