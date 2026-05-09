import { useEffect, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { useSidebar } from "@/context/SidebarContext";
import { Building, Shield, KeyRound, DollarSign, Plug, Puzzle, Store, Archive } from "lucide-react";
import { cn } from "@/lib/utils";

export type SettingsSectionId =
  | "general" | "commander" | "llm" | "budget" | "mcp"
  | "plugins" | "marketplace" | "archive";

interface SettingsItem {
  id: SettingsSectionId;
  label: string;
  icon: LucideIcon;
  tone?: "danger";
}

interface SettingsGroup {
  group: string;
  items: readonly SettingsItem[];
}

export const SETTINGS_SECTIONS: readonly SettingsGroup[] = [
  { group: "Company",    items: [
    { id: "general",     label: "General",            icon: Building },
  ]},
  { group: "Operations", items: [
    { id: "commander",   label: "Commander",          icon: Shield },
    { id: "llm",         label: "LLM providers",      icon: KeyRound },
    { id: "budget",      label: "Budget & caps",      icon: DollarSign },
    { id: "mcp",         label: "MCP API keys",       icon: Plug },
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
  const { setCollapsed, isMobile } = useSidebar();

  // Decision #98 — auto-collapse primary sidebar on entry to give secondary the prominent role.
  useEffect(() => {
    if (!isMobile) setCollapsed(true);
  }, [isMobile, setCollapsed]);

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      {/* SecondarySidebar — 200px expanded. Desktop only. */}
      <aside className="hidden md:flex w-[200px] shrink-0 flex-col bg-card/30 border-r border-border">
        <div className="h-14 px-4 flex items-center border-b border-border">
          <div className="text-[13px] font-semibold tracking-tight text-foreground">Settings</div>
        </div>
        <nav className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none] py-2 px-2">
          {SETTINGS_SECTIONS.map((group) => (
            <div key={group.group}>
              <div className="px-3 mt-3 mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/60">
                {group.group}
              </div>
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = activeSection === item.id;
                const isDanger = item.tone === "danger";
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSectionChange(item.id)}
                    className={cn(
                      "relative w-full flex items-center gap-2.5 h-[30px] px-2.5 rounded-md text-[13px] font-medium transition-colors",
                      active
                        ? "bg-brand/[0.08] text-[hsl(15_60%_75%)]"
                        : "text-foreground/[0.78] hover:bg-white/[0.04] hover:text-foreground",
                    )}
                  >
                    <Icon className={cn("size-4 shrink-0", isDanger && "text-red-400/80")} />
                    <span className="flex-1 text-left truncate">{item.label}</span>
                    {active && (
                      <span aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 size-[5px] rounded-full bg-brand shadow-[0_0_6px_rgba(184,45,28,0.55)]" />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      {/* Mobile sub-nav — horizontal scrollable pill row */}
      <div className="md:hidden border-b border-border-soft py-2 px-3 flex gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
        {SETTINGS_SECTIONS.flatMap((g) => g.items).map((item) => {
          const Icon = item.icon;
          const active = activeSection === item.id;
          const isDanger = item.tone === "danger";
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
                isDanger && !active && "text-red-400/80"
              )}
            >
              <Icon className="size-3.5" />
              {item.label}
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
