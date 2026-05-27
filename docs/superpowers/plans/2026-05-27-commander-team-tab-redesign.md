# CommanderTeamTab Redesign (T4.4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat single-view `CommanderTeamTab` with a three-sub-tab layout — Roster (agent cards + budget bar + trust score), Kanban (task-first live status board), and Governance (oversight table with inline founder-only actions).

**Architecture:** The redesign lives entirely in `ui/src/components/team/` — the parent `TeamPage.tsx` already fetches AoA agents and passes them in; we add two co-fetched queries (trust scores, live runs) that are lifted into `TeamPage` so they share a cache lifetime with the agents query. The three sub-tab panels are split into focused sub-components (`CommanderRosterTab`, `CommanderKanbanTab`, `CommanderGovernanceTab`) each receiving typed props; `CommanderTeamTab` becomes a thin shell that owns sub-tab routing and composes them.

**Tech Stack:** React 18, TanStack Query v5, Tailwind CSS v4, Shadcn UI `<Tabs>`, TypeScript 5 — all already in the project.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `ui/src/pages/TeamPage.tsx` | Add trust-scores + live-runs queries; pass to `CommanderTeamTab` |
| Rewrite | `ui/src/components/team/CommanderTeamTab.tsx` | Sub-tab shell (Roster / Kanban / Governance) + data plumbing |
| Create | `ui/src/components/team/CommanderRosterTab.tsx` | Agent cards grid with budget bar + trust score badge |
| Create | `ui/src/components/team/CommanderKanbanTab.tsx` | Task-first 5-column Kanban board |
| Create | `ui/src/components/team/CommanderGovernanceTab.tsx` | Oversight table + inline founder actions |

No new API endpoints needed — all mutations use existing `agentsApi` / `approvalsApi`.

---

## Task 1 — Lift trust-scores and live-runs queries into TeamPage

### Purpose
`CommanderRosterTab` needs trust scores; `CommanderKanbanTab` needs live runs. Fetching them in `TeamPage` keeps cache keys consistent with the rest of the page and avoids double-fetching if the user switches sub-tabs.

**Files:**
- Modify: `ui/src/pages/TeamPage.tsx`

- [ ] **Step 1: Open the file and locate the existing `commanderAgentsQuery`**

  Line 69–73 of `TeamPage.tsx`:
  ```tsx
  const commanderAgentsQuery = useQuery({
    queryKey: selectedCompanyId ? ["aoa-agents", selectedCompanyId] : ["aoa-agents", "none"],
    queryFn: () => agentsApi.listAoa(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });
  ```

- [ ] **Step 2: Add the two new import lines at the top of the file**

  After the existing import block (around line 7), add:
  ```tsx
  import { trustScoresApi } from "../api/trust-scores";
  import { heartbeatsApi } from "../api/heartbeats";
  import type { AgentTrustScore } from "@armyofagents/shared";
  import type { LiveRunForIssue } from "../api/heartbeats";
  ```

- [ ] **Step 3: Add the two new queries directly after `commanderAgentsQuery`**

  ```tsx
  const commanderTrustQuery = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.trustScores.list(selectedCompanyId)
      : ["trust-scores", "none"],
    queryFn: () => trustScoresApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  const commanderLiveRunsQuery = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.liveRuns(selectedCompanyId)
      : ["live-runs", "none"],
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
    refetchInterval: 10_000, // poll every 10s while tab is active
  });
  ```

- [ ] **Step 4: Extend the `isLoading` guard to include the new queries**

  Current (lines 159–163):
  ```tsx
  const isLoading =
    (activeTab === "org" && orgTreeQuery.isLoading) ||
    (activeTab === "agents" && agentsQuery.isLoading) ||
    (activeTab === "humans" && isTeamLoading) ||
    (activeTab === "commander" && commanderAgentsQuery.isLoading);
  ```

  Replace with:
  ```tsx
  const isLoading =
    (activeTab === "org" && orgTreeQuery.isLoading) ||
    (activeTab === "agents" && agentsQuery.isLoading) ||
    (activeTab === "humans" && isTeamLoading) ||
    (activeTab === "commander" &&
      (commanderAgentsQuery.isLoading ||
        commanderTrustQuery.isLoading ||
        commanderLiveRunsQuery.isLoading));
  ```

- [ ] **Step 5: Pass the new data into `CommanderTeamTab` (lines 213–219)**

  Current:
  ```tsx
  {!isLoading && activeTab === "commander" && (
    <CommanderTeamTab
      agents={commanderAgentsQuery.data ?? []}
      permissions={{ isFounder: role === "founder" }}
      onMutationSuccess={invalidateAll}
    />
  )}
  ```

  Replace with:
  ```tsx
  {!isLoading && activeTab === "commander" && (
    <CommanderTeamTab
      agents={commanderAgentsQuery.data ?? []}
      trustScores={commanderTrustQuery.data ?? []}
      liveRuns={commanderLiveRunsQuery.data ?? []}
      permissions={{ isFounder: role === "founder" }}
      onMutationSuccess={invalidateAll}
    />
  )}
  ```

- [ ] **Step 6: Run the dev server to confirm no TypeScript errors before continuing**

  ```bash
  cd "C:\Users\TK\OneDrive\Desktop\Claude Data\Paperclip-AoA\AoA-2.5"
  pnpm --filter ui typecheck 2>&1 | head -30
  ```
  Expected: exit 0 (or only pre-existing errors, none in TeamPage).

- [ ] **Step 7: Commit**

  ```bash
  git add ui/src/pages/TeamPage.tsx
  git commit -m "feat(team): lift trust-scores + live-runs queries into TeamPage for CommanderTeamTab"
  ```

---

## Task 2 — Create `CommanderRosterTab`

### Purpose
The enhanced agent card grid: each card shows the existing name/status/adapter info plus a budget progress bar and a trust-score badge at the bottom.

**Files:**
- Create: `ui/src/components/team/CommanderRosterTab.tsx`

- [ ] **Step 1: Create the file with this complete content**

  ```tsx
  import type { Agent, AgentTrustScore } from "@armyofagents/shared";
  import { useNavigate } from "@/lib/router";
  import { cn } from "../../lib/utils";
  import { StatusBadge } from "../StatusBadge";
  import { AgentIcon } from "../AgentIconPicker";
  import { agentStatusDot, agentStatusDotDefault } from "../../lib/status-colors";
  import {
    getTrustScoreTone,
    getTrustScoreToneClasses,
    formatTrustScorePercent,
    hasTrustScoreData,
  } from "../../lib/trust-score";
  import { Button } from "@/components/ui/button";
  import { Plus } from "lucide-react";

  interface CommanderRosterTabProps {
    agents: Agent[];
    trustScores: AgentTrustScore[];
    isFounder: boolean;
    onNewAgent: () => void;
  }

  function BudgetBar({ spent, limit }: { spent: number; limit: number }) {
    const pct = limit > 0 ? Math.min(100, Math.round((spent / limit) * 100)) : 0;
    const spentDollars = (spent / 100).toFixed(0);
    const limitDollars = (limit / 100).toFixed(0);
    const color =
      pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-yellow-500" : "bg-green-500";

    return (
      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="shrink-0">Budget</span>
        <div className="flex-1 h-1 rounded-full bg-accent overflow-hidden">
          <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
        </div>
        <span className={cn("shrink-0", pct >= 90 && "text-red-400")}>
          ${spentDollars} / ${limitDollars}
        </span>
      </div>
    );
  }

  export function CommanderRosterTab({
    agents,
    trustScores,
    isFounder,
    onNewAgent,
  }: CommanderRosterTabProps) {
    const navigate = useNavigate();
    const trustMap = new Map(trustScores.map((ts) => [ts.agentId, ts]));

    return (
      <>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold">
              Commander Team{" "}
              <span className="ml-1 text-xs font-medium text-muted-foreground">
                {agents.length}
              </span>
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">AoA agents in this company</p>
          </div>
          {isFounder && (
            <Button size="sm" variant="outline" onClick={onNewAgent}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              New AoA Agent
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent) => {
            const isLead = (agent.runtimeConfig as any)?.aoa?.role === "lead";
            const isRunning = agent.status === "running";
            const trust = trustMap.get(agent.id) ?? null;
            const hasTrust = hasTrustScoreData(trust);
            const tone = trust ? getTrustScoreTone(trust.currentScore) : null;
            const toneClasses = tone ? getTrustScoreToneClasses(tone) : null;
            const dotClass = agentStatusDot[agent.status] ?? agentStatusDotDefault;

            return (
              <div
                key={agent.id}
                className={cn(
                  "group relative border border-border bg-card rounded-lg p-4",
                  "transition-all duration-150 cursor-pointer",
                  "hover:border-primary/40 hover:shadow-sm",
                  isRunning && "border-cyan-500/30 shadow-[0_0_12px_rgba(6,182,212,0.06)]",
                )}
                onClick={() => navigate(`/team/aoa/${agent.id}`)}
              >
                {/* Header */}
                <div className="flex items-start gap-3">
                  <div className="shrink-0 flex items-center justify-center h-10 w-10 rounded-lg bg-accent">
                    <AgentIcon icon={agent.icon} className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold truncate">{agent.name}</h3>
                      <div className={cn("h-2.5 w-2.5 rounded-full shrink-0", dotClass)} />
                      {isLead && (
                        <span className="inline-flex items-center rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand ring-1 ring-inset ring-brand/20">
                          Lead
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {isLead ? "Commander" : "Member"} · {agent.adapterType}
                    </p>
                  </div>
                </div>

                {/* Body */}
                <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <StatusBadge status={agent.status} />
                </div>

                {/* Footer */}
                <div className="mt-3 pt-3 border-t border-border/50 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    {agent.lastHeartbeatAt
                      ? `Last active ${new Date(agent.lastHeartbeatAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                      : "Never run"}
                  </span>
                  {hasTrust && trust && toneClasses && (
                    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 font-medium", toneClasses.badge)}>
                      {formatTrustScorePercent(trust.currentScore)}
                    </span>
                  )}
                </div>

                {/* Budget bar */}
                <BudgetBar spent={agent.spentMonthlyCents} limit={agent.budgetMonthlyCents} />
              </div>
            );
          })}
        </div>
      </>
    );
  }
  ```

- [ ] **Step 2: Run typecheck**

  ```bash
  pnpm --filter ui typecheck 2>&1 | head -30
  ```
  Expected: exit 0 (or only pre-existing unrelated errors).

- [ ] **Step 3: Commit**

  ```bash
  git add ui/src/components/team/CommanderRosterTab.tsx
  git commit -m "feat(team): add CommanderRosterTab with budget bar and trust score"
  ```

---

## Task 3 — Create `CommanderKanbanTab`

### Purpose
A task-first, 5-column board (Idle / Running / Awaiting Approval / Error / Paused) where each card's headline is the *task title* (from `liveRuns`), with the agent shown only as a small attribution footer. Agents with no live run appear in the Idle column with a "waiting for next task" card.

**Files:**
- Create: `ui/src/components/team/CommanderKanbanTab.tsx`

- [ ] **Step 1: Create the file with this complete content**

  ```tsx
  import type { Agent } from "@armyofagents/shared";
  import type { LiveRunForIssue } from "../../api/heartbeats";
  import { cn } from "../../lib/utils";
  import { AgentIcon } from "../AgentIconPicker";
  import { formatDistanceToNowStrict } from "date-fns";

  interface CommanderKanbanTabProps {
    agents: Agent[];
    liveRuns: LiveRunForIssue[];
  }

  type KanbanColumn = {
    id: string;
    label: string;
    dotClass: string;
    emptyText: string;
  };

  const COLUMNS: KanbanColumn[] = [
    { id: "idle",     label: "Idle",             dotClass: "bg-yellow-400",  emptyText: "No idle agents" },
    { id: "running",  label: "Running",           dotClass: "bg-cyan-400 animate-pulse", emptyText: "Nothing running" },
    { id: "approval", label: "Awaiting Approval", dotClass: "bg-amber-400",  emptyText: "No pending approvals" },
    { id: "error",    label: "Error",             dotClass: "bg-red-400",    emptyText: "No errors" },
    { id: "paused",   label: "Paused",            dotClass: "bg-yellow-400", emptyText: "No agents paused" },
  ];

  function agentStatusToColumn(status: string): string {
    switch (status) {
      case "running":          return "running";
      case "pending_approval": return "approval";
      case "error":            return "error";
      case "paused":           return "paused";
      default:                 return "idle"; // active, idle, archived
    }
  }

  function relativeTime(date: string | Date | null | undefined): string {
    if (!date) return "";
    try {
      return formatDistanceToNowStrict(new Date(date), { addSuffix: true });
    } catch {
      return "";
    }
  }

  export function CommanderKanbanTab({ agents, liveRuns }: CommanderKanbanTabProps) {
    // Build agentId → live run lookup
    const runByAgent = new Map<string, LiveRunForIssue>(
      liveRuns.map((r) => [r.agentId, r]),
    );

    // Group agents by column
    const byColumn = new Map<string, Agent[]>(COLUMNS.map((c) => [c.id, []]));
    for (const agent of agents) {
      const col = agentStatusToColumn(agent.status);
      byColumn.get(col)!.push(agent);
    }

    return (
      <div className="overflow-x-auto pb-4">
        <div className="flex gap-3.5 items-start min-w-max">
          {COLUMNS.map((col) => {
            const colAgents = byColumn.get(col.id) ?? [];
            return (
              <div key={col.id} className="w-[250px] shrink-0 flex flex-col gap-2.5">
                {/* Column header */}
                <div className="flex items-center gap-1.5 px-0.5 pb-2 border-b border-border/50">
                  <div className={cn("w-2 h-2 rounded-full shrink-0", col.dotClass)} />
                  <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                    {col.label}
                  </span>
                  <span className="ml-auto bg-card text-muted-foreground/60 text-[10px] font-bold px-1.5 py-0.5 rounded-lg">
                    {colAgents.length}
                  </span>
                </div>

                {/* Cards */}
                {colAgents.length === 0 ? (
                  <div className="border border-dashed border-border rounded-lg p-5 text-center text-[11px] text-muted-foreground/40">
                    {col.emptyText}
                  </div>
                ) : (
                  colAgents.map((agent) => {
                    const run = runByAgent.get(agent.id);
                    const isLive = col.id === "running";
                    const isApproval = col.id === "approval";
                    const isError = col.id === "error";

                    return (
                      <div
                        key={agent.id}
                        className={cn(
                          "border border-border bg-card rounded-lg p-3 cursor-pointer",
                          "transition-colors duration-150 hover:bg-card/80",
                          isLive && "border-cyan-500/30 bg-cyan-950/5",
                          isApproval && "border-amber-500/30",
                          isError && "border-red-500/30",
                        )}
                      >
                        {/* Task title — primary content */}
                        <p className="text-[13px] font-semibold leading-snug mb-1 line-clamp-3">
                          {run?.issueId
                            ? `Task #${run.issueId.slice(-6)}`
                            : col.id === "idle"
                            ? agent.lastHeartbeatAt
                              ? "Last task completed"
                              : "Waiting for first task"
                            : "Working…"}
                        </p>

                        {/* Status/timing line */}
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-2.5">
                          {isLive && (
                            <span className="relative flex h-2 w-2 shrink-0">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-400" />
                            </span>
                          )}
                          <span className={isLive ? "text-cyan-400 font-medium" : ""}>
                            {isLive && run?.startedAt
                              ? `Running · ${relativeTime(run.startedAt)}`
                              : isApproval
                              ? `Waiting · ${relativeTime(run?.createdAt)}`
                              : isError && run?.finishedAt
                              ? `Failed ${relativeTime(run.finishedAt)}`
                              : col.id === "idle" && agent.lastHeartbeatAt
                              ? `Completed ${relativeTime(agent.lastHeartbeatAt)}`
                              : col.id === "paused"
                              ? "Paused"
                              : "—"}
                          </span>
                        </div>

                        {/* Callout strip for notable states */}
                        {isApproval && (
                          <div className="mb-2.5 rounded-md px-2.5 py-1.5 text-[11px] bg-amber-950/30 border border-amber-500/20 text-amber-300">
                            🔔 Decision needed before continuing
                          </div>
                        )}
                        {isError && (
                          <div className="mb-2.5 rounded-md px-2.5 py-1.5 text-[11px] bg-red-950/20 border border-red-500/20 text-red-300">
                            ⚠ Exit error — check agent logs
                          </div>
                        )}
                        {col.id === "idle" && !agent.lastHeartbeatAt && (
                          <div className="mb-2.5 rounded-md px-2.5 py-1.5 text-[11px] bg-white/[0.03] border border-border/50 text-muted-foreground">
                            Waiting for next task
                          </div>
                        )}

                        {/* Agent attribution footer */}
                        <div className="flex items-center gap-1.5 pt-2 border-t border-border/50">
                          <div className="h-5 w-5 rounded-[5px] bg-accent flex items-center justify-center shrink-0">
                            <AgentIcon icon={agent.icon} className="h-3 w-3" />
                          </div>
                          <span className="text-[11px] font-medium text-muted-foreground truncate flex-1 min-w-0">
                            {agent.name}
                          </span>
                          <span className="text-[10px] text-muted-foreground/50 font-mono shrink-0">
                            {agent.adapterType}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 2: Run typecheck**

  ```bash
  pnpm --filter ui typecheck 2>&1 | head -30
  ```
  Expected: exit 0.

- [ ] **Step 3: Commit**

  ```bash
  git add ui/src/components/team/CommanderKanbanTab.tsx
  git commit -m "feat(team): add CommanderKanbanTab task-first live status board"
  ```

---

## Task 4 — Create `CommanderGovernanceTab`

### Purpose
An oversight table with columns: Agent · Trust · Budget (editable limit) · Can hire (toggle) · Approvals · Last run · Outcome · Actions. Actions are founder-only: Pause/Resume, Budget edit (PATCH `budgetMonthlyCents`), Can-hire toggle (PATCH `/permissions`), Quick-approve (POST `/approvals/:id/approve`).

**Files:**
- Create: `ui/src/components/team/CommanderGovernanceTab.tsx`

- [ ] **Step 1: Create the file with this complete content**

  ```tsx
  import { useState } from "react";
  import type { Agent, AgentTrustScore } from "@armyofagents/shared";
  import { useMutation, useQueryClient } from "@tanstack/react-query";
  import { useCompany } from "../../context/CompanyContext";
  import { useToast } from "../../context/ToastContext";
  import { agentsApi } from "../../api/agents";
  import { approvalsApi } from "../../api/approvals";
  import { queryKeys } from "../../lib/queryKeys";
  import { cn } from "../../lib/utils";
  import { AgentIcon } from "../AgentIconPicker";
  import { StatusBadge } from "../StatusBadge";
  import {
    getTrustScoreTone,
    getTrustScoreToneClasses,
    formatTrustScorePercent,
    hasTrustScoreData,
  } from "../../lib/trust-score";
  import { agentStatusDot, agentStatusDotDefault } from "../../lib/status-colors";
  import { formatDistanceToNowStrict } from "date-fns";

  interface CommanderGovernanceTabProps {
    agents: Agent[];
    trustScores: AgentTrustScore[];
    isFounder: boolean;
    onMutationSuccess?: () => void;
  }

  /** Inline-editable budget limit cell. Fires PATCH on blur if value changed. */
  function BudgetEditCell({
    agent,
    isFounder,
    onSave,
  }: {
    agent: Agent;
    isFounder: boolean;
    onSave: (cents: number) => void;
  }) {
    const spent = (agent.spentMonthlyCents / 100).toFixed(0);
    const limitDollars = (agent.budgetMonthlyCents / 100).toFixed(0);
    const [value, setValue] = useState(limitDollars);
    const pct =
      agent.budgetMonthlyCents > 0
        ? Math.min(100, Math.round((agent.spentMonthlyCents / agent.budgetMonthlyCents) * 100))
        : 0;
    const barColor =
      pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-yellow-500" : "bg-green-500";

    return (
      <div className="flex items-center gap-1.5 min-w-[130px]">
        <div className="w-11 h-1 rounded-full bg-accent overflow-hidden shrink-0">
          <div className={cn("h-full rounded-full", barColor)} style={{ width: `${pct}%` }} />
        </div>
        <span className={cn("text-[11px] text-muted-foreground", pct >= 90 && "text-red-400")}>
          ${spent} /
        </span>
        {isFounder ? (
          <input
            className={cn(
              "text-[12px] w-16 rounded-md px-1.5 py-0.5",
              "border border-transparent bg-transparent",
              "hover:border-border hover:bg-card",
              "focus:outline-none focus:border-brand focus:bg-background",
              "transition-colors cursor-text",
              pct >= 90 && "text-red-400",
            )}
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
            onBlur={() => {
              const num = parseInt(value, 10);
              if (!isNaN(num) && num !== parseInt(limitDollars, 10)) {
                onSave(num * 100);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") { setValue(limitDollars); (e.target as HTMLInputElement).blur(); }
            }}
            title="Monthly budget limit ($)"
          />
        ) : (
          <span className="text-[12px] text-muted-foreground">${limitDollars}</span>
        )}
        <span className="text-[10px] text-muted-foreground/50">/mo</span>
      </div>
    );
  }

  /** canCreateAgents toggle — visual only, calls onToggle on click */
  function CanHireToggle({
    enabled,
    isFounder,
    onToggle,
  }: {
    enabled: boolean;
    isFounder: boolean;
    onToggle: () => void;
  }) {
    return (
      <button
        className={cn(
          "flex items-center gap-1.5 cursor-default",
          isFounder && "cursor-pointer",
        )}
        onClick={isFounder ? onToggle : undefined}
        title={isFounder ? "Toggle canCreateAgents" : undefined}
      >
        <div
          className={cn(
            "relative w-7 h-4 rounded-full border transition-colors",
            enabled
              ? "bg-green-500/20 border-green-500/40"
              : "bg-card border-border",
          )}
        >
          <div
            className={cn(
              "absolute top-0.5 h-2.5 w-2.5 rounded-full transition-transform",
              enabled ? "translate-x-3.5 bg-green-400" : "translate-x-0.5 bg-muted-foreground/40",
            )}
          />
        </div>
        <span className="text-[11px] text-muted-foreground">
          {enabled ? "On" : "Off"}
        </span>
      </button>
    );
  }

  function relativeTime(date: string | Date | null | undefined): string {
    if (!date) return "—";
    try {
      return formatDistanceToNowStrict(new Date(date), { addSuffix: true });
    } catch {
      return "—";
    }
  }

  export function CommanderGovernanceTab({
    agents,
    trustScores,
    isFounder,
    onMutationSuccess,
  }: CommanderGovernanceTabProps) {
    const { selectedCompanyId } = useCompany();
    const { pushToast } = useToast();
    const queryClient = useQueryClient();
    const trustMap = new Map(trustScores.map((ts) => [ts.agentId, ts]));

    function invalidate() {
      if (!selectedCompanyId) return;
      queryClient.invalidateQueries({ queryKey: ["aoa-agents", selectedCompanyId] });
      queryClient.invalidateQueries({ queryKey: queryKeys.trustScores.list(selectedCompanyId) });
      onMutationSuccess?.();
    }

    const pauseMut = useMutation({
      mutationFn: (id: string) => agentsApi.pause(id, selectedCompanyId ?? undefined),
      onSuccess: () => { invalidate(); pushToast({ title: "Agent paused", tone: "success" }); },
      onError: (e: Error) => pushToast({ title: "Failed to pause", body: e.message, tone: "error" }),
    });

    const resumeMut = useMutation({
      mutationFn: (id: string) => agentsApi.resume(id, selectedCompanyId ?? undefined),
      onSuccess: () => { invalidate(); pushToast({ title: "Agent resumed", tone: "success" }); },
      onError: (e: Error) => pushToast({ title: "Failed to resume", body: e.message, tone: "error" }),
    });

    const budgetMut = useMutation({
      mutationFn: ({ id, cents }: { id: string; cents: number }) =>
        agentsApi.update(id, { budgetMonthlyCents: cents }, selectedCompanyId ?? undefined),
      onSuccess: () => { invalidate(); pushToast({ title: "Budget updated", tone: "success" }); },
      onError: (e: Error) => pushToast({ title: "Failed to update budget", body: e.message, tone: "error" }),
    });

    const permMut = useMutation({
      mutationFn: ({ id, canCreateAgents }: { id: string; canCreateAgents: boolean }) =>
        agentsApi.updatePermissions(id, { canCreateAgents }, selectedCompanyId ?? undefined),
      onSuccess: () => { invalidate(); pushToast({ title: "Permission updated", tone: "success" }); },
      onError: (e: Error) => pushToast({ title: "Failed to update permission", body: e.message, tone: "error" }),
    });

    const approveMut = useMutation({
      mutationFn: (approvalId: string) => approvalsApi.approve(approvalId),
      onSuccess: () => { invalidate(); pushToast({ title: "Approved", tone: "success" }); },
      onError: (e: Error) => pushToast({ title: "Failed to approve", body: e.message, tone: "error" }),
    });

    // Summary metrics
    const totalAgents = agents.length;
    const avgTrust = totalAgents > 0
      ? Math.round(trustScores.reduce((s, t) => s + t.currentScore, 0) / trustScores.length)
      : 0;
    const monthlySpend = agents.reduce((s, a) => s + a.spentMonthlyCents, 0);
    const errorCount = agents.filter((a) => a.status === "error").length;
    const pendingCount = agents.filter((a) => a.status === "pending_approval").length;

    return (
      <div className="space-y-5">
        {/* Summary metric cards */}
        <div className="flex flex-wrap gap-3">
          {[
            { label: "Avg trust", value: `${avgTrust}%`, color: "text-green-400" },
            { label: "Monthly spend", value: `$${(monthlySpend / 100).toFixed(0)}`, color: "text-blue-400" },
            { label: "Pending approvals", value: String(pendingCount), color: "text-amber-400" },
            { label: "In error state", value: String(errorCount), color: "text-red-400" },
          ].map((m) => (
            <div
              key={m.label}
              className="border border-border bg-card rounded-lg px-4 py-3 min-w-[110px]"
            >
              <div className={cn("text-xl font-bold", m.color)}>{m.value}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{m.label}</div>
            </div>
          ))}
        </div>

        {/* Oversight table */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-border">
                {["Agent", "Trust", "Budget", "Can hire", "Approvals", "Last run", "Outcome", "Actions"].map(
                  (h) => (
                    <th
                      key={h}
                      className="text-left px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => {
                const trust = trustMap.get(agent.id) ?? null;
                const hasTrust = hasTrustScoreData(trust);
                const tone = trust ? getTrustScoreTone(trust.currentScore) : null;
                const toneClasses = tone ? getTrustScoreToneClasses(tone) : null;
                const isLead = (agent.runtimeConfig as any)?.aoa?.role === "lead";
                const dotClass = agentStatusDot[agent.status] ?? agentStatusDotDefault;
                const canPause = ["running", "active", "idle"].includes(agent.status);
                const canResume = ["paused", "error"].includes(agent.status);
                const needsApproval = agent.status === "pending_approval";
                // For quick-approve we need the approval ID — stored in agent.metadata if available
                const pendingApprovalId =
                  (agent.metadata as any)?.pendingApprovalId as string | undefined;

                return (
                  <tr
                    key={agent.id}
                    className="border-b border-border/40 last:border-0 hover:bg-white/[0.015] cursor-default"
                  >
                    {/* Agent */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5 min-w-[150px]">
                        <div className="relative w-7 h-7 rounded-md bg-accent flex items-center justify-center shrink-0">
                          <AgentIcon icon={agent.icon} className="h-3.5 w-3.5" />
                          <div
                            className={cn(
                              "absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border-2 border-background",
                              dotClass,
                            )}
                          />
                        </div>
                        <div>
                          <div className="text-[13px] font-semibold leading-none">{agent.name}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            {isLead ? "Lead" : "Member"}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Trust */}
                    <td className="px-3 py-2.5">
                      {hasTrust && trust && toneClasses ? (
                        <div className="flex items-center gap-1.5 min-w-[80px]">
                          <div className="flex-1 h-1 rounded-full bg-accent overflow-hidden">
                            <div
                              className={cn("h-full rounded-full", toneClasses.progress)}
                              style={{ width: `${trust.currentScore}%` }}
                            />
                          </div>
                          <span className="text-[11px] text-muted-foreground w-8 text-right">
                            {formatTrustScorePercent(trust.currentScore)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[11px] text-muted-foreground/40">—</span>
                      )}
                    </td>

                    {/* Budget (editable limit) */}
                    <td className="px-3 py-2.5">
                      <BudgetEditCell
                        agent={agent}
                        isFounder={isFounder}
                        onSave={(cents) => budgetMut.mutate({ id: agent.id, cents })}
                      />
                    </td>

                    {/* Can hire */}
                    <td className="px-3 py-2.5">
                      <CanHireToggle
                        enabled={agent.permissions.canCreateAgents}
                        isFounder={isFounder}
                        onToggle={() =>
                          permMut.mutate({
                            id: agent.id,
                            canCreateAgents: !agent.permissions.canCreateAgents,
                          })
                        }
                      />
                    </td>

                    {/* Approvals */}
                    <td className="px-3 py-2.5">
                      {needsApproval ? (
                        <span className="inline-flex items-center gap-1 bg-amber-950/30 text-amber-300 px-2 py-0.5 rounded-lg text-[11px] font-semibold">
                          ● 1 pending
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground/40">—</span>
                      )}
                    </td>

                    {/* Last run */}
                    <td className="px-3 py-2.5">
                      <span className="text-[11px] text-muted-foreground">
                        {relativeTime(agent.lastHeartbeatAt)}
                      </span>
                    </td>

                    {/* Outcome */}
                    <td className="px-3 py-2.5">
                      <StatusBadge status={agent.status} />
                    </td>

                    {/* Actions */}
                    <td className="px-3 py-2.5">
                      {isFounder ? (
                        <div className="flex items-center gap-1.5 flex-nowrap">
                          {canPause && (
                            <button
                              className={cn(
                                "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border whitespace-nowrap",
                                "transition-colors",
                                agent.status === "running"
                                  ? "border-yellow-500/30 bg-yellow-950/20 text-yellow-300 hover:bg-yellow-950/40"
                                  : "border-border bg-card/60 text-muted-foreground hover:bg-accent",
                              )}
                              onClick={() => pauseMut.mutate(agent.id)}
                              disabled={pauseMut.isPending}
                            >
                              ⏸ Pause
                            </button>
                          )}
                          {canResume && (
                            <button
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border border-border bg-card/60 text-muted-foreground hover:bg-accent whitespace-nowrap transition-colors"
                              onClick={() => resumeMut.mutate(agent.id)}
                              disabled={resumeMut.isPending}
                            >
                              ▶ Resume
                            </button>
                          )}
                          {needsApproval && pendingApprovalId && (
                            <button
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold border border-amber-500/30 bg-amber-950/25 text-amber-300 hover:bg-amber-950/40 whitespace-nowrap transition-colors"
                              onClick={() => approveMut.mutate(pendingApprovalId)}
                              disabled={approveMut.isPending}
                            >
                              ✓ Approve
                            </button>
                          )}
                          <a
                            href={`#/team/aoa/${agent.id}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border border-border bg-transparent text-muted-foreground hover:bg-card whitespace-nowrap transition-colors"
                            title="Open agent config"
                          >
                            ⚙ Config
                          </a>
                        </div>
                      ) : (
                        <span className="text-[11px] text-muted-foreground/40">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Founder-only notice */}
        {isFounder && (
          <p className="flex items-center gap-2 text-[11px] text-muted-foreground/50 border border-border/40 rounded-lg px-3.5 py-2.5">
            <span>🔒</span>
            Budget edits, pause/resume, can-hire toggles, and quick-approvals are <strong className="text-muted-foreground/70">founder-only</strong>.
          </p>
        )}
      </div>
    );
  }
  ```

- [ ] **Step 2: Run typecheck**

  ```bash
  pnpm --filter ui typecheck 2>&1 | head -30
  ```
  Expected: exit 0.

- [ ] **Step 3: Commit**

  ```bash
  git add ui/src/components/team/CommanderGovernanceTab.tsx
  git commit -m "feat(team): add CommanderGovernanceTab with inline founder actions"
  ```

---

## Task 5 — Rewrite `CommanderTeamTab` as a sub-tab shell

### Purpose
`CommanderTeamTab` becomes a thin orchestrator: it owns the Roster / Kanban / Governance sub-tab state (URL-hash or local `useState`) and composes the three sub-components. It also holds the `NewAoaAgentDialog` so all sub-tabs can trigger it.

**Files:**
- Rewrite: `ui/src/components/team/CommanderTeamTab.tsx`

- [ ] **Step 1: Replace the entire file content**

  ```tsx
  import { useState } from "react";
  import type { Agent, AgentTrustScore } from "@armyofagents/shared";
  import { useCompany } from "../../context/CompanyContext";
  import { useQueryClient } from "@tanstack/react-query";
  import { Bot } from "lucide-react";
  import type { LiveRunForIssue } from "../../api/heartbeats";
  import { CommanderRosterTab } from "./CommanderRosterTab";
  import { CommanderKanbanTab } from "./CommanderKanbanTab";
  import { CommanderGovernanceTab } from "./CommanderGovernanceTab";
  import { NewAoaAgentDialog } from "./NewAoaAgentDialog";
  import { EmptyState } from "@/components/ui/empty-state";
  import { Button } from "@/components/ui/button";
  import { Plus } from "lucide-react";
  import { cn } from "../../lib/utils";

  type SubTab = "roster" | "kanban" | "governance";

  const SUB_TABS: { id: SubTab; label: string }[] = [
    { id: "roster",     label: "Roster" },
    { id: "kanban",     label: "Kanban" },
    { id: "governance", label: "Governance" },
  ];

  interface CommanderTeamTabProps {
    agents: Agent[];
    trustScores: AgentTrustScore[];
    liveRuns: LiveRunForIssue[];
    permissions: { isFounder: boolean };
    onMutationSuccess?: () => void;
  }

  export function CommanderTeamTab({
    agents,
    trustScores,
    liveRuns,
    permissions,
    onMutationSuccess,
  }: CommanderTeamTabProps) {
    const { selectedCompanyId } = useCompany();
    const queryClient = useQueryClient();
    const [activeSubTab, setActiveSubTab] = useState<SubTab>("roster");
    const [dialogOpen, setDialogOpen] = useState(false);

    function handleDialogSuccess() {
      if (selectedCompanyId) {
        queryClient.invalidateQueries({ queryKey: ["aoa-agents", selectedCompanyId] });
      }
      onMutationSuccess?.();
    }

    if (agents.length === 0) {
      return (
        <>
          <EmptyState
            icon={<Bot />}
            title="No AoA agents yet"
            description="Deploy your first Commander or AoA member agent to build your autonomous team."
            action={
              permissions.isFounder ? (
                <Button size="sm" onClick={() => setDialogOpen(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  New AoA Agent
                </Button>
              ) : undefined
            }
          />
          {selectedCompanyId && (
            <NewAoaAgentDialog
              open={dialogOpen}
              onOpenChange={setDialogOpen}
              companyId={selectedCompanyId}
              onSuccess={handleDialogSuccess}
            />
          )}
        </>
      );
    }

    return (
      <>
        {/* Sub-tab bar */}
        <div className="flex border-b border-border/50 mb-5 sticky top-0 bg-background z-10">
          {SUB_TABS.map((tab) => (
            <button
              key={tab.id}
              className={cn(
                "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
                activeSubTab === tab.id
                  ? "text-foreground border-brand"
                  : "text-muted-foreground border-transparent hover:text-foreground",
              )}
              onClick={() => setActiveSubTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Panels */}
        {activeSubTab === "roster" && (
          <CommanderRosterTab
            agents={agents}
            trustScores={trustScores}
            isFounder={permissions.isFounder}
            onNewAgent={() => setDialogOpen(true)}
          />
        )}
        {activeSubTab === "kanban" && (
          <CommanderKanbanTab agents={agents} liveRuns={liveRuns} />
        )}
        {activeSubTab === "governance" && (
          <CommanderGovernanceTab
            agents={agents}
            trustScores={trustScores}
            isFounder={permissions.isFounder}
            onMutationSuccess={onMutationSuccess}
          />
        )}

        {/* New agent dialog — accessible from any sub-tab */}
        {selectedCompanyId && (
          <NewAoaAgentDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            companyId={selectedCompanyId}
            onSuccess={handleDialogSuccess}
          />
        )}
      </>
    );
  }
  ```

- [ ] **Step 2: Run typecheck**

  ```bash
  pnpm --filter ui typecheck 2>&1 | head -30
  ```
  Expected: exit 0.

- [ ] **Step 3: Smoke test in browser**

  Start the dev server and navigate to the Team page → Commander tab. Verify:
  - Sub-tab bar visible with three tabs
  - Roster tab shows agent cards with budget bar row at the bottom
  - Kanban tab shows 5 columns; agent cards are task-first (not agent-name-first)
  - Governance tab shows the summary metrics row + table with 8 columns including Actions
  - As a founder: Budget inputs are editable (hover shows border), toggles are clickable, Pause/Resume/Approve buttons are present
  - As a non-founder: Actions column shows `—`

  ```bash
  pnpm --filter ui dev
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add ui/src/components/team/CommanderTeamTab.tsx
  git commit -m "feat(team): rewrite CommanderTeamTab as sub-tab shell (Roster/Kanban/Governance)"
  ```

---

## Task 6 — Install `date-fns` if missing

### Purpose
`CommanderKanbanTab` and `CommanderGovernanceTab` use `date-fns/formatDistanceToNowStrict`. Check if it's already in the workspace; install only if missing.

**Files:**
- Possibly modify: `ui/package.json`

- [ ] **Step 1: Check if date-fns is already a dependency**

  ```bash
  grep -r "date-fns" "C:\Users\TK\OneDrive\Desktop\Claude Data\Paperclip-AoA\AoA-2.5\ui\package.json"
  ```

  If `date-fns` appears: **skip the rest of this task**.

- [ ] **Step 2 (only if missing): Install date-fns**

  ```bash
  cd "C:\Users\TK\OneDrive\Desktop\Claude Data\Paperclip-AoA\AoA-2.5"
  pnpm --filter ui add date-fns
  ```

- [ ] **Step 3 (only if installed): Run typecheck again**

  ```bash
  pnpm --filter ui typecheck 2>&1 | head -20
  ```

- [ ] **Step 4 (only if installed): Commit**

  ```bash
  git add ui/package.json pnpm-lock.yaml
  git commit -m "chore(ui): add date-fns dependency for relative timestamps"
  ```

---

## Self-Review

### Spec coverage

| Requirement | Task |
|---|---|
| Roster with budget bar | Task 2 — `BudgetBar` component |
| Roster with trust score badge | Task 2 — `getTrustScoreTone` + badge |
| Kanban task-first cards | Task 3 — `CommanderKanbanTab` |
| Kanban 5 status columns | Task 3 — `COLUMNS` array |
| Kanban live pulse dot | Task 3 — animate-ping span |
| Governance table 8 columns | Task 4 — thead + rows |
| Governance budget inline edit | Task 4 — `BudgetEditCell` |
| Governance canHire toggle | Task 4 — `CanHireToggle` |
| Governance Pause/Resume | Task 4 — `pauseMut` / `resumeMut` |
| Governance Quick-approve | Task 4 — `approveMut` |
| Governance founder-only gate | Task 4 — `isFounder` prop guard |
| Sub-tab bar shell | Task 5 — `CommanderTeamTab` |
| Trust/live-runs queries in TeamPage | Task 1 |
| Empty state preserved | Task 5 — `agents.length === 0` guard |

All requirements covered.

### Type consistency

- `AgentTrustScore` imported from `@armyofagents/shared` in Tasks 1, 2, 4, 5 — consistent.
- `LiveRunForIssue` imported from `../../api/heartbeats` in Tasks 1, 3, 5 — consistent.
- `agentsApi.pause(id, companyId?)` signature matches `agents.ts` line 113 — consistent.
- `agentsApi.updatePermissions(id, { canCreateAgents }, companyId?)` matches `agents.ts` line 111 — consistent.
- `approvalsApi.approve(id, note?)` matches `approvals.ts` line 12 — consistent.

### Placeholder scan

No TBD, TODO, or vague "add validation" phrases found. All code blocks are complete.

### One known limitation

The **Quick-approve** button in `CommanderGovernanceTab` requires `agent.metadata.pendingApprovalId`. If the backend does not populate this field in the AoA agents list response, the Approve button will simply not render (guarded by `pendingApprovalId` check). This is safe degradation — the user can still navigate to Config to approve from the full approval page. If the approval ID needs to be fetched, a follow-up plan should add `GET /companies/:cid/approvals?status=pending_approval` to the TeamPage queries.
