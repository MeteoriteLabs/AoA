import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Pin } from "lucide-react";
import type { MemoryItem } from "@armyofagents/shared";
import { memoryApi } from "../../../api/memory";
import { queryKeys } from "../../../lib/queryKeys";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface MarkdownItemViewerProps {
  companyId: string;
  itemId: string;
}

const STATUS_PILL: Record<string, string> = {
  approved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  archived: "bg-gray-100 text-gray-800 dark:bg-gray-900/40 dark:text-gray-300",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  draft: "bg-slate-100 text-slate-800 dark:bg-slate-900/40 dark:text-slate-300",
};

const LAYER_PILL: Record<string, string> = {
  identity: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  domain: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300",
  active_context: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  working: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
};

export function MarkdownItemViewer({ companyId, itemId }: MarkdownItemViewerProps) {
  const { data: item, isLoading, isError } = useQuery({
    queryKey: queryKeys.memory.detail(companyId, itemId),
    queryFn: () => memoryApi.get(companyId, itemId),
    enabled: Boolean(companyId && itemId),
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-3">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    );
  }

  if (isError || !item) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        Could not load memory item.
      </div>
    );
  }

  const i = item as MemoryItem & {
    layer?: string | null;
    pinnedToSkill?: boolean;
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-6 pb-3 border-b border-border">
        <div className="flex items-center gap-2 text-[10px] mb-2">
          {i.status && (
            <span
              className={cn(
                "px-2 py-0.5 rounded font-medium uppercase tracking-wider",
                STATUS_PILL[i.status] ?? "bg-muted text-muted-foreground",
              )}
            >
              {i.status}
            </span>
          )}
          {i.layer && (
            <span
              className={cn(
                "px-2 py-0.5 rounded font-medium uppercase tracking-wider",
                LAYER_PILL[i.layer] ?? "bg-muted text-muted-foreground",
              )}
            >
              {i.layer.replace("_", " ")}
            </span>
          )}
          {i.category && (
            <span className="px-2 py-0.5 rounded bg-muted text-muted-foreground uppercase tracking-wider font-medium">
              {i.category}
            </span>
          )}
          {i.pinnedToSkill && (
            <span
              className="inline-flex items-center gap-1 text-muted-foreground"
              title="Pinned to skill"
            >
              <Pin className="h-3 w-3" />
            </span>
          )}
        </div>
        <h1 className="text-xl font-semibold">{i.title}</h1>
      </div>
      <div className="flex-1 overflow-auto px-6 py-5 prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{i.content}</ReactMarkdown>
      </div>
    </div>
  );
}
