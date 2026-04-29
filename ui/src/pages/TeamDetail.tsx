import { useEffect, useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Star, MoreHorizontal, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { teamsApi, type Team, type TeamMember } from "../api/teams";
import { projectsApi } from "../api/projects";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { PageSkeleton } from "../components/PageSkeleton";
import { EmptyState } from "../components/EmptyState";
import { PageTabBar } from "../components/PageTabBar";
import { CoordinationEditor } from "../components/team/CoordinationEditor";
import { ManifestEditor } from "../components/team/ManifestEditor";

const VALID_TABS = ["overview", "coordination", "manifest", "activity"] as const;
type TeamDetailTab = (typeof VALID_TABS)[number];

function isValidTab(value: string | null): value is TeamDetailTab {
  return VALID_TABS.includes(value as TeamDetailTab);
}

const TAB_ITEMS = [
  { value: "overview", label: "Overview" },
  { value: "coordination", label: "Coordination" },
  { value: "manifest", label: "Manifest" },
  { value: "activity", label: "Activity" },
];

export function TeamDetail() {
  const { slug } = useParams<{ slug: string }>();
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get("tab");
  const activeTab: TeamDetailTab = isValidTab(rawTab) ? rawTab : "overview";

  // Fetch teams list and find by slug.
  // Backend doesn't expose getBySlug; we filter client-side. Acceptable v1.
  const teamQuery = useQuery({
    queryKey:
      selectedCompanyId && slug
        ? queryKeys.teams.detailBySlug(selectedCompanyId, slug)
        : ["team", "by-slug", "none"],
    queryFn: async () => {
      const list = await teamsApi.list(selectedCompanyId!);
      const team = list.items.find((t) => t.slug === slug);
      if (!team) throw new Error(`Team ${slug} not found`);
      return team;
    },
    enabled: Boolean(selectedCompanyId && slug),
  });

  const membersQuery = useQuery({
    queryKey:
      teamQuery.data && selectedCompanyId
        ? queryKeys.teams.members(selectedCompanyId, teamQuery.data.id)
        : ["members", "none"],
    queryFn: () => teamsApi.listMembers(teamQuery.data!.id),
    enabled: Boolean(teamQuery.data && selectedCompanyId),
  });

  // Look up the parent project (department) name to display the dept badge.
  const projectsQuery = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.projects.list(selectedCompanyId)
      : ["projects", "none"],
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  const parentProjectName = useMemo(() => {
    if (!teamQuery.data || !projectsQuery.data) return null;
    return (
      projectsQuery.data.find((p) => p.id === teamQuery.data!.parentProjectId)
        ?.name ?? null
    );
  }, [teamQuery.data, projectsQuery.data]);

  useEffect(() => {
    if (teamQuery.data) {
      setBreadcrumbs([
        { label: "Team", href: "/team" },
        { label: teamQuery.data.name },
      ]);
    }
  }, [teamQuery.data, setBreadcrumbs]);

  const handleTabChange = (next: string) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("tab", next);
    setSearchParams(nextParams);
  };

  if (teamQuery.isLoading) return <PageSkeleton variant="detail" />;
  if (teamQuery.isError)
    return <EmptyState icon={Users} message="Team not found." />;
  if (!teamQuery.data) return null;

  const team = teamQuery.data;
  const members = membersQuery.data?.items ?? [];
  const lead = members.find((m) => m.role === "lead");

  return (
    <div className="p-5">
      <header className="mb-5 flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-accent text-xl font-bold">
            {team.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold">{team.name}</h1>
              <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                {parentProjectName ?? "DEPT"}
              </Badge>
              <Badge variant="outline" className="text-[10px] capitalize">
                {team.status}
              </Badge>
            </div>
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <Star className="h-3 w-3 text-amber-500" aria-hidden="true" />
              <span className="sr-only">Lead: </span>
              {lead ? lead.agentId : "No lead"}
              <span className="opacity-50">·</span>
              <span>
                {members.length} member{members.length === 1 ? "" : "s"}
              </span>
            </p>
          </div>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline">
            Edit
          </Button>
          <Button size="icon-sm" variant="outline" aria-label="More options">
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <PageTabBar
          items={TAB_ITEMS}
          value={activeTab}
          onValueChange={handleTabChange}
        />

        <div className="mt-4">
          {activeTab === "overview" && <OverviewTab team={team} members={members} />}
          {activeTab === "coordination" && (
            <CoordinationEditor teamId={team.id} teamName={team.name} />
          )}
          {activeTab === "manifest" && (
            <ManifestEditor teamId={team.id} initialManifest={team.manifest} />
          )}
          {activeTab === "activity" && (
            <p className="text-sm text-muted-foreground">Activity tab — future slice.</p>
          )}
        </div>
      </Tabs>
    </div>
  );
}

interface OverviewProps {
  team: Team;
  members: TeamMember[];
}

function OverviewTab({ members }: OverviewProps) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <section className="col-span-2 rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-sm font-bold">Members ({members.length})</h2>
        {members.length === 0 ? (
          <p className="text-xs text-muted-foreground">No members yet.</p>
        ) : (
          members.map((m) => (
            <div
              key={m.id}
              className={`mb-2 flex items-center gap-3 rounded-md p-2.5 ${
                m.role === "lead"
                  ? "border-l-[3px] border-l-indigo-500 bg-indigo-50/30 dark:bg-indigo-950/10"
                  : "bg-muted/30"
              }`}
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-sm">
                <span aria-hidden="true">A</span>
              </div>
              <div className="flex-1">
                {/* TODO: resolve agentId to agent name in a follow-up slice */}
                <span className="text-xs font-bold">{m.agentId}</span>
                {m.role === "lead" && (
                  <span className="ml-2 inline-flex items-center gap-1 text-[9px] font-bold text-indigo-600">
                    <Star className="h-2.5 w-2.5" aria-hidden="true" />
                    LEAD
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </section>

      <aside className="space-y-3">
        <div className="rounded-lg border bg-card p-3">
          <h3 className="mb-1 text-xs font-bold">Coordination</h3>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Auto-generated contract describing how this team handles work and routes between members.
          </p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <h3 className="mb-2 text-xs font-bold">Quick stats</h3>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <div>{members.length} agents</div>
            <div>0 active tasks</div>
            <div>0 runs today</div>
            <div>$0.00 spent</div>
          </div>
        </div>
      </aside>
    </div>
  );
}
