import type { HubItemListRow } from "@/api/hub-items";
import { HUB_REGISTRY } from "./hubRegistry";
import { cn } from "@/lib/utils";

interface HubListProps {
  items: HubItemListRow[];
  isLoading: boolean;
  error: unknown;
  selectedItemId: string | null;
  onSelectItem: (itemId: string) => void;
  onMarkRead: (itemId: string) => void;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export function HubList({
  items,
  isLoading,
  error,
  selectedItemId,
  onSelectItem,
  onMarkRead,
}: HubListProps) {
  if (isLoading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading hub items...</div>;
  }
  if (error) {
    return <div className="p-4 text-sm text-error">Could not load hub items.</div>;
  }
  if (items.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">No open items in this lane.</div>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {items.map((item) => {
        const entry = HUB_REGISTRY[item.semanticType];
        const Icon = entry.icon;
        const selected = selectedItemId === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              onSelectItem(item.id);
              if (!item.readAt) onMarkRead(item.id);
            }}
            className={cn(
              "grid h-[92px] w-full grid-cols-[28px_1fr_auto] gap-3 border-b border-border px-4 py-3 text-left transition-colors hover:bg-card",
              selected && "bg-card",
            )}
          >
            <span className="mt-0.5 flex size-7 items-center justify-center rounded-md border border-border bg-bg">
              <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                {!item.readAt ? (
                  <span className="size-1.5 shrink-0 rounded-full bg-brand" aria-label="Unread" />
                ) : null}
                <span className="truncate text-sm font-medium text-text">{item.title}</span>
              </span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">
                {item.summary ?? entry.label}
              </span>
              <span className="mt-2 flex min-w-0 gap-1.5">
                <span className="inline-flex rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  {entry.label}
                </span>
                <span className="inline-flex rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  {item.priority}
                </span>
              </span>
            </span>
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              {formatDate(item.createdAt)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
