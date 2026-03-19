import {
  Inbox,
  CircleDot,

  Home,
  DollarSign,
  History,
  Search,
  SquarePen,
  MessageSquarePlus,
  Users,
  Settings,
  FileText,
  Brain,
  Compass,
  Bot,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router";
import { SidebarSection } from "./SidebarSection";
import { SidebarNavItem } from "./SidebarNavItem";
import { SidebarProjectsByType } from "./SidebarProjectsByType";
import { useDialog } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import { sidebarBadgesApi } from "../api/sidebarBadges";
import { heartbeatsApi } from "../api/heartbeats";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";

export function Sidebar() {
  const { openNewIssue, openDebrief } = useDialog();
  const { selectedCompanyId, selectedCompany } = useCompany();
  const navigate = useNavigate();
  const { data: sidebarBadges } = useQuery({
    queryKey: queryKeys.sidebarBadges(selectedCompanyId!),
    queryFn: () => sidebarBadgesApi.get(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const { data: liveRuns } = useQuery({
    queryKey: queryKeys.liveRuns(selectedCompanyId!),
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 10_000,
  });
  const liveRunCount = liveRuns?.length ?? 0;

  function openSearch() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
  }

  return (
    <aside className="w-60 h-full min-h-0 border-r border-border bg-background flex flex-col">
      {/* Top bar: Company name (clickable → Lobby) + Search */}
      <div className="flex items-center gap-1 px-3 h-12 shrink-0">
        {selectedCompany?.brandColor && (
          <div
            className="w-4 h-4 rounded-sm shrink-0 ml-1"
            style={{ backgroundColor: selectedCompany.brandColor }}
          />
        )}
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
          className="flex-1 text-sm font-bold text-foreground truncate pl-1 hover:text-foreground/80 transition-colors"
          title="Back to all companies"
        >
          {selectedCompany?.name ?? "Select company"}
        </a>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground shrink-0"
          onClick={openSearch}
        >
          <Search className="h-4 w-4" />
        </Button>
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto scrollbar-auto-hide flex flex-col gap-4 px-3 py-2">
        {/* Top actions + nav */}
        <div className="flex flex-col gap-0.5">
          <button
            onClick={() => openNewIssue()}
            className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
          >
            <SquarePen className="h-4 w-4 shrink-0" />
            <span className="truncate">New Task</span>
          </button>
          <button
            onClick={() => openDebrief()}
            className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
          >
            <MessageSquarePlus className="h-4 w-4 shrink-0" />
            <span className="truncate">Debrief</span>
          </button>
          <SidebarNavItem to="/home" label="Home" icon={Home} liveCount={liveRunCount} />
          <SidebarNavItem
            to="/inbox"
            label="Inbox"
            icon={Inbox}
            badge={sidebarBadges?.inbox}
            badgeTone={sidebarBadges?.failedRuns ? "danger" : "default"}
            alert={(sidebarBadges?.failedRuns ?? 0) > 0}
          />
        </div>

        {/* WORK section */}
        <SidebarSection label="Work">
          <SidebarNavItem to="/issues" label="Tasks" icon={CircleDot} />
          <SidebarNavItem to="/briefs" label="Briefs" icon={FileText} />
          <SidebarNavItem to="/active-agents" label="Live Agents" icon={Bot} />
        </SidebarSection>

        {/* DEPARTMENTS section */}
        <SidebarProjectsByType type="department" label="Departments" />

        {/* PROJECTS section */}
        <SidebarProjectsByType type="project" label="Projects" />

        {/* TEAM */}
        <SidebarNavItem to="/org" label="Team" icon={Users} />

        {/* COMPANY section */}
        <SidebarSection label="Company">
          <SidebarNavItem to="/vision" label="Vision & Mission" icon={Compass} />
          <SidebarNavItem to="/memory" label="Memory" icon={Brain} />
          <SidebarNavItem to="/costs" label="Budget" icon={DollarSign} />
          <SidebarNavItem to="/activity" label="Activity" icon={History} />
          <SidebarNavItem to="/company/settings" label="Settings" icon={Settings} />
        </SidebarSection>
      </nav>
    </aside>
  );
}
