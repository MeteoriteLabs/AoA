import { ExternalLink, PanelRightClose } from "lucide-react";
import { Link } from "@/lib/router";
import type { HubItemListRow } from "@/api/hub-items";
import { Button } from "@/components/ui/button";
import { HUB_REGISTRY } from "./hubRegistry";

interface HubViewerProps {
  item: HubItemListRow | null;
  onClose?: () => void;
}

export function HubViewer({ item, onClose }: HubViewerProps) {
  if (!item) {
    return (
      <aside
        aria-label="Hub viewer"
        className="flex h-full w-[360px] shrink-0 items-center justify-center border-l border-border bg-bg p-6 text-center text-sm text-muted-foreground"
      >
        Select an item to review details.
      </aside>
    );
  }

  const entry = HUB_REGISTRY[item.semanticType];
  const Icon = entry.icon;
  const fullLink = entry.fullLink(item);

  return (
    <aside
      aria-label="Hub viewer"
      className="flex h-full w-[360px] shrink-0 flex-col border-l border-border bg-bg"
    >
      <div className="flex h-12 items-center justify-between border-b border-border px-4">
        <div role="tablist" aria-label="Hub item viewer" className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            role="tab"
            aria-selected="true"
            className="inline-flex min-w-0 items-center gap-2 border-b-2 border-brand px-1 py-3 text-sm font-medium"
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{entry.label}</span>
          </button>
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label="Close viewer" onClick={onClose}>
          <PanelRightClose className="size-4" aria-hidden="true" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="text-xs uppercase text-muted-foreground">{entry.viewerKind}</div>
        <h2 className="mt-2 text-lg font-semibold leading-snug">{item.title}</h2>
        {item.summary ? (
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.summary}</p>
        ) : null}
        <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Priority</dt>
            <dd className="mt-1 font-medium">{item.priority}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Status</dt>
            <dd className="mt-1 font-medium">{item.status}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Source</dt>
            <dd className="mt-1 truncate font-medium">{item.sourceType ?? "Hub"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Version</dt>
            <dd className="mt-1 font-medium">{item.version}</dd>
          </div>
        </dl>
      </div>
      <div className="border-t border-border p-4">
        {fullLink ? (
          <Button asChild variant="secondary" className="w-full">
            <Link to={fullLink}>
              <ExternalLink className="size-4" aria-hidden="true" />
              Open full
            </Link>
          </Button>
        ) : (
          <Button type="button" variant="secondary" className="w-full" disabled>
            Open full
          </Button>
        )}
      </div>
    </aside>
  );
}
