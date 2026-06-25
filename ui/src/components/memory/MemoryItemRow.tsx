import { FileText, Image as ImageIcon, Film, type LucideIcon } from "lucide-react";
import type { MemoryItemCategory, MemoryItemStatus, MemoryIndexStatus } from "@armyofagents/shared";
import { cn } from "@/lib/utils";
import { MemoryChip } from "./MemoryChip";
import { MemoryIndexBadge } from "./MemoryIndexBadge";
import {
  pickIconKind,
  pickSnippet,
  formatRelative,
  STATUS_TONE,
  CATEGORY_TONE,
  type IconKind,
} from "../../lib/memoryItemView";

export interface MemoryItemRowData {
  kind: "memory_item" | "asset";
  id: string;
  title: string;
  category?: string | null;
  status?: string | null;
  mimeType?: string | null;
  modifiedAt: string;
  content?: string | null;
  extractedText?: string | null;
  /** Embedding index status. Only relevant for memory_item kind. */
  indexStatus?: MemoryIndexStatus | null;
}

interface Props {
  row: MemoryItemRowData;
  active: boolean;
  onSelect: (id: string, kind: "memory_item" | "asset") => void;
  onReindex?: (id: string) => void;
}

const ICON_FOR_KIND: Record<IconKind, LucideIcon> = {
  markdown: FileText,
  image: ImageIcon,
  video: Film,
  pdf: FileText,
  docx: FileText,
  generic: FileText,
};

export function MemoryItemRow({ row, active, onSelect, onReindex }: Props) {
  const kind = pickIconKind(row);
  const snippet = pickSnippet(row);
  const Icon = ICON_FOR_KIND[kind];

  return (
    <button
      type="button"
      onClick={() => onSelect(row.id, row.kind)}
      className={cn(
        "relative flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors",
        active ? "bg-brand/[0.08]" : "hover:bg-white/[0.04]",
      )}
    >
      <span
        className={cn(
          "size-7 shrink-0 rounded-md flex items-center justify-center",
          active
            ? "bg-brand/[0.14] text-[hsl(15_60%_75%)]"
            : "bg-white/[0.04] text-muted-foreground",
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "flex-1 truncate text-[13px] font-medium",
              active && "text-[hsl(15_60%_75%)]",
            )}
          >
            {row.title}
          </span>

          {row.category && (
            <MemoryChip
              label={row.category}
              tone={CATEGORY_TONE[row.category as MemoryItemCategory] ?? "slate"}
            />
          )}

          {row.status && (
            <MemoryChip
              label={row.status}
              tone={STATUS_TONE[row.status as MemoryItemStatus] ?? "slate"}
            />
          )}

          {row.kind === "asset" && row.mimeType && (
            <MemoryChip label={row.mimeType} />
          )}

          {row.indexStatus && (
            <MemoryIndexBadge
              status={row.indexStatus}
              onReindex={onReindex ? () => onReindex(row.id) : undefined}
            />
          )}

          <span className="text-[10px] tabular-nums text-very-dim shrink-0">
            {formatRelative(row.modifiedAt)}
          </span>
        </div>

        {snippet && (
          <div
            className={cn(
              "mt-1 text-[11.5px] leading-snug line-clamp-2",
              active ? "text-muted-foreground" : "text-very-dim",
            )}
          >
            {snippet}
          </div>
        )}
      </div>

      {active && (
        <span
          aria-hidden
          className="pointer-events-none absolute right-2.5 top-3 size-[5px] rounded-full bg-brand shadow-[0_0_6px_rgba(184,45,28,0.55)]"
        />
      )}
    </button>
  );
}
