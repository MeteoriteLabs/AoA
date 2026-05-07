import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type SecondarySidebarItem = {
  id: string;
  label: string;
  count?: number;
  icon?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
};

export type SecondarySidebarSection = {
  title?: string;
  items: SecondarySidebarItem[];
};

export interface SecondarySidebarProps {
  sections: SecondarySidebarSection[];
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  className?: string;
}

export function SecondarySidebar({
  sections,
  collapsed = false,
  onToggleCollapse,
  className,
}: SecondarySidebarProps) {
  return (
    <div
      className={cn(
        "border-r border-border bg-[oklch(0.155_0.005_30)] flex flex-col py-3.5",
        "transition-[width] duration-180",
        collapsed ? "w-12 px-1" : "w-50 px-2",
        className
      )}
      data-collapsed={collapsed}
      role="navigation"
      aria-label="Page navigation"
    >
      {sections.map((section, idx) => (
        <div
          key={idx}
          className={cn(idx > 0 && "mt-2 pt-2 border-t border-border-soft")}
        >
          {!collapsed && section.title && (
            <div className="text-[0.62rem] uppercase tracking-[0.1em] text-very-dim px-2.5 py-1 mb-1 font-semibold">
              {section.title}
            </div>
          )}
          {section.items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={item.onClick}
              title={collapsed ? item.label : undefined}
              data-active={item.active ? "true" : undefined}
              className={cn(
                "w-full grid items-center gap-2 px-2.5 py-2 rounded-md text-sm transition-colors",
                "text-text/[0.78] hover:bg-white/[0.04] hover:text-text",
                collapsed ? "grid-cols-[20px] justify-center" : "grid-cols-[1fr_auto]",
                item.active && "bg-white/[0.06] text-text font-medium shadow-[inset_2px_0_0_var(--brand)]"
              )}
            >
              {collapsed ? (
                <span className="text-current inline-flex items-center justify-center [&_svg]:size-4">
                  {item.icon ?? item.label.charAt(0).toUpperCase()}
                </span>
              ) : (
                <>
                  <span className="text-left flex items-center gap-2 [&_svg]:size-4">
                    {item.icon}
                    {item.label}
                  </span>
                  {item.count !== undefined && (
                    <span
                      className={cn(
                        "font-mono text-[0.68rem] text-very-dim",
                        item.active && "text-text/[0.8]"
                      )}
                    >
                      {item.count}
                    </span>
                  )}
                </>
              )}
            </button>
          ))}
        </div>
      ))}
      {onToggleCollapse && (
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="mt-auto mx-2 my-2 size-7 rounded-md text-very-dim hover:bg-white/[0.04] hover:text-text inline-flex items-center justify-center"
        >
          {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
        </button>
      )}
    </div>
  );
}
