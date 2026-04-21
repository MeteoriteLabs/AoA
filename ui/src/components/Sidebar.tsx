import {
  Inbox,
  CircleDot,
  Home,
  Users,
  Settings,
  Brain,
  Compass,
  Bot,
  MessageSquare,
  Boxes,
  Repeat,
  ChevronsLeft,
  Shield,
  Puzzle,
  DollarSign,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router";
import { SidebarSection } from "./SidebarSection";
import { SidebarNavItem } from "./SidebarNavItem";
import { SidebarProjectsByType } from "./SidebarProjectsByType";
import { BudgetSidebarMarker } from "./finance/BudgetSidebarMarker";
import { UserMenu } from "./UserMenu";
import { useCompany } from "../context/CompanyContext";
import { useSidebar } from "../context/SidebarContext";
import { sidebarBadgesApi } from "../api/sidebarBadges";
import { pluginsApi } from "../api/plugins";
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
  const { data: pluginContributions } = useQuery({
    queryKey: queryKeys.plugins.uiContributions,
    queryFn: () => pluginsApi.listUiContributions(),
    enabled: !!selectedCompanyId,
    staleTime: 60_000,
  });
  const pluginsWithPages = (pluginContributions ?? []).filter(
    (c) => c.slots.some((s) => s.type === "page"),
  );

  return (
    <aside className={cn("h-full min-h-0 border-r border-border bg-background flex flex-col", collapsed ? "w-12" : "w-60")}>
      {/* Top bar: Brand dot (collapsed) or Company name + collapse toggle (expanded) */}
      <div className={cn("flex items-center shrink-0 h-12 border-b border-border", collapsed ? "justify-center px-0" : "gap-1.5 px-3")}>
        {collapsed ? (
          /* Collapsed: logo or brand dot, centered */
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href="/"
                onClick={(e) => { e.preventDefault(); navigate("/"); }}
                className="flex items-center justify-center w-8 h-8 rounded-md hover:bg-accent/50 transition-colors"
              >
                {selectedCompany?.logoAssetId ? (
                  <img
                    src={`/api/assets/${selectedCompany.logoAssetId}/content`}
                    alt={selectedCompany.name}
                    className="w-6 h-6 rounded object-cover"
                  />
                ) : selectedCompany?.brandColor ? (
                  <div
                    className="w-4 h-4 rounded-sm shrink-0"
                    style={{ backgroundColor: selectedCompany.brandColor }}
                  />
                ) : (
                  <div className="w-4 h-4 rounded-sm bg-muted shrink-0" />
                )}
              </a>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>{selectedCompany?.name ?? "Home"}</TooltipContent>
          </Tooltip>
        ) : (
          /* Expanded: logo/brand dot + company name + collapse toggle */
          <>
            {selectedCompany?.logoAssetId ? (
              <img
                src={`/api/assets/${selectedCompany.logoAssetId}/content`}
                alt={selectedCompany.name}
                className="w-5 h-5 rounded object-cover shrink-0"
              />
            ) : selectedCompany?.brandColor ? (
              <div
                className="w-4 h-4 rounded-sm shrink-0"
                style={{ backgroundColor: selectedCompany.brandColor }}
              />
            ) : null}
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
        {/* Top nav: Home + Inbox + Commander */}
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
          <SidebarNavItem to="/commander" label="Commander" icon={Shield} collapsed={collapsed} />
        </div>

        {/* WORK section */}
        <SidebarSection label="Work" collapsed={collapsed}>
          <SidebarNavItem to="/discussions" label="Discussions" icon={MessageSquare} badge={sidebarBadges?.pendingDiscussions} entityColor="var(--entity-brief)" collapsed={collapsed} />
          <SidebarNavItem to="/issues" label="Tasks" icon={CircleDot} entityColor="var(--entity-task)" collapsed={collapsed} />
          <SidebarNavItem to="/agents/all" label="Agents" icon={Bot} entityColor="var(--entity-agent)" collapsed={collapsed} />
          <SidebarNavItem to="/routines" label="Routines" icon={Repeat} collapsed={collapsed} />
        </SidebarSection>

        {/* DEPARTMENTS section */}
        <SidebarProjectsByType type="department" label="Departments" collapsed={collapsed} />

        {/* PROJECTS section */}
        <SidebarProjectsByType type="project" label="Projects" collapsed={collapsed} />

        {/* COMPANY section */}
        <SidebarSection label="Company" collapsed={collapsed}>
          <SidebarNavItem to="/objectives" label="Objectives" icon={Compass} collapsed={collapsed} />
          <SidebarNavItem to="/memory" label="Memory" icon={Brain} entityColor="var(--entity-memory)" collapsed={collapsed} />
          <SidebarNavItem to="/org" label="Team" icon={Users} collapsed={collapsed} />
          <SidebarNavItem to="/skills" label="Skills" icon={Boxes} collapsed={collapsed} />
          <SidebarNavItem to="/budget" label="Budget" icon={DollarSign} collapsed={collapsed} />
          <BudgetSidebarMarker collapsed={collapsed} />
          <SidebarNavItem to="/settings" label="Settings" icon={Settings} collapsed={collapsed} />
        </SidebarSection>

        {/* PLUGINS section — only shown when plugins with page slots are installed */}
        {pluginsWithPages.length > 0 && (
          <SidebarSection label="Plugins" collapsed={collapsed}>
            {pluginsWithPages.map((contribution) => (
              <SidebarNavItem
                key={contribution.pluginId}
                to={`/plugins/${contribution.pluginId}`}
                label={contribution.displayName}
                icon={Puzzle}
                collapsed={collapsed}
              />
            ))}
          </SidebarSection>
        )}
      </nav>

      {/* User account menu pinned to the bottom of the sidebar. */}
      <div className={cn("shrink-0 border-t border-border", collapsed ? "py-2" : "p-2")}>
        <UserMenu collapsed={collapsed} />
      </div>
    </aside>
  );
}
