import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cable, PlugZap } from "lucide-react";
import { useCompany } from "@/context/CompanyContext";
import { useTeamAccess } from "@/hooks/useTeamAccess";
import { healthApi } from "@/api/health";
import { agentsApi } from "@/api/agents";
import {
  mcpConnectorsApi,
  type CreateConnectorInput,
  type McpConnector,
} from "@/api/mcpConnectors";
import { ApiError } from "@/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/EmptyState";

const SERVER_NAME_RE = /^[a-z0-9-]+$/;

const inputCls =
  "w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-brand/50";

function TransportBadge({ transport }: { transport: McpConnector["transport"] }) {
  return (
    <Badge variant={transport === "http" ? "draft" : "idle"}>
      {transport === "http" ? "HTTP" : "stdio"}
    </Badge>
  );
}

function StatusBadge({ status }: { status: McpConnector["status"] }) {
  if (status === "active") return <Badge variant="active">Active</Badge>;
  if (status === "pending_approval") return <Badge variant="pending">Pending approval</Badge>;
  return <Badge variant="archived">Disabled</Badge>;
}

export function MCPConnectorsSection() {
  const { selectedCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const companyId = selectedCompanyId ?? null;

  const { role } = useTeamAccess(companyId);
  const isFounder = role === "founder";

  const { data: health } = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => healthApi.get(),
  });
  // Default to the safe (restrictive) assumption while health loads: treat as a
  // shared deployment so we never briefly offer stdio in an authenticated host.
  const isLocalTrusted = health?.deploymentMode === "local_trusted";

  const { data: connectors } = useQuery({
    queryKey: companyId ? queryKeys.mcpConnectors.list(companyId) : ["mcp-connectors", "none"],
    queryFn: () => mcpConnectorsApi.list(companyId!),
    enabled: !!companyId,
  });

  const { data: agents } = useQuery({
    queryKey: companyId ? queryKeys.agents.list(companyId) : ["agents", "none"],
    queryFn: () => agentsApi.list(companyId!),
    enabled: !!companyId,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.mcpConnectors.list(companyId!) });

  // ── Add form state ────────────────────────────────────────────────────────
  const [displayName, setDisplayName] = useState("");
  const [serverName, setServerName] = useState("");
  const [transport, setTransport] = useState<"http" | "stdio">("http");
  const [url, setUrl] = useState("");
  const [command, setCommand] = useState("");
  const [argsText, setArgsText] = useState("");
  const [secretRef, setSecretRef] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [approvalNotice, setApprovalNotice] = useState<string | null>(null);
  // Inline surface for disable/remove failures (previously swallowed silently).
  const [actionError, setActionError] = useState<string | null>(null);

  const serverNameValid = serverName === "" || SERVER_NAME_RE.test(serverName);
  // stdio is host-executing → only offered on a local_trusted host (D7).
  const stdioAllowed = isLocalTrusted;

  const resetForm = () => {
    setDisplayName("");
    setServerName("");
    setTransport("http");
    setUrl("");
    setCommand("");
    setArgsText("");
    setSecretRef("");
    setHeadersText("");
  };

  const createMutation = useMutation({
    mutationFn: (body: CreateConnectorInput) => mcpConnectorsApi.create(companyId!, body),
    onSuccess: (created) => {
      setFormError(null);
      resetForm();
      if (created.approvalId) {
        setApprovalNotice(
          `"${created.displayName}" was created and is pending board approval before agents can use it.`,
        );
      } else {
        setApprovalNotice(null);
      }
      invalidate();
    },
    onError: (err) => {
      setApprovalNotice(null);
      setFormError(err instanceof ApiError ? err.message : "Failed to create connector");
    },
  });

  const disableMutation = useMutation({
    mutationFn: (id: string) => mcpConnectorsApi.update(companyId!, id, { status: "disabled" }),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: (err) =>
      setActionError(err instanceof ApiError ? err.message : "Failed to disable connector"),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => mcpConnectorsApi.remove(companyId!, id),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: (err) =>
      setActionError(err instanceof ApiError ? err.message : "Failed to remove connector"),
  });

  const handleSubmit = () => {
    setFormError(null);
    setApprovalNotice(null);
    if (!displayName.trim()) return setFormError("Display name is required.");
    if (!serverName.trim()) return setFormError("Server name is required.");
    if (!SERVER_NAME_RE.test(serverName))
      return setFormError("Server name must match /^[a-z0-9-]+$/ (lowercase letters, digits, hyphen).");
    // Early guard: a stdio connector in a non-local deployment is a guaranteed
    // 403 at the server (D7). Surface it inline instead of round-tripping.
    if (transport === "stdio" && !stdioAllowed)
      return setFormError(
        "Local (stdio) connectors run a command on the host and are only available in local deployments.",
      );
    if (transport === "http" && !url.trim())
      return setFormError("HTTP transport requires a URL.");
    if (transport === "stdio" && !command.trim())
      return setFormError("stdio transport requires a command.");

    const args = argsText
      .split(/\s*\n\s*|\s+/)
      .map((a) => a.trim())
      .filter(Boolean);

    let headerTemplate: Record<string, string> | undefined;
    if (headersText.trim()) {
      const parsed: Record<string, string> = {};
      for (const line of headersText.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const idx = trimmed.indexOf(":");
        if (idx === -1) return setFormError(`Header line "${trimmed}" must be "Name: value".`);
        parsed[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
      }
      headerTemplate = parsed;
    }

    const body: CreateConnectorInput = {
      displayName: displayName.trim(),
      serverName: serverName.trim(),
      transport,
      ...(transport === "http" ? { url: url.trim() } : { command: command.trim() }),
      ...(transport === "stdio" && args.length ? { args } : {}),
      ...(headerTemplate && transport === "http" ? { headerTemplate } : {}),
      ...(secretRef.trim() ? { secretRef: secretRef.trim() } : {}),
    };
    createMutation.mutate(body);
  };

  return (
    <div>
      {/* Section header — OUTBOUND direction, distinct from the inbound MCP API keys section. */}
      <div className="px-8 pt-6 pb-3 border-b border-border">
        <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground/60 font-semibold">
          Settings · Operations
        </div>
        <h2 className="text-[1.4rem] font-bold tracking-tight mt-1">
          Connectors<span className="text-brand">.</span>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          External tools and data sources your agents can use. These are outbound — your
          agents reach out to remote MCP servers. Inbound API keys live under MCP API keys.
        </p>
      </div>

      <div className="p-8">
        {!companyId ? (
          <EmptyState icon={Cable} message="Select a company to manage connectors." />
        ) : (
          <div className="space-y-6">
            {/* Registered connectors */}
            <div className="space-y-4">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Registered connectors
              </div>
              <div className="rounded-md border border-border px-4 py-4 space-y-3">
                {actionError && <div className="text-sm text-destructive">{actionError}</div>}
                {(connectors ?? []).length === 0 ? (
                  <EmptyState
                    icon={PlugZap}
                    message="No connectors yet"
                    description="Connectors give your agents access to external tools and data sources — like a hosted MCP server for docs, tickets, or search."
                  />
                ) : (
                  <div className="space-y-2">
                    {(connectors ?? []).map((c) => (
                      <ConnectorRow
                        key={c.id}
                        connector={c}
                        agents={agents ?? []}
                        isFounder={isFounder}
                        onDisable={() => disableMutation.mutate(c.id)}
                        onRemove={() => removeMutation.mutate(c.id)}
                        disableBusy={disableMutation.isPending}
                        removeBusy={removeMutation.isPending}
                        companyId={companyId}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Add connector — founder only */}
            {isFounder ? (
              <div className="space-y-4">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Add a connector
                </div>
                <div className="rounded-md border border-border px-4 py-4 space-y-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="space-y-1">
                      <div className="text-xs text-muted-foreground">Display name</div>
                      <input
                        className={inputCls}
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Notion Docs"
                      />
                    </label>
                    <label className="space-y-1">
                      <div className="text-xs text-muted-foreground">Server name</div>
                      <input
                        className={inputCls}
                        value={serverName}
                        onChange={(e) => setServerName(e.target.value.trim())}
                        placeholder="notion-docs"
                        aria-invalid={!serverNameValid}
                      />
                      <div
                        className={
                          serverNameValid
                            ? "text-[11px] text-muted-foreground"
                            : "text-[11px] text-destructive"
                        }
                      >
                        Lowercase letters, digits, and hyphens only (/^[a-z0-9-]+$/).
                      </div>
                    </label>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="space-y-1">
                      <div className="text-xs text-muted-foreground">Transport</div>
                      <select
                        className={inputCls}
                        value={transport}
                        onChange={(e) => setTransport(e.target.value as "http" | "stdio")}
                      >
                        <option value="http">HTTP (remote server)</option>
                        <option value="stdio" disabled={!stdioAllowed}>
                          stdio (local command){stdioAllowed ? "" : " — local deployments only"}
                        </option>
                      </select>
                      {!stdioAllowed && (
                        <div className="text-[11px] text-muted-foreground">
                          Local (stdio) connectors run a command on the host and are only
                          available in local deployments.
                        </div>
                      )}
                    </label>

                    {transport === "http" ? (
                      <label className="space-y-1">
                        <div className="text-xs text-muted-foreground">URL</div>
                        <input
                          className={inputCls}
                          value={url}
                          onChange={(e) => setUrl(e.target.value)}
                          placeholder="https://mcp.example.com/sse"
                        />
                      </label>
                    ) : (
                      <label className="space-y-1">
                        <div className="text-xs text-muted-foreground">Command</div>
                        <input
                          className={inputCls}
                          value={command}
                          onChange={(e) => setCommand(e.target.value)}
                          placeholder="npx @example/mcp-server"
                        />
                      </label>
                    )}
                  </div>

                  {transport === "stdio" && (
                    <label className="space-y-1 block">
                      <div className="text-xs text-muted-foreground">
                        Arguments (whitespace or newline separated, optional)
                      </div>
                      <input
                        className={inputCls}
                        value={argsText}
                        onChange={(e) => setArgsText(e.target.value)}
                        placeholder="--port 8080 --verbose"
                      />
                    </label>
                  )}

                  {transport === "http" && (
                    <label className="space-y-1 block">
                      <div className="text-xs text-muted-foreground">
                        Headers (one per line, "Name: value", optional)
                      </div>
                      <textarea
                        className={`${inputCls} min-h-[64px] font-mono`}
                        value={headersText}
                        onChange={(e) => setHeadersText(e.target.value)}
                        // ${TOKEN} is the ONLY placeholder buildConnectorSpecs
                        // substitutes (services/mcp-connectors.ts). Naming any
                        // other variable here ships that literal to the MCP
                        // server, which then authenticates as no-one — and the
                        // obvious founder workaround is pasting a real token.
                        placeholder={"Authorization: Bearer ${TOKEN}"}
                      />
                    </label>
                  )}

                  <label className="space-y-1 block">
                    <div className="text-xs text-muted-foreground">
                      Secret reference (company secret name, optional)
                    </div>
                    <input
                      className={inputCls}
                      value={secretRef}
                      onChange={(e) => setSecretRef(e.target.value)}
                      placeholder="mcp:notion"
                    />
                    <div className="text-[11px] text-muted-foreground">
                      Must reference an existing company secret. Header/arg values use the{" "}
                      <code>{"${TOKEN}"}</code> placeholder, which resolves to it.
                    </div>
                  </label>

                  {formError && <div className="text-sm text-destructive">{formError}</div>}
                  {approvalNotice && (
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-foreground">
                      {approvalNotice}
                    </div>
                  )}

                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={handleSubmit}
                      disabled={createMutation.isPending || !serverNameValid}
                    >
                      {createMutation.isPending ? "Adding..." : "Add connector"}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-border px-4 py-3 text-sm text-muted-foreground">
                Only founders can add or change connectors.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface ConnectorRowProps {
  connector: McpConnector;
  agents: { id: string; name: string; status?: string }[];
  isFounder: boolean;
  onDisable: () => void;
  onRemove: () => void;
  disableBusy: boolean;
  removeBusy: boolean;
  companyId: string;
}

function ConnectorRow({
  connector,
  agents,
  isFounder,
  onDisable,
  onRemove,
  disableBusy,
  removeBusy,
  companyId,
}: ConnectorRowProps) {
  const queryClient = useQueryClient();
  const [showAgents, setShowAgents] = useState(false);
  // Seeded from the connector's CURRENT enabled-agent set (A34). PUT …/agents
  // REPLACES the whole set, so starting empty would silently wipe agents the
  // founder didn't touch. Re-seeding on open (and after a save-driven refetch)
  // keeps the checkboxes an accurate mirror of server state.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(connector.enabledAgentIds),
  );
  const [agentError, setAgentError] = useState<string | null>(null);
  const [agentSaved, setAgentSaved] = useState(false);

  // Seed on the closed→open transition only (deps: [showAgents]). The effect
  // captures the current enabledAgentIds from render, so an open always reflects
  // fresh server state; it deliberately does NOT re-run on a mid-open refetch,
  // so a just-saved confirmation isn't flash-cleared.
  useEffect(() => {
    if (!showAgents) return;
    setSelected(new Set(connector.enabledAgentIds));
    setAgentSaved(false);
    setAgentError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAgents]);

  const setAgentsMutation = useMutation({
    mutationFn: (agentIds: string[]) =>
      mcpConnectorsApi.setAgents(companyId, connector.id, agentIds),
    onSuccess: () => {
      setAgentError(null);
      setAgentSaved(true);
      // Refetch so connector.enabledAgentIds reflects the just-saved set — the
      // seed-on-open effect then mirrors server state on the next open (A34).
      queryClient.invalidateQueries({ queryKey: queryKeys.mcpConnectors.list(companyId) });
    },
    onError: (err) => {
      setAgentSaved(false);
      setAgentError(err instanceof ApiError ? err.message : "Failed to update agent access");
    },
  });

  const toggle = (id: string) => {
    setAgentSaved(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Hide terminated agents from the assignable checkboxes (they can't run, so
  // offering them is noise). Note: an already-enabled terminated agent stays in
  // `selected` (seeded from the full enabledAgentIds) and is PRESERVED on Save —
  // we hide it from the UI but don't forcibly revoke the link. Agents whose
  // status the list doesn't expose are kept (fail-open on unknown).
  const sortedAgents = useMemo(
    () =>
      [...agents]
        .filter((a) => a.status !== "terminated")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [agents],
  );

  return (
    <div className="rounded-md border border-border px-3 py-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{connector.displayName}</span>
            <TransportBadge transport={connector.transport} />
            <StatusBadge status={connector.status} />
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 font-mono break-all">
            {connector.serverName}
            {connector.transport === "http" && connector.url ? ` · ${connector.url}` : ""}
            {connector.transport === "stdio" && connector.command
              ? ` · ${connector.command}`
              : ""}
          </div>
        </div>
        {isFounder && (
          <div className="flex items-center gap-1 shrink-0">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowAgents((v) => !v)}
            >
              Agents
            </Button>
            {connector.status !== "disabled" && (
              <Button size="sm" variant="ghost" onClick={onDisable} disabled={disableBusy}>
                Disable
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={onRemove}
              disabled={removeBusy}
            >
              Delete
            </Button>
          </div>
        )}
      </div>

      {isFounder && showAgents && (
        <div className="rounded-md border border-border-soft bg-muted/20 px-3 py-3 space-y-2">
          <div className="text-xs text-muted-foreground">
            Choose which agents may use this connector. Checkboxes reflect the current
            set; Save replaces this connector's enabled-agent set with your selection.
          </div>
          {sortedAgents.length === 0 ? (
            <div className="text-sm text-muted-foreground">No agents in this company yet.</div>
          ) : (
            <div className="grid gap-1.5 sm:grid-cols-2">
              {sortedAgents.map((a) => (
                <label key={a.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.has(a.id)}
                    onChange={() => toggle(a.id)}
                  />
                  <span className="truncate">{a.name}</span>
                </label>
              ))}
            </div>
          )}
          {agentError && <div className="text-sm text-destructive">{agentError}</div>}
          {agentSaved && !agentError && (
            <div className="text-xs text-emerald-500">Agent access updated.</div>
          )}
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => setAgentsMutation.mutate([...selected])}
              disabled={setAgentsMutation.isPending}
            >
              {setAgentsMutation.isPending ? "Saving..." : "Save agent access"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
