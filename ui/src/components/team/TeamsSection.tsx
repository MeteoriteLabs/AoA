import { useState, useMemo } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { Plus, ChevronDown, Users } from "lucide-react";
import { teamsApi } from "../../api/teams";
import { projectsApi } from "../../api/projects";
import { agentsApi } from "../../api/agents";
import { useCompany } from "../../context/CompanyContext";
import { useNavigate } from "@/lib/router";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TeamCard, type TeamCardData } from "./TeamCard";
import { NewTeamEntryDialog } from "./NewTeamEntryDialog";
import { EmptyState } from "../EmptyState";
import { queryKeys } from "../../lib/queryKeys";

type EntryMode = "build" | "import" | null;

const TEAM_COLORS = [
  "border-l-indigo-500",
  "border-l-emerald-500",
  "border-l-amber-500",
  "border-l-rose-500",
  "border-l-purple-500",
  "border-l-cyan-500",
];

export function TeamsSection() {
  const { selectedCompanyId } = useCompany();
  const navigate = useNavigate();
  const [entryMode, setEntryMode] = useState<EntryMode>(null);

  const teamsQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.teams.list(selectedCompanyId) : ["teams", "none"],
    queryFn: () => teamsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  // Fetch parent projects to resolve dept names
  const projectsQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.projects.list(selectedCompanyId) : ["projects", "none"],
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  const projectsById = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const p of projectsQuery.data ?? []) map.set(p.id, p);
    return map;
  }, [projectsQuery.data]);

  // Fetch agents to resolve lead UUIDs to names (P3-B).
  const agentsQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.agents.list(selectedCompanyId) : ["agents", "none"],
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
    staleTime: 60_000,
  });

  const agentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agentsQuery.data ?? []) map.set(a.id, a.name);
    return map;
  }, [agentsQuery.data]);

  // For each team, fetch its members to compute lead name + count
  const teams = teamsQuery.data?.items ?? [];
  const memberQueries = useQueries({
    queries: teams.map((t) => ({
      queryKey: queryKeys.teams.members(selectedCompanyId!, t.id),
      queryFn: () => teamsApi.listMembers(t.id),
      enabled: Boolean(selectedCompanyId),
    })),
  });

  const teamCards: TeamCardData[] = useMemo(() => {
    return teams.map((t, idx) => {
      const members = memberQueries[idx]?.data?.items ?? [];
      const lead = members.find((m) => m.role === "lead");
      return {
        id: t.id,
        name: t.name,
        slug: t.slug,
        parentProjectName: projectsById.get(t.parentProjectId)?.name ?? "—",
        status: t.status,
        memberCount: members.length,
        leadName: lead ? agentNameById.get(lead.agentId) ?? lead.agentId : "--",
        iconColor: TEAM_COLORS[idx % TEAM_COLORS.length],
      };
    });
  }, [teams, memberQueries, projectsById, agentNameById]);

  return (
    <section className="mb-7">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold">
            Teams <span className="ml-1 text-xs font-medium text-muted-foreground">{teams.length}</span>
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Grouped agents with a lead + coordination contract
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              New team
              <ChevronDown className="h-3 w-3 opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => setEntryMode("build")}>
              <span className="mr-2">✨</span>
              Build from scratch
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setEntryMode("import")}>
              <span className="mr-2">📥</span>
              Import from file
            </DropdownMenuItem>
            <DropdownMenuItem disabled className="opacity-50">
              <span className="mr-2">🛒</span>
              Browse marketplace
              <span className="ml-auto rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                SOON
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {teamsQuery.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading teams…</p>
      ) : teams.length === 0 ? (
        <EmptyState
          icon={Users}
          message="No teams yet. Click + New team to create one."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {teamCards.map((card) => (
            <TeamCard
              key={card.id}
              team={card}
              onClick={() => navigate(`/team/teams/${card.slug}`)}
            />
          ))}
        </div>
      )}

      <NewTeamEntryDialog
        open={entryMode !== null}
        initialMode={entryMode}
        onOpenChange={(open) => !open && setEntryMode(null)}
      />
    </section>
  );
}
