import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import type { CompanySkillListItem } from "@armyofagents/shared";
import { cn } from "@/lib/utils";
import { agentsApi } from "../../api/agents";
import { companySkillsApi } from "../../api/companySkills";
import { queryKeys } from "../../lib/queryKeys";
import { PageSkeleton } from "../PageSkeleton";

/**
 * Shared Skills tab for both the worker (AgentDetail) and AoA (AoaAgentDetail)
 * pages. Grouped Attached/Available toggle rows + search; immediate per-toggle
 * commit with optimistic update + rollback on failure; resync on prop change.
 */
export function AgentSkillsTab({
  agentId,
  companyId,
  skillKeys: initialSkillKeys,
  skillsRoute = "/skills",
}: {
  agentId: string;
  companyId: string;
  skillKeys: string[];
  /** Route to the company skills page (varies by page chrome). */
  skillsRoute?: string;
}) {
  const queryClient = useQueryClient();
  const [localKeys, setLocalKeys] = useState<string[]>(initialSkillKeys);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Resync when the agent refetches / navigation changes the attached set.
  useEffect(() => {
    setLocalKeys(initialSkillKeys);
  }, [initialSkillKeys]);

  const { data: allSkills, isLoading } = useQuery({
    queryKey: queryKeys.companySkills.list(companyId),
    queryFn: () => companySkillsApi.list(companyId),
    enabled: Boolean(companyId),
  });

  async function handleToggle(skillKey: string) {
    const prev = localKeys;
    const next = prev.includes(skillKey)
      ? prev.filter((k) => k !== skillKey)
      : [...prev, skillKey];
    setLocalKeys(next);
    setPendingKey(skillKey);
    setError(null);
    try {
      await agentsApi.update(agentId, { skillKeys: next } as never);
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(agentId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.companySkills.list(companyId) });
    } catch (e) {
      // Failed PATCH must not leave the optimistic change in place.
      setLocalKeys(prev);
      setError(e instanceof Error ? e.message : "Failed to update skills");
    } finally {
      setPendingKey(null);
    }
  }

  if (isLoading) return <PageSkeleton variant="list" />;

  if (!allSkills || allSkills.length === 0) {
    return (
      <div className="px-6 py-10 text-center text-sm text-muted-foreground">
        No skills available.{" "}
        <Link to={skillsRoute} className="underline">
          Create or import skills
        </Link>{" "}
        first.
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const matches = (s: CompanySkillListItem) =>
    !q ||
    s.name.toLowerCase().includes(q) ||
    s.key.toLowerCase().includes(q) ||
    (s.description ?? "").toLowerCase().includes(q);
  const filtered = allSkills.filter(matches);
  const attached = filtered.filter((s) => localKeys.includes(s.key));
  const available = filtered.filter((s) => !localKeys.includes(s.key));

  const renderRow = (skill: CompanySkillListItem) => {
    const isAttached = localKeys.includes(skill.key);
    const pending = pendingKey === skill.key;
    return (
      <div
        key={skill.id}
        role="button"
        tabIndex={0}
        aria-pressed={isAttached}
        onClick={() => { if (!pending) handleToggle(skill.key); }}
        onKeyDown={(e) => { if (!pending && (e.key === " " || e.key === "Enter")) { e.preventDefault(); handleToggle(skill.key); } }}
        className={cn(
          "flex items-center gap-3 px-3.5 py-3 border-b border-border last:border-b-0 cursor-pointer transition-colors hover:bg-accent/20",
          pending && "opacity-60 cursor-wait",
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{skill.name}</span>
            {skill.trustLevel && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                {skill.trustLevel}
              </span>
            )}
            {skill.sourceLabel && (
              <span className="text-[10px] text-muted-foreground">{skill.sourceLabel}</span>
            )}
          </div>
          {skill.description && (
            <div className="text-xs text-muted-foreground mt-0.5 truncate">{skill.description}</div>
          )}
          <div className="text-[11px] text-muted-foreground mt-0.5 font-mono">{skill.key}</div>
        </div>
        <div
          className={cn(
            "relative w-9 h-5 rounded-full shrink-0 transition-colors",
            isAttached ? "bg-green-500" : "bg-border",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all",
              isAttached ? "right-0.5" : "left-0.5",
            )}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="py-2 space-y-4 max-w-3xl">
      <p className="text-sm text-muted-foreground">
        Skills injected into this agent's context on every run.
      </p>
      <div className="flex items-center gap-2 border border-border rounded-md px-3 py-2 text-sm">
        <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search skills…"
          className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
        />
      </div>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

      <div>
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
          Attached · {attached.length}
        </div>
        {attached.length === 0 ? (
          <p className="text-sm text-muted-foreground">No skills attached.</p>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">{attached.map(renderRow)}</div>
        )}
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Available</div>
        {available.length === 0 ? (
          <p className="text-sm text-muted-foreground">{q ? "No matches." : "All skills attached."}</p>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">{available.map(renderRow)}</div>
        )}
      </div>
    </div>
  );
}
