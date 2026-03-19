import {
  Inbox,
  CircleDot,
  Home,
  Search,
  Users,
  Settings,
  FileText,
  Brain,
  Compass,
  Bot,
  Target,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router";
import { SidebarSection } from "./SidebarSection";
import { SidebarNavItem } from "./SidebarNavItem";
import { SidebarProjectsByType } from "./SidebarProjectsByType";
import { useCompany } from "../context/CompanyContext";
import { sidebarBadgesApi } from "../api/sidebarBadges";
import { queryKeys } from "../lib/queryKeys";
import { useLiveAgentCount } from "../hooks/useLiveAgentCount";
import { Button } from "@/components/ui/button";

export function Sidebar() {
  const { selectedCompanyId, selectedCompany } = useCompany();
  const navigate = useNavigate();
  const { data: sidebarBadges } = useQuery({
    queryKey: queryKeys.sidebarBadges(selectedCompanyId!),
    queryFn: () => sidebarBadgesApi.get(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const liveRunCount = useLiveAgentCount();

  function openSearch() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
  }

  return (
    <aside className="w-60 h-full min-h-0 border-r border-border bg-background flex flex-col">
      {/* Top bar: Company name (clickable → Lobby) + Search (Cmd+K) */}
      <div className="flex items-center gap-1.5 px-3 h-12 shrink-0 border-b border-border">
        {selectedCompany?.brandColor && (
          <div
            className="w-4 h-4 rounded-sm shrink-0"
            style={{ backgroundColor: selectedCompany.brandColor }}
          />
        )}
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
          className="flex-1 text-sm font-semibold text-foreground truncate hover:text-foreground/80 transition-colors"
          title="Back to all companies"
        >
          {selectedCompany?.name ?? "Select company"}
        </a>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground shrink-0"
          onClick={openSearch}
          aria-label="Search (Cmd+K)"
          title="Search (Cmd+K)"
        >
          <Search className="h-4 w-4" />
        </Button>
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto scrollbar-auto-hide flex flex-col gap-4 px-3 py-2">
        {/* Top nav: Home + Inbox */}
        <div className="flex flex-col gap-0.5">
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
          <SidebarNavItem to="/active-agents" label="Agents" icon={Bot} />
          <SidebarNavItem to="/goals" label="Goals" icon={Target} />
        </SidebarSection>

        {/* DEPARTMENTS section */}
        <SidebarProjectsByType type="department" label="Departments" />

        {/* PROJECTS section */}
        <SidebarProjectsByType type="project" label="Projects" />

        {/* COMPANY section */}
        <SidebarSection label="Company">
          <SidebarNavItem to="/vision" label="Vision & Mission" icon={Compass} />
          <SidebarNavItem to="/memory" label="Memory" icon={Brain} />
          <SidebarNavItem to="/org" label="Team" icon={Users} />
        </SidebarSection>
      </nav>

      {/* Settings at bottom, above any footer */}
      <div className="shrink-0 border-t border-border px-3 py-2">
        <SidebarNavItem to="/settings" label="Settings" icon={Settings} />
      </div>
    </aside>
  );
}
