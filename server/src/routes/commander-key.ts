import { Router, type Request, type Response } from "express";
import type { Db } from "@armyofagents/db";
import { agents, internalAgentConfig } from "@armyofagents/db";
import { eq } from "drizzle-orm";
import { assertRole } from "../middleware/rbac.js";
import { assertCompanyAccess } from "./authz.js";
import { secretService } from "../services/secrets.js";
import { persistCommanderApiKey } from "../services/commander-key.js";

/**
 * Save a pasted Commander API key (Plan 3 / §6.1). Founder-scoped: an EXPLICIT
 * board-actor check precedes assertRole (agents bypass assertRole — Codex #10).
 * The raw key goes to the encrypted vault; a secret_ref is bound into the
 * Commander agent's adapterConfig.env (see persistCommanderApiKey). The verify
 * route (T1) then probes the resolved config, so the key unblocks re-probe.
 */
export function commanderKeyRoutes(db: Db): Router {
  const router = Router();

  router.post("/companies/:companyId/internal-agent/commander-key", async (req: Request, res: Response) => {
    const actor = req.actor;
    if (actor.type !== "board" || !actor.userId) {
      res.status(401).json({ error: "authentication required" });
      return;
    }
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    await assertRole(db, req, companyId, "founder");

    const provider = req.body?.provider;
    const value = typeof req.body?.value === "string" ? req.body.value.trim() : "";
    if (provider !== "anthropic" && provider !== "openai") {
      res.status(400).json({ error: "provider must be 'anthropic' or 'openai'" });
      return;
    }
    if (!value) {
      res.status(400).json({ error: "value is required" });
      return;
    }

    // Load the Commander agent (its adapterConfig is the executable config).
    const [cfg] = await db
      .select({ agentId: internalAgentConfig.agentId })
      .from(internalAgentConfig)
      .where(eq(internalAgentConfig.companyId, companyId))
      .limit(1);
    if (!cfg?.agentId) {
      res.status(404).json({ error: "no Commander agent configured" });
      return;
    }
    const [agent] = await db
      .select({ adapterConfig: agents.adapterConfig })
      .from(agents)
      .where(eq(agents.id, cfg.agentId))
      .limit(1);
    const adapterConfig = (agent?.adapterConfig as Record<string, unknown> | null) ?? {};

    const secrets = secretService(db);
    const { secretId } = await persistCommanderApiKey(
      {
        writeSecret: async (a) => {
          const created = (await secrets.create(
            companyId,
            { name: a.name, key: a.key, provider: "local_encrypted", managedMode: "aoa_managed", value: a.value },
            { userId: actor.userId ?? "board", agentId: null },
          )) as { id?: string; secretId?: string };
          const secretId = created.secretId ?? created.id;
          if (!secretId) throw new Error("secret create returned no id");
          return { secretId };
        },
        updateAgentAdapterConfig: async (a) => {
          await db
            .update(agents)
            .set({ adapterConfig: a.adapterConfig, updatedAt: new Date() })
            .where(eq(agents.id, a.agentId));
        },
        syncEnvBindings: async (a) => {
          await secrets.syncEnvBindingsForTarget(companyId, { targetType: "agent", targetId: a.targetId }, a.env);
        },
      },
      { companyId, agentId: cfg.agentId, provider, apiKey: value, adapterConfig },
    );

    res.json({ ok: true, secretId });
  });

  return router;
}
