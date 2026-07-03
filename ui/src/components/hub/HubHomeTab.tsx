import type { HubAuditRow, HubItemListRow } from "@/api/hub-items";
import { HubViewer } from "./HubViewer";

interface HubHomeTabProps {
  /** The hub item currently selected in the center list (or null). */
  selectedItem: HubItemListRow | null;
  auditRows: HubAuditRow[];
  auditLoading: boolean;
  /** Opens the selected item's entity as a dedicated sibling tab. */
  onOpenFull: (item: HubItemListRow) => void;
  /** Clears the center-list selection (drops `:itemId`). */
  onClose: () => void;
  onMarkUnread: (itemId: string) => void;
  onDismiss: (itemId: string) => void;
  onSnooze: (itemId: string) => void;
  onLifecycleAction: (
    item: HubItemListRow,
    action: "resolve" | "archive" | "claim" | "release",
  ) => void;
}

/**
 * The default (non-closeable) Home tab of the tabbed hub viewer. It is the
 * reading pane: when a center-list row is selected it shows that item's preview
 * (why / meta / audit / lifecycle actions) via {@link HubViewer} in tab-fill
 * mode, and its "Open full" opens the item's entity as a dedicated tab. When
 * nothing is selected it shows an empty prompt. The center list stays the
 * persistent left panel; this is the right-panel landing.
 */
export function HubHomeTab({
  selectedItem,
  auditRows,
  auditLoading,
  onOpenFull,
  onClose,
  onMarkUnread,
  onDismiss,
  onSnooze,
  onLifecycleAction,
}: HubHomeTabProps) {
  return (
    <div className="flex h-full w-full min-h-0 flex-col" data-testid="hub-home-tab">
      <HubViewer
        variant="tab"
        item={selectedItem}
        auditRows={auditRows}
        auditLoading={auditLoading}
        onOpenFull={onOpenFull}
        onClose={onClose}
        onMarkUnread={onMarkUnread}
        onDismiss={onDismiss}
        onSnooze={onSnooze}
        onLifecycleAction={onLifecycleAction}
      />
    </div>
  );
}
