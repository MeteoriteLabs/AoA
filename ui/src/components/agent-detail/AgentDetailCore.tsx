import type { Agent } from "@armyofagents/shared";
import type { PageTabItem } from "../PageTabBar";
import { Tabs } from "@/components/ui/tabs";
import { PageTabBar } from "../PageTabBar";
import { AgentIcon, AgentIconPicker } from "../AgentIconPicker";
import { roleLabels } from "../agent-config-primitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface AgentDetailCoreActionBar {
  show: boolean;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}

export interface AgentDetailCoreProps {
  agent: Agent;
  tabs: PageTabItem[];
  activeView: string;
  onViewChange: (v: string) => void;
  /** Worker-specific action buttons (invoke/pause/resume/more-menu) or AoA-specific actions */
  headerActions?: React.ReactNode;
  /** Floating save/cancel bar (for config/instructions dirty state) */
  actionBar?: AgentDetailCoreActionBar;
  urlRunId?: string | null;
  isMobile?: boolean;
  /** Callback when user picks a new icon */
  onIconChange?: (icon: string) => void;
  /** Render the content for the active tab */
  renderTab: (view: string) => React.ReactNode;
}

/**
 * AgentDetailCore – shared chrome for agent detail pages.
 *
 * Renders:
 *   - Agent header (icon picker, name, role/title)
 *   - Floating save/cancel bar (desktop + mobile)
 *   - Tab bar (PageTabBar inside Tabs)
 *   - Tab content via renderTab()
 *
 * All data fetching stays in the parent page (AgentDetail or AoaAgentDetail).
 */
export function AgentDetailCore({
  agent,
  tabs,
  activeView,
  onViewChange,
  headerActions,
  actionBar,
  urlRunId,
  isMobile = false,
  onIconChange,
  renderTab,
}: AgentDetailCoreProps) {
  const showActionBar = actionBar?.show ?? false;

  return (
    <div className={cn("space-y-6", isMobile && showActionBar && "pb-24")}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          {onIconChange ? (
            <AgentIconPicker
              value={agent.icon}
              onChange={onIconChange}
            >
              <button className="shrink-0 flex items-center justify-center h-12 w-12 rounded-lg bg-accent hover:bg-accent/80 transition-colors">
                <AgentIcon icon={agent.icon} className="h-6 w-6" />
              </button>
            </AgentIconPicker>
          ) : (
            <div className="shrink-0 flex items-center justify-center h-12 w-12 rounded-lg bg-accent">
              <AgentIcon icon={agent.icon} className="h-6 w-6" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-2xl font-bold truncate">{agent.name}</h1>
            <p className="text-sm text-muted-foreground truncate">
              {roleLabels[agent.role] ?? agent.role}
              {agent.title ? ` - ${agent.title}` : ""}
            </p>
          </div>
        </div>
        {headerActions && (
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {headerActions}
          </div>
        )}
      </div>

      {/* Floating Save/Cancel (desktop) */}
      {!isMobile && actionBar && (
        <div
          className={cn(
            "sticky top-6 z-10 float-right transition-opacity duration-150",
            showActionBar
              ? "opacity-100"
              : "opacity-0 pointer-events-none"
          )}
        >
          <div className="flex items-center gap-2 bg-background/90 backdrop-blur-sm border border-border rounded-lg px-3 py-1.5 shadow-lg">
            <Button
              variant="ghost"
              size="sm"
              onClick={actionBar.onCancel}
              disabled={actionBar.saving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={actionBar.onSave}
              disabled={actionBar.saving}
            >
              {actionBar.saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}

      {/* Mobile bottom Save/Cancel bar */}
      {isMobile && showActionBar && actionBar && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur-sm">
          <div
            className="flex items-center justify-end gap-2 px-3 py-2"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.5rem)" }}
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={actionBar.onCancel}
              disabled={actionBar.saving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={actionBar.onSave}
              disabled={actionBar.saving}
            >
              {actionBar.saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}

      {/* Tab navigation */}
      {!urlRunId && (
        <Tabs
          value={activeView}
          onValueChange={onViewChange}
        >
          <PageTabBar
            items={tabs}
            value={activeView}
            onValueChange={onViewChange}
          />
        </Tabs>
      )}

      {/* Tab content */}
      {renderTab(activeView)}
    </div>
  );
}
