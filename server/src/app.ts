import express, { Router, type Request as ExpressRequest } from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { Db } from "@armyofagents/db";
import type { DeploymentExposure, DeploymentMode, PaperclipPluginManifestV1 } from "@armyofagents/shared";
import type { StorageService } from "./storage/types.js";
import { httpLogger, errorHandler } from "./middleware/index.js";
import { actorMiddleware } from "./middleware/auth.js";
import { boardMutationGuard } from "./middleware/board-mutation-guard.js";
import { privateHostnameGuard, resolvePrivateHostnameAllowSet } from "./middleware/private-hostname-guard.js";
import { healthRoutes } from "./routes/health.js";
import { companyRoutes } from "./routes/companies.js";
import { agentRoutes } from "./routes/agents.js";
import { projectRoutes } from "./routes/projects.js";
import { issueRoutes } from "./routes/issues.js";
import { goalRoutes } from "./routes/goals.js";
import { teamsRoutes } from "./routes/teams.js";
import { teamImportsRoutes } from "./routes/team-imports.js";
import { approvalRoutes } from "./routes/approvals.js";
import { secretRoutes } from "./routes/secrets.js";
import { githubRoutes } from "./routes/github.js";
import { costRoutes } from "./routes/costs.js";
import { financeRoutes } from "./routes/finance.js";
import { quotaRoutes } from "./routes/quotas.js";
import { activityRoutes } from "./routes/activity.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { sidebarBadgeRoutes } from "./routes/sidebar-badges.js";
import { sidebarPreferencesRoutes } from "./routes/sidebar-preferences.js";
import { inboxDismissalRoutes } from "./routes/inbox-dismissals.js";
import { llmRoutes } from "./routes/llms.js";
import { assetRoutes } from "./routes/assets.js";
import { accessRoutes } from "./routes/access.js";
import { memoryRoutes } from "./routes/memory.js";
import { searchRoutes } from "./routes/search.js";
import { debriefRoutes } from "./routes/debriefs.js";
import { briefRoutes } from "./routes/briefs.js";
import { routineRoutes } from "./routes/routines.js";
import { dependencyRoutes } from "./routes/dependencies.js";
import { artifactRoutes } from "./routes/artifacts.js";
import { outputDetectionRoutes } from "./routes/output-detection.js";
import { trustScoreRoutes } from "./routes/trust-scores.js";
import { transcriptionRoutes } from "./routes/transcription.js";
import { memoryFeedbackRoutes } from "./routes/memory-feedback.js";
import { feedbackRoutes } from "./routes/feedback.js";
import { memoryLifecycleRoutes } from "./routes/memory-lifecycle.js";
import { suggestionRoutes } from "./routes/suggestions.js";
import { contextPackagingRoutes } from "./routes/context-packaging.js";
import { mcpServerRoutes } from "./mcp/server.js";
import { teamRoutes } from "./routes/team.js";
import { discussionRoutes } from "./routes/discussions.js";
import { notificationRoutes } from "./routes/notifications.js";
import { internalAgentRoutes } from "./routes/internal-agent.js";
import { workflowTemplateRoutes } from "./routes/workflow-templates.js";
import { companySkillRoutes } from "./routes/company-skills.js";
import { instanceSettingsRoutes } from "./routes/instance-settings.js";
import { cliAuthRoutes } from "./routes/cli-auth.js";
import { authProfileRoutes } from "./routes/auth-profile.js";
import { executionWorkspaceRoutes } from "./routes/execution-workspaces.js";
import { filesystemRoutes } from "./routes/filesystem.js";
import { adapterRoutes } from "./routes/adapters.js";
import { pluginRoutes, pluginCompanySettingsRoutes } from "./routes/plugins.js";
import { pluginUiStaticRoutes } from "./routes/plugin-ui-static.js";
import { pluginLoader } from "./services/plugin-loader.js";
import { createPluginWorkerManager } from "./services/plugin-worker-manager.js";
import { createPluginEventBus } from "./services/plugin-event-bus.js";
import { createPluginStreamBus } from "./services/plugin-stream-bus.js";
import { createPluginJobScheduler } from "./services/plugin-job-scheduler.js";
import { createPluginJobCoordinator } from "./services/plugin-job-coordinator.js";
import { pluginJobStore } from "./services/plugin-job-store.js";
import { createPluginToolDispatcher } from "./services/plugin-tool-dispatcher.js";
import { pluginLifecycleManager } from "./services/plugin-lifecycle.js";
import { buildHostServices } from "./services/plugin-host-services.js";
import { createHostClientHandlers } from "@armyofagents/plugin-sdk";
import { resolveAoaInstanceId } from "./home-paths.js";
import type { BetterAuthSessionResult } from "./auth/better-auth.js";

// Host version reported to plugin workers during initialize. Read from
// server package.json at import time; falls back to "0.0.0" if unreadable.
const SERVER_VERSION = (() => {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    // Try dist location (server/dist/app.js -> server/package.json) and source
    // location (server/src/app.ts -> server/package.json)
    const candidates = [
      path.resolve(__dirname, "../package.json"),
      path.resolve(__dirname, "../../package.json"),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const pkg = JSON.parse(fs.readFileSync(p, "utf-8")) as { version?: string };
        if (pkg.version) return pkg.version;
      }
    }
  } catch {
    // ignore
  }
  return "0.0.0";
})();

type UiMode = "none" | "static" | "vite-dev";

export async function createApp(
  db: Db,
  opts: {
    uiMode: UiMode;
    storageService: StorageService;
    deploymentMode: DeploymentMode;
    deploymentExposure: DeploymentExposure;
    allowedHostnames: string[];
    bindHost: string;
    authReady: boolean;
    companyDeletionEnabled: boolean;
    betterAuthHandler?: express.RequestHandler;
    resolveSession?: (req: ExpressRequest) => Promise<BetterAuthSessionResult | null>;
  },
) {
  const app = express();

  // Capture raw request body bytes so plugin webhook handlers can verify HMAC
  // signatures against the exact bytes the provider signed. Without this,
  // (req as any).rawBody is undefined and signature verification breaks.
  app.use(express.json({
    verify: (req, _res, buf) => {
      if (buf && buf.length > 0) {
        (req as unknown as { rawBody?: Buffer }).rawBody = buf;
      }
    },
  }));
  app.use(httpLogger);
  const privateHostnameGateEnabled =
    opts.deploymentMode === "authenticated" && opts.deploymentExposure === "private";
  const privateHostnameAllowSet = resolvePrivateHostnameAllowSet({
    allowedHostnames: opts.allowedHostnames,
    bindHost: opts.bindHost,
  });
  app.use(
    privateHostnameGuard({
      enabled: privateHostnameGateEnabled,
      allowedHostnames: opts.allowedHostnames,
      bindHost: opts.bindHost,
    }),
  );
  app.use(
    actorMiddleware(db, {
      deploymentMode: opts.deploymentMode,
      resolveSession: opts.resolveSession,
    }),
  );
  // Mount profile-aware auth routes (get-session with DB-loaded user, profile GET/PATCH)
  // before the betterAuthHandler catch-all so specific routes win.
  app.use("/api", authProfileRoutes(db));
  if (opts.betterAuthHandler) {
    app.all("/api/auth/{*authPath}", opts.betterAuthHandler);
  }
  app.use(llmRoutes(db));

  // Mount API routes
  const api = Router();
  api.use(boardMutationGuard());
  api.use(
    "/health",
    healthRoutes(db, {
      deploymentMode: opts.deploymentMode,
      deploymentExposure: opts.deploymentExposure,
      authReady: opts.authReady,
      companyDeletionEnabled: opts.companyDeletionEnabled,
    }),
  );
  api.use("/companies", companyRoutes(db));
  api.use(agentRoutes(db));
  api.use(assetRoutes(db, opts.storageService));
  api.use(projectRoutes(db));
  api.use(issueRoutes(db, opts.storageService));
  api.use(dependencyRoutes(db));
  api.use(goalRoutes(db));
  api.use(teamsRoutes(db));
  api.use(teamImportsRoutes(db));
  api.use(memoryRoutes(db));
  api.use(searchRoutes(db));
  api.use(debriefRoutes(db));
  api.use(briefRoutes(db));
  api.use(artifactRoutes(db));
  api.use(outputDetectionRoutes(db));
  api.use(trustScoreRoutes(db));
  api.use(transcriptionRoutes(db));
  api.use(memoryFeedbackRoutes(db));
  api.use(feedbackRoutes(db));
  api.use(memoryLifecycleRoutes(db));
  api.use(teamRoutes(db));
  api.use(suggestionRoutes(db));
  api.use(contextPackagingRoutes(db));
  api.use(discussionRoutes(db));
  api.use(notificationRoutes(db));
  api.use(workflowTemplateRoutes(db));
  api.use(internalAgentRoutes(db));
  api.use(mcpServerRoutes(db));
  api.use(approvalRoutes(db));
  api.use(secretRoutes(db));
  api.use(githubRoutes(db));
  api.use(costRoutes(db));
  api.use(financeRoutes(db));
  api.use(quotaRoutes(db));
  api.use(companySkillRoutes(db));
  api.use(routineRoutes(db));
  api.use(instanceSettingsRoutes(db));
  api.use(cliAuthRoutes(db));
  api.use(executionWorkspaceRoutes(db));
  api.use(filesystemRoutes());
  api.use(adapterRoutes());
  api.use(activityRoutes(db));
  api.use(dashboardRoutes(db));
  api.use(sidebarBadgeRoutes(db));
  api.use(sidebarPreferencesRoutes(db));
  api.use(inboxDismissalRoutes(db));
  api.use(
    accessRoutes(db, {
      deploymentMode: opts.deploymentMode,
      deploymentExposure: opts.deploymentExposure,
      bindHost: opts.bindHost,
      allowedHostnames: opts.allowedHostnames,
    }),
  );

  // Plugin subsystem initialization
  const workerMgr = createPluginWorkerManager();
  const eventBus = createPluginEventBus();
  const streamBus = createPluginStreamBus();
  const jobStoreInst = pluginJobStore(db);
  const toolDispatcherInst = createPluginToolDispatcher({
    workerManager: workerMgr,
    db,
  });
  const jobSchedulerInst = createPluginJobScheduler({
    db,
    jobStore: jobStoreInst,
    workerManager: workerMgr,
  });
  const lifecycleMgr = pluginLifecycleManager(db, {
    workerManager: workerMgr,
  });
  const jobCoordinatorInst = createPluginJobCoordinator({
    db,
    lifecycle: lifecycleMgr,
    scheduler: jobSchedulerInst,
    jobStore: jobStoreInst,
  });
  // Compose PluginRuntimeServices from existing subsystems + host services
  // factory. Without this, pluginLoader.loadAll() throws at startup and no
  // plugins activate. The loader.loadAll() call happens in index.ts after
  // the server is listening.
  const pluginRuntimeServices = {
    workerManager: workerMgr,
    eventBus,
    jobScheduler: jobSchedulerInst,
    jobStore: jobStoreInst,
    toolDispatcher: toolDispatcherInst,
    lifecycleManager: lifecycleMgr,
    buildHostHandlers: (pluginId: string, manifest: PaperclipPluginManifestV1) => {
      const services = buildHostServices(db, pluginId, manifest.id, eventBus);
      return createHostClientHandlers({
        pluginId,
        capabilities: manifest.capabilities ?? [],
        services,
      });
    },
    instanceInfo: {
      instanceId: resolveAoaInstanceId(),
      hostVersion: SERVER_VERSION,
    },
  };
  const loaderInst = pluginLoader(db, {}, pluginRuntimeServices);

  api.use(pluginRoutes(db, loaderInst, {
    scheduler: jobSchedulerInst,
    jobStore: jobStoreInst,
  }, {
    workerManager: workerMgr,
  }, {
    toolDispatcher: toolDispatcherInst,
  }, {
    workerManager: workerMgr,
    streamBus,
  }));
  api.use(pluginCompanySettingsRoutes(db));

  app.use("/api", api);

  // Plugin UI static assets (outside /api prefix)
  const pluginDir = path.resolve(
    process.env.AOA_PLUGIN_DIR ?? path.join(process.env.HOME ?? process.env.USERPROFILE ?? ".", ".aoa", "plugins"),
  );
  app.use("/_plugins", pluginUiStaticRoutes(db, { localPluginDir: pluginDir }));

  // Expose tool dispatcher globally so heartbeat can inject plugin tools into agent context
  (globalThis as any).__paperclipPluginToolDispatcher = toolDispatcherInst;

  // Expose plugin subsystem for startup/shutdown in index.ts
  (app as any).__pluginSubsystem = {
    workerManager: workerMgr,
    eventBus,
    streamBus,
    jobStore: jobStoreInst,
    toolDispatcher: toolDispatcherInst,
    jobScheduler: jobSchedulerInst,
    jobCoordinator: jobCoordinatorInst,
    lifecycle: lifecycleMgr,
    loader: loaderInst,
  };

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  if (opts.uiMode === "static") {
    // Try published location first (server/ui-dist/), then monorepo dev location (../../ui/dist)
    const candidates = [
      path.resolve(__dirname, "../ui-dist"),
      path.resolve(__dirname, "../../ui/dist"),
    ];
    const uiDist = candidates.find((p) => fs.existsSync(path.join(p, "index.html")));
    if (uiDist) {
      app.use(express.static(uiDist));
      app.get(/.*/, (_req, res) => {
        res.sendFile(path.join(uiDist, "index.html"));
      });
    } else {
      console.warn("[aoa] UI dist not found; running in API-only mode");
    }
  }

  if (opts.uiMode === "vite-dev") {
    const uiRoot = path.resolve(__dirname, "../../ui");
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      root: uiRoot,
      appType: "spa",
      server: {
        middlewareMode: true,
        allowedHosts: privateHostnameGateEnabled ? Array.from(privateHostnameAllowSet) : undefined,
      },
    });

    app.use(vite.middlewares);
    app.get(/.*/, async (req, res, next) => {
      try {
        const templatePath = path.resolve(uiRoot, "index.html");
        const template = fs.readFileSync(templatePath, "utf-8");
        const html = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } catch (err) {
        next(err);
      }
    });
  }

  app.use(errorHandler);

  return app;
}
