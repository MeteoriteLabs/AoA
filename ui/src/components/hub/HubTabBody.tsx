import { Loader2 } from "lucide-react";
import { TaskDetail } from "@/components/TaskDetail";
import { BrowserViewer } from "@/components/viewers/BrowserViewer";
import { BudgetCapsSection } from "@/components/settings/sections/BudgetCapsSection";
import type { HubItemListRow } from "@/api/hub-items";
import type { IssueContextBundle } from "@/api/issues";
import { TaskOutputViewer } from "../threads/TaskOutputViewer";
import { HUB_TABPANEL_ID } from "./HubTabStrip";
import { RuntimeDecisionPanel } from "./RuntimeDecisionPanel";
import {
  browserTab,
  type HubBrowserPayload,
  type HubRuntimeDecisionPayload,
  type HubTab,
  type HubTabKind,
  type HubTaskPayload,
} from "./hubViewerModel";

interface HubTabBodyProps {
  tab: HubTab;
  companyId: string | undefined;
  onOpenTab: (tab: HubTab) => void;
  /**
   * Resolves a hub item id back to its full {@link HubItemListRow}. The
   * runtime_decision tab payload only carries `{ hubItemId }`, but
   * {@link RuntimeDecisionPanel} needs the full row. The parent (E2/G1) supplies
   * this; when absent, the runtime_decision tab falls back to a placeholder.
   */
  resolveHubItem?: (hubItemId: string) => HubItemListRow | undefined;
}

/**
 * Renders the body for the active hub tab. The root always carries the
 * {@link HUB_TABPANEL_ID} + `role="tabpanel"` so the tab chrome's
 * `aria-controls` resolves, and it fills the panel fluidly (`w-full h-full`)
 * rather than the legacy fixed 360px HubViewer aside (A2 review).
 *
 * Live-wired kinds: home (placeholder stub, E2 swaps in the real HubHomeTab),
 * task, task_output, browser, budget, runtime_decision (needs `resolveHubItem`;
 * placeholder until the parent supplies it in E2/G1). Kinds without a dedicated
 * hub payload (artifact, memory) or not yet built (approval, join_request,
 * thread, agent, run, suggestion, marketplace_op, reminder, routine) fall
 * through to {@link TabLoadingPlaceholder} — never to `null` — so the panel
 * still renders while Phase D/E wires them.
 */
export function HubTabBody({ tab, companyId, onOpenTab, resolveHubItem }: HubTabBodyProps) {
  return (
    <div
      id={HUB_TABPANEL_ID}
      role="tabpanel"
      className="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden"
      data-testid="hub-tab-body"
      data-tab-kind={tab.kind}
    >
      <HubTabBodyContent
        tab={tab}
        companyId={companyId}
        onOpenTab={onOpenTab}
        resolveHubItem={resolveHubItem}
      />
    </div>
  );
}

function HubTabBodyContent({ tab, onOpenTab, resolveHubItem }: HubTabBodyProps) {
  switch (tab.kind) {
    case "home":
      return <HubHomePlaceholder />;

    case "task": {
      const payload = tab.payload as HubTaskPayload | undefined;
      if (!payload) return <TabLoadingPlaceholder kind={tab.kind} />;
      return (
        <TaskDetail
          issueId={payload.issueId}
          active
          onOpenScopeHandoffItem={(item) => handleTaskHandoff(item, onOpenTab)}
        />
      );
    }

    case "task_output": {
      const payload = tab.payload as HubTaskPayload | undefined;
      if (!payload) return <TabLoadingPlaceholder kind={tab.kind} />;
      return <TaskOutputViewer issueId={payload.issueId} embedded />;
    }

    case "browser": {
      const payload = tab.payload as HubBrowserPayload | undefined;
      return <BrowserViewer key={tab.key} initialUrl={payload?.url ?? "about:blank"} />;
    }

    case "budget":
      return <BudgetCapsSection />;

    case "notification":
      return <HubNotificationBody tab={tab} />;

    case "runtime_decision": {
      // The runtime_decision tab payload only carries `{ hubItemId }`, but
      // RuntimeDecisionPanel needs the full HubItemListRow. The parent supplies
      // `resolveHubItem` (E2/G1); until then, fall back to the placeholder.
      const payload = tab.payload as HubRuntimeDecisionPayload | undefined;
      const item = payload && resolveHubItem ? resolveHubItem(payload.hubItemId) : undefined;
      if (!item) return <TabLoadingPlaceholder kind={tab.kind} />;
      return (
        <div className="h-full w-full overflow-auto p-5" data-testid="hub-runtime-decision-body">
          <RuntimeDecisionPanel item={item} />
        </div>
      );
    }

    // `artifact` and `memory` are declared kinds but the hub tab model has no
    // HubArtifactPayload / HubMemoryPayload yet (no artifactId / memoryId /
    // companyId to feed ArtifactAttachmentViewer or MemoryLinkedViewer).
    // Placeholder rather than guess — real wiring lands in Phase D/E once the
    // payloads + tab factories exist.
    case "artifact":
    case "memory":
    // Not-yet-built kinds — Phase D/E wire these.
    case "approval":
    case "join_request":
    case "thread":
    case "agent":
    case "run":
    case "suggestion":
    case "marketplace_op":
    case "reminder":
    case "routine":
      return <TabLoadingPlaceholder kind={tab.kind} />;

    default:
      // Exhaustiveness guard: any new kind falls back to a placeholder, never null.
      return <TabLoadingPlaceholder kind={(tab as HubTab).kind} />;
  }
}

/**
 * Re-emit a task's scope-handoff item as a hub tab. Mirrors ThreadViewer's
 * task-branch handoff (ThreadViewer.tsx ~355-380). The hub model only exposes a
 * browser tab factory today, so URL handoffs open a browser tab; artifact/asset
 * handoffs are no-ops until hub artifact/asset tabs exist (Phase D/E).
 */
function handleTaskHandoff(
  item: IssueContextBundle["items"][number],
  onOpenTab: (tab: HubTab) => void,
) {
  const metadata =
    item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
      ? (item.metadata as Record<string, unknown>)
      : {};
  const label = item.label || item.itemType.replaceAll("_", " ");
  const url = typeof metadata.url === "string" && metadata.url.trim().length > 0 ? metadata.url : null;
  if (item.itemType === "url" && url) {
    onOpenTab(browserTab(url, label));
  }
}

/** Placeholder home body. E2 replaces this with the real HubHomeTab. */
function HubHomePlaceholder() {
  return (
    <div
      className="flex h-full w-full items-center justify-center p-6 text-center"
      data-testid="hub-home-placeholder"
    >
      <div className="max-w-xs">
        <p className="text-sm font-medium text-foreground">Inbox home</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Your attention and decision queue will render here.
        </p>
      </div>
    </div>
  );
}

/** Minimal generic body for notification tabs (rich body relocated from HubViewer in E2). */
function HubNotificationBody({ tab }: { tab: HubTab }) {
  return (
    <div className="h-full w-full overflow-auto p-6" data-testid="hub-notification-body">
      <h2 className="text-lg font-semibold leading-snug text-foreground">{tab.title}</h2>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        No dedicated viewer for this item yet. Open it from the list to review details.
      </p>
    </div>
  );
}

/**
 * Shown for tab kinds whose dedicated viewer is not wired yet, so the tab chrome
 * + panel still render. Never returns `null`.
 */
export function TabLoadingPlaceholder({ kind }: { kind?: HubTabKind }) {
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center"
      data-testid="hub-tab-loading-placeholder"
      role="status"
    >
      <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
      <div>
        <p className="text-sm font-medium text-foreground">Preparing viewer…</p>
        {kind ? (
          <p className="mt-1 text-xs text-muted-foreground">
            A dedicated <span className="font-mono">{kind}</span> viewer is coming soon.
          </p>
        ) : null}
      </div>
    </div>
  );
}
