import { FileText, Image as ImageIcon, Film, FileType, File as FileIcon, type LucideIcon } from "lucide-react";
import type { MemoryItemCategory, MemoryItemStatus } from "@armyofagents/shared";
import { cn } from "@/lib/utils";
import { MemoryChip } from "./MemoryChip";
import {
  pickIconKind,
  pickSnippet,
  formatRelative,
  STATUS_TONE,
  CATEGORY_TONE,
  type IconKind,
} from "../../lib/memoryItemView";

export interface MemoryItemCardData {
  kind: "memory_item" | "asset";
  id: string;
  title: string;
  category?: string | null;
  status?: string | null;
  mimeType?: string | null;
  modifiedAt: string;
  content?: string | null;
  extractedText?: string | null;
  /** PDF assets only — total page count for the "page 1 of N" header. */
  pageCount?: number | null;
  /** Asset chunk count (after embedding). Used in the meta chip for PDFs. */
  chunkCount?: number | null;
}

interface Props {
  row: MemoryItemCardData;
  active: boolean;
  onSelect: (id: string, kind: "memory_item" | "asset") => void;
}

const GENERIC_ICON_FOR_KIND: Record<Exclude<IconKind, "markdown" | "image" | "pdf">, LucideIcon> = {
  video: Film,
  docx: FileType,
  generic: FileIcon,
};

export function MemoryItemCard({ row, active, onSelect }: Props) {
  const kind = pickIconKind(row);

  const outerClasses = cn(
    "group relative flex flex-col overflow-hidden rounded-lg border bg-card text-left transition-colors",
    active
      ? "border-brand bg-brand/[0.08]"
      : "border-border hover:border-border-strong hover:bg-card-2",
  );

  return (
    <button
      type="button"
      onClick={() => onSelect(row.id, row.kind)}
      className={outerClasses}
    >
      {active && (
        <span
          aria-hidden
          className="pointer-events-none absolute right-2.5 top-2.5 size-[5px] rounded-full bg-brand shadow-[0_0_6px_rgba(184,45,28,0.55)]"
        />
      )}

      {kind === "markdown" ? (
        <MarkdownVariant row={row} active={active} />
      ) : kind === "image" ? (
        <ImageVariant row={row} active={active} />
      ) : kind === "pdf" ? (
        <PdfVariant row={row} active={active} />
      ) : (
        <GenericVariant row={row} active={active} kind={kind} />
      )}
    </button>
  );
}

// ---- Markdown variant ----

function MarkdownVariant({ row, active }: { row: MemoryItemCardData; active: boolean }) {
  const snippet = pickSnippet(row);
  return (
    <div className="flex min-h-[168px] flex-col p-3.5">
      <div className="mb-2.5 flex items-center gap-2">
        <span
          className={cn(
            "size-6 shrink-0 rounded-md flex items-center justify-center",
            active ? "bg-brand/[0.14] text-[hsl(15_60%_75%)]" : "bg-white/[0.04] text-muted-foreground",
          )}
        >
          <FileText className="size-3.5" aria-hidden />
        </span>
        <span
          className={cn(
            "flex-1 truncate text-[12.5px] font-medium",
            active && "text-[hsl(15_60%_75%)]",
          )}
        >
          {row.title}
        </span>
      </div>
      {snippet && (
        <div
          className={cn(
            "mb-2.5 flex-1 line-clamp-4 text-[11.5px] leading-relaxed",
            active ? "text-muted-foreground" : "text-very-dim",
          )}
        >
          {snippet}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
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
        <span className="text-[10px] tabular-nums text-very-dim">
          {formatRelative(row.modifiedAt)}
        </span>
      </div>
    </div>
  );
}

// ---- Image variant ----

function ImageVariant({ row, active }: { row: MemoryItemCardData; active: boolean }) {
  return (
    <>
      <div
        data-card-thumb="image"
        className="flex h-[100px] items-center justify-center border-b border-border bg-gradient-to-br from-[#2a2a2a] to-[#1a1a1a] text-very-dim"
      >
        <ImageIcon className="size-8 opacity-50" aria-hidden />
      </div>
      <div className="p-3">
        <div
          className={cn(
            "truncate text-[12.5px] font-medium",
            active && "text-[hsl(15_60%_75%)]",
          )}
        >
          {row.title}
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          {row.mimeType && <MemoryChip label={row.mimeType} />}
          <span className="text-[10px] tabular-nums text-very-dim">
            {formatRelative(row.modifiedAt)}
          </span>
        </div>
      </div>
    </>
  );
}

// ---- PDF variant ----

function PdfVariant({ row, active }: { row: MemoryItemCardData; active: boolean }) {
  const snippet = pickSnippet(row);
  return (
    <>
      <div
        data-card-thumb="pdf"
        className="flex h-[100px] flex-col gap-1.5 border-b border-border bg-field p-3"
      >
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <FileText className="size-2.5" aria-hidden />
          <span>
            {row.pageCount != null
              ? `page 1 of ${row.pageCount}`
              : "page 1"}
          </span>
        </div>
        <div className="line-clamp-3 text-[10px] leading-relaxed text-very-dim">
          {snippet || "Document preview unavailable."}
        </div>
      </div>
      <div className="p-3">
        <div
          className={cn(
            "truncate text-[12.5px] font-medium",
            active && "text-[hsl(15_60%_75%)]",
          )}
        >
          {row.title}
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <MemoryChip label={`pdf · ${row.chunkCount ?? 0} chunks`} />
          <span className="text-[10px] tabular-nums text-very-dim">
            {formatRelative(row.modifiedAt)}
          </span>
        </div>
      </div>
    </>
  );
}

// ---- Generic / video / docx variant ----

function GenericVariant({
  row,
  active,
  kind,
}: {
  row: MemoryItemCardData;
  active: boolean;
  kind: Exclude<IconKind, "markdown" | "image" | "pdf">;
}) {
  const Icon = GENERIC_ICON_FOR_KIND[kind];
  return (
    <>
      <div
        data-card-thumb={kind === "generic" ? "generic" : kind}
        className="flex h-[100px] items-center justify-center border-b border-border bg-field text-very-dim"
      >
        <Icon className="size-8 opacity-50" aria-hidden />
      </div>
      <div className="p-3">
        <div
          className={cn(
            "truncate text-[12.5px] font-medium",
            active && "text-[hsl(15_60%_75%)]",
          )}
        >
          {row.title}
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          {row.mimeType && <MemoryChip label={row.mimeType} />}
          <span className="text-[10px] tabular-nums text-very-dim">
            {formatRelative(row.modifiedAt)}
          </span>
        </div>
      </div>
    </>
  );
}
