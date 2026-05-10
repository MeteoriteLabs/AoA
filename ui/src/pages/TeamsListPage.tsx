import { useState, useMemo } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { Plus, ChevronDown, Users, Search, Sparkles, Upload } from "lucide-react";
import { teamsApi } from "../api/teams";
import { projectsApi } from "../api/projects";
import { agentsApi } from "../api/agents";
import { useCompany } from "../context/CompanyContext";
import { useNavigate } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TeamCard, type TeamCardData } from "../components/team/TeamCard";
import { NewTeamEntryDialog } from "../components/team/NewTeamEntryDialog";
import { EmptyState } from "../components/EmptyState";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "@/lib/utils";

type EntryMode = "build" | "import" | null;
type StatusFilter = "all" | "active" | "archived";

const TEAM_COLORS = [
  "var(--data-indigo)",
  "var(--data-teal)",
  "var(--data-magenta)",
  "var(--data-amber)",
  "var(--data-slate)",
  "var(--brand)",
];

/**
 * Teams list page — promoted from the in-page `TeamsSection` to a peer of
 * Agents and Humans inside the Team layout. The "+ New team" entry point
 * lives only on this surface.
 */
export function TeamsListPage() {
  const { selectedCompanyId } = useCompany();
  const navigate = useNavigate();
  const [entryMode, setEntryMode] = useState<EntryMode>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const teamsQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.teams.list(selectedCompanyId) : ["teams", "none"],
    queryFn: () => teamsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

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
      const memberInitials = members
        .slice(0, 4)
        .map((m) => {
          const name = agentNameById.get(m.agentId) ?? "";
          return name.substring(0, 2).toUpperCase();
        })
        .filter(Boolean);
      return {
        id: t.id,
        name: t.name,
        slug: t.slug,
        parentProjectName: projectsById.get(t.parentProjectId)?.name ?? "—",
        status: t.status,
        memberCount: members.length,
        leadName: lead ? agentNameById.get(lead.agentId) ?? lead.agentId : "--",
        memberInitials,
        iconColor: TEAM_COLORS[idx % TEAM_COLORS.length],
      };
    });
  }, [teams, memberQueries, projectsById, agentNameById]);

  const filteredTeamCards = useMemo(() => {
    return teamCards.filter((card) => {
      if (statusFilter !== "all" && card.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          card.name.toLowerCase().includes(q) ||
          card.parentProjectName.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [teamCards, statusFilter, search]);

  const activeCount = teamCards.filter((c) => c.status === "active").length;
  const archivedCount = teamCards.filter((c) => c.status === "archived").length;

  const STATUS_FILTERS: { value: StatusFilter; label: string; count: number }[] = [
    { value: "all", label: "All", count: teamCards.length },
    { value: "active", label: "Active", count: activeCount },
    { value: "archived", label: "Archived", count: archivedCount },
  ];

  return (
    <section className="p-5">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold">
            Teams{" "}
            <span className="ml-1 font-mono text-xs font-medium text-muted-foreground">
              {teams.length}
            </span>
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
              <Sparkles className="h-4 w-4 mr-2" />
              Build from scratch
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setEntryMode("import")}>
              <Upload className="h-4 w-4 mr-2" />
              Import from file
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {teamsQuery.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading teams…</p>
      ) : teams.length === 0 ? (
        <EmptyState icon={Users} message="No teams yet. Click + New team to create one." />
      ) : (
        <>
          {/* Search + filter */}
          <div className="mb-4 flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search teams…"
                className="h-8 pl-8 text-xs"
              />
            </div>
            <div className="flex items-center gap-1.5">
              {STATUS_FILTERS.map(({ value, label, count }) => {
                const isActive = statusFilter === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setStatusFilter(value)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap",
                      isActive
                        ? "bg-foreground text-background border-foreground"
                        : "bg-card border-border text-foreground/70 hover:bg-accent hover:text-foreground",
                    )}
                  >
                    {label}
                    <span className="font-mono text-[10px] opacity-70">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {filteredTeamCards.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No teams match your search.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {filteredTeamCards.map((card) => (
                <TeamCard
                  key={card.id}
                  team={card}
                  onClick={() => navigate(`/team/teams/${card.slug}`)}
                />
              ))}
            </div>
          )}
        </>
      )}

      <NewTeamEntryDialog
        open={entryMode !== null}
        initialMode={entryMode}
        onOpenChange={(open) => !open && setEntryMode(null)}
      />
    </section>
  );
}
