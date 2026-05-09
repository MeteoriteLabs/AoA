import { List, Table2, LayoutGrid } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { cn } from "@/lib/utils";
import type { MemoryViewMode } from "../../hooks/useMemoryViewMode";

interface Props {
  mode: MemoryViewMode;
  onChange: (mode: MemoryViewMode) => void;
}

interface Item {
  mode: MemoryViewMode;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
}

const ITEMS: ReadonlyArray<Item> = [
  { mode: "list", Icon: List, title: "List view" },
  { mode: "table", Icon: Table2, title: "Table view" },
  { mode: "cards", Icon: LayoutGrid, title: "Cards view" },
];

export function MemoryViewToggle({ mode, onChange }: Props) {
  return (
    <div
      role="group"
      aria-label="Center pane view mode"
      className="inline-flex overflow-hidden rounded-md border border-border-strong"
    >
      {ITEMS.map(({ mode: m, Icon, title }, i) => {
        const active = mode === m;
        return (
          <button
            key={m}
            type="button"
            title={title}
            aria-pressed={active}
            onClick={() => {
              if (!active) onChange(m);
            }}
            className={cn(
              "flex h-[22px] w-[26px] items-center justify-center transition-colors",
              i > 0 && "border-l border-border",
              active
                ? "bg-brand/[0.08] text-[hsl(15_60%_75%)]"
                : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
