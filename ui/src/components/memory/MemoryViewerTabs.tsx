import {
  FileText,
  Image as ImageIcon,
  X,
  PanelRightClose,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { MemoryTab, MemoryTabKind, TabKey } from "../../lib/memoryTabs";

interface Props {
  tabs: ReadonlyArray<MemoryTab>;
  activeKey: TabKey | null;
  onActivate: (id: string, kind: MemoryTabKind) => void;
  onClose: (id: string, kind: MemoryTabKind) => void;
  onCollapse: () => void;
}

const ICON_FOR_KIND: Record<MemoryTabKind, LucideIcon> = {
  memory_item: FileText,
  asset: ImageIcon,
};

function isActive(tab: MemoryTab, key: TabKey | null): boolean {
  return key !== null && tab.id === key.id && tab.kind === key.kind;
}

export function MemoryViewerTabs({
  tabs,
  activeKey,
  onActivate,
  onClose,
  onCollapse,
}: Props) {
  return (
    <div className="flex h-9 shrink-0 items-center border-b border-border bg-card">
      <div
        role="tablist"
        aria-label="Open memory items"
        className="flex flex-1 overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
      >
        {tabs.map((t) => {
          const active = isActive(t, activeKey);
          const Icon = ICON_FOR_KIND[t.kind];
          return (
            <div
              key={`${t.kind}:${t.id}`}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              data-tab-id={t.id}
              data-tab-kind={t.kind}
              data-active={active}
              onClick={() => onActivate(t.id, t.kind)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onActivate(t.id, t.kind);
                }
              }}
              className={cn(
                "group relative inline-flex h-[30px] cursor-pointer items-center gap-1.5 border-r border-border pl-2.5 pr-2 text-xs",
                "max-w-[220px]",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-focus-ring",
                active
                  ? "bg-brand/[0.08] text-[hsl(15_60%_75%)]"
                  : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
              )}
            >
              <Icon className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{t.title}</span>
              <button
                type="button"
                data-slot="close"
                aria-label={`Close ${t.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(t.id, t.kind);
                }}
                className={cn(
                  "ml-1 rounded p-0.5 transition-opacity",
                  active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                  "hover:bg-white/[0.08]",
                )}
              >
                <X className="size-3" aria-hidden />
              </button>
              {active && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 size-[5px] rounded-full bg-brand shadow-[0_0_6px_rgba(184,45,28,0.55)]"
                />
              )}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        title="Collapse pane"
        aria-label="Collapse pane"
        onClick={onCollapse}
        className="flex h-9 w-9 shrink-0 items-center justify-center border-l border-border text-very-dim hover:bg-white/[0.04] hover:text-foreground"
      >
        <PanelRightClose className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
