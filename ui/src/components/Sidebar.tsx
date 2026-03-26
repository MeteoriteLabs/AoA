import {
  Inbox,
  CircleDot,
  Home,
  Users,
  Settings,
  FileText,
  Brain,
  Compass,
  Bot,
  Target,
  MessageSquare,
  ChevronsLeft,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router";
import { SidebarSection } from "./SidebarSection";
import { SidebarNavItem } from "./SidebarNavItem";
import { SidebarProjectsByType } from "./SidebarProjectsByType";
import { useCompany } from "../context/CompanyContext";
import { useSidebar } from "../context/SidebarContext";
import { sidebarBadgesApi } from "../api/sidebarBadges";
import { queryKeys } from "../lib/queryKeys";
import { useLiveAgentCount } from "../hooks/useLiveAgentCount";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const { selectedCompanyId, selectedCompany } = useCompany();
  const { collapsed, toggleCollapse } = useSidebar();
  const navigate = useNavigate();
  const { data: sidebarBadges } = useQuery({
    queryKey: queryKeys.sidebarBadges(selectedCompanyId!),
    queryFn: () => sidebarBadgesApi.get(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const liveRunCount = useLiveAgentCount();

  return (
    <aside className={cn("h-full min-h-0 border-r border-border bg-background flex flex-col", collapsed ? "w-12" : "w-60")}>
      {/* Top bar: Brand dot (collapsed) or Company name + collapse toggle (expanded) */}
      <div className={cn("flex items-center shrink-0 h-12 border-b border-border", collapsed ? "justify-center px-0" : "gap-1.5 px-3")}>
        {collapsed ? (
          /* Collapsed: brand dot only, centered */
          selectedCompany?.brandColor ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href="/"
                  onClick={(e) => { e.preventDefault(); navigate("/"); }}
                  className="flex items-center justify-center w-8 h-8 rounded-md hover:bg-accent/50 transition-colors"
                >
                  <div
                    className="w-4 h-4 rounded-sm shrink-0"
                    style={{ backgroundColor: selectedCompany.brandColor }}
                  />
                </a>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>{selectedCompany?.name ?? "Home"}</TooltipContent>
            </Tooltip>
          ) : (
            <div className="w-4 h-4 rounded-sm bg-muted shrink-0" />
          )
        ) : (
          /* Expanded: brand dot + company name + collapse toggle */
          <>
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
              onClick={toggleCollapse}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>

      <nav className={cn("flex-1 min-h-0 overflow-y-auto scrollbar-auto-hide flex flex-col gap-4 py-2", collapsed ? "px-0 items-center" : "px-3")}>
        {/* Top nav: Home + Inbox */}
        <div className={cn("flex flex-col gap-0.5", collapsed && "w-full items-center")}>
          <SidebarNavItem to="/home" label="Home" icon={Home} liveCount={liveRunCount} collapsed={collapsed} />
          <SidebarNavItem
            to="/inbox"
            label="Inbox"
            icon={Inbox}
            badge={sidebarBadges?.inbox}
            badgeTone={sidebarBadges?.failedRuns ? "danger" : "default"}
            alert={(sidebarBadges?.failedRuns ?? 0) > 0}
            collapsed={collapsed}
          />
        </div>

        {/* WORK section */}
        <SidebarSection label="Work" collapsed={collapsed}>
          <SidebarNavItem to="/issues" label="Tasks" icon={CircleDot} entityColor="var(--entity-task)" collapsed={collapsed} />
          <SidebarNavItem to="/discussions" label="Discussions" icon={MessageSquare} entityColor="var(--entity-brief)" collapsed={collapsed} />
          <SidebarNavItem to="/briefs" label="Briefs" icon={FileText} entityColor="var(--entity-brief)" collapsed={collapsed} />
          <SidebarNavItem to="/agents/all" label="Agents" icon={Bot} entityColor="var(--entity-agent)" collapsed={collapsed} />
          <SidebarNavItem to="/goals" label="Goals" icon={Target} entityColor="var(--entity-goal)" collapsed={collapsed} />
        </SidebarSection>

        {/* DEPARTMENTS section */}
        <SidebarProjectsByType type="department" label="Departments" collapsed={collapsed} />

        {/* PROJECTS section */}
        <SidebarProjectsByType type="project" label="Projects" collapsed={collapsed} />

        {/* COMPANY section */}
        <SidebarSection label="Company" collapsed={collapsed}>
          <SidebarNavItem to="/vision" label="Vision & Mission" icon={Compass} collapsed={collapsed} />
          <SidebarNavItem to="/memory" label="Memory" icon={Brain} entityColor="var(--entity-memory)" collapsed={collapsed} />
          <SidebarNavItem to="/org" label="Team" icon={Users} collapsed={collapsed} />
        </SidebarSection>
      </nav>

      {/* Settings at bottom, above any footer */}
      <div className={cn("shrink-0 border-t border-border py-2", collapsed ? "px-0 flex justify-center" : "px-3")}>
        <SidebarNavItem to="/settings" label="Settings" icon={Settings} collapsed={collapsed} />
      </div>
    </aside>
  );
}
