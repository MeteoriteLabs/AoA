import { useEffect, useState } from "react";
import { useNavigate } from "@/lib/router";
import {
  BookOpen,
  Building2,
  FileText,
  Plus,
  Settings,
  Store,
} from "lucide-react";
import { UserMenu } from "@/components/UserMenu";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SidebarCollapseToggle } from "@/components/SidebarCollapseToggle";
import { cn } from "@/lib/utils";

const COLLAPSE_KEY = "aoa.lobby.sidebar-collapsed";

interface LobbyNavRowProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  collapsed?: boolean;
  onClick: () => void;
}

function LobbyNavRow({ icon: Icon, label, active, collapsed, onClick }: LobbyNavRowProps) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      data-active={active ? "true" : undefined}
      title={collapsed ? label : undefined}
      className={cn(
        "relative flex w-full items-center gap-2.5 rounded-md text-[13px] font-medium transition-colors",
        collapsed ? "h-9 justify-center px-0" : "px-3 py-2",
        active
          ? "bg-brand/[0.08] text-[hsl(15_60%_75%)]"
          : "text-foreground/[0.78] hover:bg-white/[0.04] hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      {!collapsed && <span className="flex-1 truncate text-left">{label}</span>}
      {active && (
        <span
          aria-hidden
          className={cn(
            "absolute size-[5px] rounded-full bg-brand shadow-[0_0_6px_rgba(184,45,28,0.55)]",
            collapsed ? "right-1.5 top-1.5" : "right-2.5 top-1/2 -translate-y-1/2",
          )}
        />
      )}
    </button>
  );

  if (!collapsed) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Keys for the lobby-level nav items (the rows visible in {@link LobbySidebar}). */
export type LobbySidebarItem =
  | "organizations"
  | "marketplace"
  | "learn"
  | "documentation"
  | "settings";

interface LobbySidebarProps {
  onCreateCompany: () => void;
  /**
   * Which nav row to highlight as active. Defaults to "organizations" so the
   * Lobby page (the original consumer) keeps working without changes.
   */
  activeItem?: LobbySidebarItem;
  /**
   * When true, the sidebar runs in "drawer" mode — always expanded, no
   * external collapse toggle, no localStorage persistence. Used inside a
   * mobile Sheet drawer where collapsing doesn't make sense.
   */
  drawer?: boolean;
  /** Optional callback invoked when a nav item is clicked (for closing the drawer on mobile). */
  onNavigate?: () => void;
  /**
   * Override the persisted-collapse default. When provided, the sidebar starts
   * in this state on first mount and writes through to localStorage as the
   * user toggles. Used to auto-collapse on page entry (e.g., Settings).
   */
  defaultCollapsed?: boolean;
}

/**
 * Sidebar for the global Lobby page.
 *
 * Pre-company-selection chrome. Header: AoA. wordmark. Below: prominent
 * "+ New company" CTA. Nav grouped Companies / Marketplace, then Learn
 * (Learn + Documentation), then System (Settings). Footer: UserMenu
 * (squircle avatar). External {@link SidebarCollapseToggle} floats on the
 * right edge of the sidebar (top-aligned with the AoA. wordmark).
 *
 * Collapsed state shrinks to 56px wide, hiding labels (tooltips show on hover)
 * and section headers. Persisted via localStorage `aoa.lobby.sidebar-collapsed`.
 *
 * When `drawer` is true (mobile menu mode), the sidebar is always rendered at
 * full width (no collapse), the external collapse toggle is hidden, and the
 * `onNavigate` callback fires after each nav click so the parent can close
 * the drawer.
 */
export function LobbySidebar({
  onCreateCompany,
  activeItem = "organizations",
  drawer = false,
  onNavigate,
  defaultCollapsed,
}: LobbySidebarProps) {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (drawer) return false;
    // Pages with a secondary sidebar (Settings, Marketplace) explicitly request
    // primary collapse. Honor that on every mount, regardless of the user's
    // stored preference — the secondary sidebar is the prominent nav on these
    // pages, so the primary should collapse out of the way every time.
    if (defaultCollapsed === true) return true;
    try {
      const stored = localStorage.getItem(COLLAPSE_KEY);
      if (stored === "true") return true;
      if (stored === "false") return false;
      return defaultCollapsed ?? false;
    } catch {
      return defaultCollapsed ?? false;
    }
  });

  useEffect(() => {
    if (drawer) return;
    try {
      localStorage.setItem(COLLAPSE_KEY, String(collapsed));
    } catch {
      // noop — storage may be disabled
    }
  }, [collapsed, drawer]);

  const navTo = (path: string) => {
    navigate(path);
    onNavigate?.();
  };

  const create = () => {
    onCreateCompany();
    onNavigate?.();
  };

  return (
    <>
      <aside
        data-collapsed={collapsed}
        data-drawer={drawer || undefined}
        className={cn(
          "relative flex h-dvh shrink-0 flex-col",
          drawer ? "w-full" : "border-r border-border bg-card/50 backdrop-blur-sm transition-[width] duration-180",
          !drawer && (collapsed ? "w-[56px]" : "w-[220px]"),
          !drawer && "lobby-sidebar-enter",
        )}
      >
        {/* Header — AoA. wordmark */}
        <div
          className={cn(
            "flex h-14 shrink-0 items-center border-b border-border",
            collapsed ? "justify-center px-0" : "px-4",
          )}
        >
          <span className="text-base font-extrabold tracking-[-0.02em] text-foreground">
            {collapsed ? "A" : "AoA"}
            <span className="text-brand">.</span>
          </span>
        </div>

        {/* + New company button */}
        <div
          className={cn(
            "shrink-0 border-b border-border-soft",
            collapsed ? "px-2 py-2.5" : "px-3 py-3.5",
          )}
        >
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  onClick={create}
                  aria-label="New organization"
                  className="size-9 mx-auto"
                >
                  <Plus />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>New organization</TooltipContent>
            </Tooltip>
          ) : (
            <Button
              size="default"
              onClick={create}
              className="w-full justify-center gap-1.5"
            >
              <Plus />
              New organization
            </Button>
          )}
        </div>

        {/* Nav rows */}
        <nav className="flex flex-1 flex-col gap-0.5 p-2">
          <LobbyNavRow
            icon={Building2}
            label="Organizations"
            active={activeItem === "organizations"}
            collapsed={collapsed}
            onClick={() => navTo("/")}
          />
          <LobbyNavRow
            icon={Store}
            label="Marketplace"
            active={activeItem === "marketplace"}
            collapsed={collapsed}
            onClick={() => navTo("/marketplace")}
          />

          {!collapsed && (
            <div className="mt-2 px-2.5 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.1em] opacity-50">
              Learn
            </div>
          )}
          {collapsed && <div className="my-2 mx-1 h-px bg-border-soft" aria-hidden />}
          <LobbyNavRow
            icon={BookOpen}
            label="Learn"
            active={activeItem === "learn"}
            collapsed={collapsed}
            onClick={() => navTo("/learn")}
          />
          <LobbyNavRow
            icon={FileText}
            label="Documentation"
            active={activeItem === "documentation"}
            collapsed={collapsed}
            onClick={() => navTo("/docs")}
          />

          {!collapsed && (
            <div className="mt-2 px-2.5 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.1em] opacity-50">
              System
            </div>
          )}
          {collapsed && <div className="my-2 mx-1 h-px bg-border-soft" aria-hidden />}
          <LobbyNavRow
            icon={Settings}
            label="Settings"
            active={activeItem === "settings"}
            collapsed={collapsed}
            onClick={() => navTo("/instance/settings")}
          />
        </nav>

        {/* User menu */}
        <div className="shrink-0 border-t border-border p-2">
          <UserMenu collapsed={collapsed} />
        </div>
      </aside>

      {/* External collapse button — floats on the sidebar/main border,
          top-aligned with AoA. Only on tablet+ (md+). Hidden on mobile (where
          the sidebar lives in a Sheet drawer instead). Hidden in drawer mode. */}
      {!drawer && (
        <SidebarCollapseToggle
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => !c)}
          sidebarWidth={collapsed ? 56 : 220}
          className="hidden md:inline-flex"
        />
      )}
    </>
  );
}
