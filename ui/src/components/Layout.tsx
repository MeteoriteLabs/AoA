import { useCallback, useEffect, useRef, useState, type UIEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Outlet, useLocation, useNavigate, useParams } from "@/lib/router";
import { Sidebar } from "./Sidebar";
import { SidebarNavItem } from "./SidebarNavItem";
import { BreadcrumbBar } from "./BreadcrumbBar";
import { CommandPalette } from "./CommandPalette";
import { NewIssueDialog } from "./NewIssueDialog";
import { NewProjectDialog } from "./NewProjectDialog";
import { NewGoalDialog } from "./NewGoalDialog";
import { NewAgentDialog } from "./NewAgentDialog";
import { ToastViewport } from "./ToastViewport";
import { MobileBottomNav } from "./MobileBottomNav";
import { KeyboardShortcutsCheatsheet } from "./KeyboardShortcutsCheatsheet";
import { useDialog } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import { useSidebar } from "../context/SidebarContext";

import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useCompanyPageMemory } from "../hooks/useCompanyPageMemory";
import { healthApi } from "../api/health";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AgentPanelProvider } from "../context/AgentPanelContext";

export function Layout() {
  const { sidebarOpen, setSidebarOpen, toggleSidebar, isMobile, collapsed, setCollapsed, toggleCollapse } = useSidebar();
  const { openNewIssue, openOnboarding } = useDialog();
  const { companies, loading: companiesLoading, selectedCompanyId, selectionSource, setSelectedCompanyId } = useCompany();

  const { companyPrefix } = useParams<{ companyPrefix: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const onboardingTriggered = useRef(false);
  const lastMainScrollTop = useRef(0);
  const [mobileNavVisible, setMobileNavVisible] = useState(true);
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);

  const { data: health } = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => healthApi.get(),
    retry: false,
  });

  useEffect(() => {
    if (companiesLoading || onboardingTriggered.current) return;
    if (health?.deploymentMode === "authenticated") return;
    if (companies.length === 0) {
      onboardingTriggered.current = true;
      openOnboarding();
    }
  }, [companies, companiesLoading, openOnboarding, health?.deploymentMode]);

  useEffect(() => {
    if (!companyPrefix || companiesLoading || companies.length === 0) return;

    const requestedPrefix = companyPrefix.toUpperCase();
    const matched = companies.find((company) => company.issuePrefix.toUpperCase() === requestedPrefix);

    if (!matched) {
      const fallback =
        (selectedCompanyId ? companies.find((company) => company.id === selectedCompanyId) : null)
        ?? companies[0]!;
      navigate(`/${fallback.issuePrefix}/home`, { replace: true });
      return;
    }

    if (companyPrefix !== matched.issuePrefix) {
      const suffix = location.pathname.replace(/^\/[^/]+/, "");
      navigate(`/${matched.issuePrefix}${suffix}${location.search}`, { replace: true });
      return;
    }

    if (selectedCompanyId !== matched.id) {
      setSelectedCompanyId(matched.id, { source: "route_sync" });
    }
  }, [
    companyPrefix,
    companies,
    companiesLoading,
    location.pathname,
    location.search,
    navigate,
    selectedCompanyId,
    setSelectedCompanyId,
  ]);

  // G8: Navigate when company is manually switched (Cmd+1-9, etc.)
  // ONLY triggers on "manual" source to avoid 4 race conditions.
  useEffect(() => {
    if (selectionSource === "manual" && selectedCompanyId) {
      const company = companies.find((c) => c.id === selectedCompanyId);
      if (company) {
        navigate(`/${company.issuePrefix}/home`, { replace: true });
      }
    }
  }, [selectedCompanyId, selectionSource, companies, navigate]);

  // Cmd+1..9 to switch companies
  const switchCompany = useCallback(
    (index: number) => {
      if (index < companies.length) {
        setSelectedCompanyId(companies[index]!.id);
      }
    },
    [companies, setSelectedCompanyId],
  );

  // Auto-collapse sidebar on workspace routes
  useEffect(() => {
    if (!isMobile && location.pathname.includes("/workspaces/")) {
      setCollapsed(true);
    }
  }, [location.pathname, isMobile, setCollapsed]);

  useCompanyPageMemory();

  useKeyboardShortcuts({
    onNewIssue: () => openNewIssue(),
    onToggleSidebar: isMobile ? toggleSidebar : toggleCollapse,
    onSwitchCompany: switchCompany,
    onShowCheatsheet: () => setCheatsheetOpen(true),
  });

  useEffect(() => {
    if (!isMobile) {
      setMobileNavVisible(true);
      return;
    }
    lastMainScrollTop.current = 0;
    setMobileNavVisible(true);
  }, [isMobile]);

  // Swipe gesture to open/close sidebar on mobile
  useEffect(() => {
    if (!isMobile) return;

    const EDGE_ZONE = 30; // px from left edge to start open-swipe
    const MIN_DISTANCE = 50; // minimum horizontal swipe distance
    const MAX_VERTICAL = 75; // max vertical drift before we ignore

    let startX = 0;
    let startY = 0;

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0]!;
      startX = t.clientX;
      startY = t.clientY;
    };

    const onTouchEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0]!;
      const dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - startY);

      if (dy > MAX_VERTICAL) return; // vertical scroll, ignore

      // Swipe right from left edge → open
      if (!sidebarOpen && startX < EDGE_ZONE && dx > MIN_DISTANCE) {
        setSidebarOpen(true);
        return;
      }

      // Swipe left when open → close
      if (sidebarOpen && dx < -MIN_DISTANCE) {
        setSidebarOpen(false);
      }
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, [isMobile, sidebarOpen, setSidebarOpen]);

  const handleMainScroll = useCallback(
    (event: UIEvent<HTMLElement>) => {
      if (!isMobile) return;

      const currentTop = event.currentTarget.scrollTop;
      const delta = currentTop - lastMainScrollTop.current;

      if (currentTop <= 24) {
        setMobileNavVisible(true);
      } else if (delta > 8) {
        setMobileNavVisible(false);
      } else if (delta < -8) {
        setMobileNavVisible(true);
      }

      lastMainScrollTop.current = currentTop;
    },
    [isMobile],
  );

  return (
    <AgentPanelProvider>
    <div className="flex h-dvh bg-background text-foreground overflow-hidden pt-[env(safe-area-inset-top)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Skip to Main Content
      </a>
      {/* Mobile backdrop */}
      {isMobile && sidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/50"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close sidebar"
        />
      )}

      {/* Sidebar + docs bar */}
      {isMobile ? (
        <div
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex flex-col overflow-hidden pt-[env(safe-area-inset-top)] transition-transform duration-100 ease-out",
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <Sidebar />
          </div>
        </div>
      ) : (
        <div className="relative flex flex-col shrink-0 h-full">
          <div className="flex flex-1 min-h-0">
            <Sidebar />
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 h-full">
        <BreadcrumbBar />
        <main
          id="main-content"
          tabIndex={-1}
          className={cn(
            "flex-1 overflow-auto",
            !location.pathname.includes("/workspaces/") && "p-4 md:p-6",
            isMobile && "pb-[calc(5rem+env(safe-area-inset-bottom))]",
          )}
          onScroll={handleMainScroll}
        >
          <Outlet />
        </main>
      </div>


      {isMobile && <MobileBottomNav visible={mobileNavVisible} />}
      <CommandPalette />
      <NewIssueDialog />
      <NewProjectDialog />
      <NewGoalDialog />
      <NewAgentDialog />
      <ToastViewport />
      <KeyboardShortcutsCheatsheet open={cheatsheetOpen} onOpenChange={setCheatsheetOpen} />
    </div>
    </AgentPanelProvider>
  );
}
