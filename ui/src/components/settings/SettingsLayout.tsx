import { useEffect, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { useSidebar } from "@/context/SidebarContext";
import { Building, Shield, KeyRound, DollarSign, Plug, Puzzle, Store, Archive, Github, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SidebarCollapseToggle } from "@/components/SidebarCollapseToggle";

const SECONDARY_COLLAPSED_KEY = "aoa.settings-secondary-collapsed";

export type SettingsSectionId =
  | "general" | "commander" | "llm" | "budget" | "mcp" | "github"
  | "plugins" | "marketplace" | "archive"
  | "activity";

interface SettingsItem {
  id: SettingsSectionId;
  label: string;
  icon: LucideIcon;
  tone?: "danger" | "transitional";
}

interface SettingsGroup {
  group: string;
  items: readonly SettingsItem[];
}

export const SETTINGS_SECTIONS: readonly SettingsGroup[] = [
  { group: "Company",    items: [
    { id: "general",     label: "General",            icon: Building },
    { id: "activity",    label: "Activity",           icon: Activity },
  ]},
  { group: "Operations", items: [
    { id: "commander",   label: "Commander",          icon: Shield },
    { id: "llm",         label: "LLM providers",      icon: KeyRound },
    { id: "budget",      label: "Budget & caps",      icon: DollarSign },
    { id: "mcp",         label: "MCP API keys",       icon: Plug },
    { id: "github",      label: "GitHub",             icon: Github, tone: "transitional" },
  ]},
  { group: "Extensions", items: [
    { id: "plugins",     label: "Plugins",            icon: Puzzle },
    { id: "marketplace", label: "Marketplace prefs",  icon: Store },
  ]},
  { group: "Danger",     items: [
    { id: "archive",     label: "Archive company",    icon: Archive, tone: "danger" },
  ]},
];

interface SettingsLayoutProps {
  activeSection: SettingsSectionId;
  onSectionChange: (id: SettingsSectionId) => void;
  children: ReactNode;
}

export function SettingsLayout({ activeSection, onSectionChange, children }: SettingsLayoutProps) {
  const { setCollapsed: setPrimaryCollapsed, isMobile } = useSidebar();

  // Decision #98 — auto-collapse PRIMARY sidebar on entry to give SECONDARY the prominent role.
  useEffect(() => {
    if (!isMobile) setPrimaryCollapsed(true);
  }, [isMobile, setPrimaryCollapsed]);

  // Secondary sidebar collapse state, persisted to localStorage.
  const [secondaryCollapsed, setSecondaryCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SECONDARY_COLLAPSED_KEY) === "true";
    } catch {
      return false;
    }
  });
  const toggleSecondary = () => {
    setSecondaryCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(SECONDARY_COLLAPSED_KEY, String(next)); } catch { /* noop */ }
      return next;
    });
  };

  const secondaryWidth = secondaryCollapsed ? 48 : 200;

  return (
    <div className="relative flex h-full min-h-0 flex-col md:flex-row">
      {/* SecondarySidebar — desktop only. NO redundant "Settings" header. */}
      <aside
        className={cn(
          "hidden md:flex shrink-0 flex-col bg-card/30 border-r border-border transition-[width] duration-180",
          secondaryCollapsed ? "w-[48px]" : "w-[200px]",
        )}
      >
        <nav
          className={cn(
            "flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none] py-3",
            secondaryCollapsed ? "px-1" : "px-2",
          )}
        >
          {SETTINGS_SECTIONS.map((group, gi) => (
            <div key={group.group} className={cn(gi > 0 && (secondaryCollapsed ? "mt-2 pt-2 border-t border-border-soft mx-1" : "mt-3"))}>
              {!secondaryCollapsed && (
                <div className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/60">
                  {group.group}
                </div>
              )}
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = activeSection === item.id;
                const isDanger = item.tone === "danger";
                const isTransitional = item.tone === "transitional";
                const button = (
                  <button
                    type="button"
                    onClick={() => onSectionChange(item.id)}
                    className={cn(
                      "relative w-full flex items-center rounded-md transition-colors",
                      secondaryCollapsed
                        ? "h-9 justify-center"
                        : "h-[30px] gap-2.5 px-2.5 text-[13px] font-medium",
                      active
                        ? "bg-brand/[0.08] text-[hsl(15_60%_75%)]"
                        : "text-foreground/[0.78] hover:bg-white/[0.04] hover:text-foreground",
                    )}
                  >
                    <Icon className={cn("size-4 shrink-0", isDanger && "text-red-400/80")} />
                    {!secondaryCollapsed && (
                      <>
                        <span className="flex-1 text-left truncate">{item.label}</span>
                        {isTransitional && (
                          <span className="ml-auto px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded-sm bg-amber-500/15 text-amber-400/80 border border-amber-500/30">
                            →plugins
                          </span>
                        )}
                      </>
                    )}
                    {active && (
                      <span aria-hidden className={cn(
                        "pointer-events-none absolute size-[5px] rounded-full bg-brand shadow-[0_0_6px_rgba(184,45,28,0.55)]",
                        secondaryCollapsed ? "right-1.5 top-1.5" : "right-2.5 top-1/2 -translate-y-1/2",
                      )} />
                    )}
                  </button>
                );
                if (!secondaryCollapsed) return <div key={item.id}>{button}</div>;
                return (
                  <Tooltip key={item.id}>
                    <TooltipTrigger asChild>{button}</TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8}>
                      {item.label}
                      {isTransitional && " — migrating to plugins"}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      {/* External collapse toggle — hidden on mobile (parity with primary sidebar) */}
      {!isMobile && (
        <SidebarCollapseToggle
          collapsed={secondaryCollapsed}
          onToggle={toggleSecondary}
          sidebarWidth={secondaryWidth}
          className="hidden md:inline-flex"
          ariaLabel={secondaryCollapsed ? "Expand settings nav" : "Collapse settings nav"}
        />
      )}

      {/* Mobile sub-nav — horizontal scrollable pill row */}
      <div className="md:hidden border-b border-border-soft py-2 px-3 flex gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
        {SETTINGS_SECTIONS.flatMap((g) => g.items).map((item) => {
          const Icon = item.icon;
          const active = activeSection === item.id;
          const isDanger = item.tone === "danger";
          const isTransitional = item.tone === "transitional";
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSectionChange(item.id)}
              className={cn(
                "shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12.5px] font-medium border whitespace-nowrap",
                active
                  ? "bg-brand/[0.12] border-brand/40 text-[hsl(15_60%_75%)]"
                  : "bg-card border-border text-muted-foreground",
                isDanger && !active && "text-red-400/80",
                isTransitional && !active && "border-amber-500/30 text-amber-400/80",
              )}
            >
              <Icon className="size-3.5" />
              {item.label}
              {isTransitional && (
                <span
                  aria-hidden
                  className="ml-0.5 text-[8px] font-bold uppercase tracking-wider opacity-80"
                >
                  →
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Main content panel */}
      <main className="flex-1 min-w-0 overflow-y-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
        {children}
      </main>
    </div>
  );
}
