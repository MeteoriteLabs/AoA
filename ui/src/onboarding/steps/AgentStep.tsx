import { useEffect, useState } from "react";
import type { StepProps } from "../registry";
import { agentsApi } from "../../api/agents";
import { projectsApi } from "../../api/projects";
import { internalAgentApi } from "../../api/internal-agent";
import { advanceOnboarding } from "../../api/onboarding";
import { Button } from "@/components/ui/button";

type AgentRow = { id: string; kind?: string; name?: string };
type ProjectRow = { id: string; type?: string };

/** Commander cliTool → agent adapter type (mirror server cliToolToAdapterType). */
function cliToolToAdapterType(cliTool: string | null | undefined): string {
  if (cliTool === "codex") return "codex_local";
  if (cliTool === "opencode") return "opencode_local";
  return "claude_local";
}

/**
 * "Create your first agent" step (Stage C / order 7). The agent inherits the
 * Commander runtime (no adapter picker in the happy path), is preselected into
 * the department created in the previous step, and — fixing today's gap — is
 * assigned to that department AT creation via projectsApi.assignAgent (the old
 * wizard never assigned it). Idempotent: reuses an existing same-named org
 * agent. Advances AGENT_ASSIGNED on success.
 */
export function AgentStep({ ctx, onComplete }: StepProps) {
  const [name, setName] = useState("Director");
  const [purpose, setPurpose] = useState(
    "Coordinate work in this department and hire the team as needed.",
  );
  const [adapterType, setAdapterType] = useState<string>("claude_local");
  const [deptId, setDeptId] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ctx.companyId) return;
    internalAgentApi
      .getConfig(ctx.companyId)
      .then((cfg) => setAdapterType(cliToolToAdapterType((cfg as { cliTool?: string | null })?.cliTool)))
      .catch(() => {});
    projectsApi
      .list(ctx.companyId)
      .then((ps) => {
        const dept = (ps as ProjectRow[]).find((p) => p.type === "department");
        if (dept) setDeptId(dept.id);
      })
      .catch(() => {});
  }, [ctx.companyId]);

  const create = async () => {
    if (!ctx.companyId || !name.trim() || !deptId) return;
    setBusy(true);
    setError(null);
    try {
      const existing = (await agentsApi.list(ctx.companyId).catch(() => [])) as AgentRow[];
      let agentId = existing.find((a) => a.kind === "org" && a.name === name.trim())?.id ?? null;

      if (!agentId) {
        const agent = await agentsApi.create(ctx.companyId, {
          name: name.trim(),
          role: "cxo",
          capabilities: purpose.trim() || undefined,
          adapterType, // inherits Commander runtime
          adapterConfig: {},
          runtimeConfig: {
            heartbeat: {
              enabled: true,
              intervalSec: 3600,
              wakeOnDemand: true,
              cooldownSec: 10,
              maxConcurrentRuns: 1,
            },
          },
        });
        agentId = (agent as AgentRow).id;
      }
      // FIX: assign the agent to the department AT creation.
      await projectsApi.assignAgent(deptId, agentId, ctx.companyId);
      await advanceOnboarding({
        companyId: ctx.companyId,
        journey: ctx.journey,
        requestedState: "AGENT_ASSIGNED",
      });
      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create your agent.");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md py-10">
      <h1 className="text-xl font-semibold">Create your first agent</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        It runs on your Commander runtime and is assigned to your department automatically.
      </p>
      <label className="mt-6 mb-1 block text-xs text-muted-foreground">Agent name</label>
      <input
        className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <label className="mt-3 mb-1 block text-xs text-muted-foreground">Purpose</label>
      <textarea
        className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        value={purpose}
        onChange={(e) => setPurpose(e.target.value)}
      />
      <button
        type="button"
        className="mt-3 text-xs text-muted-foreground underline"
        onClick={() => setShowAdvanced((v) => !v)}
      >
        {showAdvanced ? "Hide" : "Show"} advanced settings
      </button>
      {showAdvanced && (
        <div className="mt-2 rounded-md border border-border p-3 text-xs text-muted-foreground">
          Heartbeat, context mode, retry, and permissions default to the recommended settings and
          can be tuned later on the Agent page. Runtime is inherited from Commander ({adapterType}).
        </div>
      )}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <Button
        className="mt-4 w-full"
        onClick={() => void create()}
        disabled={busy || !name.trim() || !deptId}
      >
        {busy ? "Creating…" : "Create & assign"}
      </Button>
    </div>
  );
}
