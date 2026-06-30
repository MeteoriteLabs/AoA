import type { HubItemListRow } from "@/api/hub-items";
import type { HubLane } from "@armyofagents/shared";
import { Button } from "@/components/ui/button";

interface HubHomeProps {
  counts: { open: number; unread: number };
  items: HubItemListRow[];
  visibleLanes?: HubLane[];
  showAutopilotEntry?: boolean;
  onLaneChange: (lane: HubLane) => void;
}

export function HubHome({
  counts,
  items,
  visibleLanes,
  showAutopilotEntry = true,
  onLaneChange,
}: HubHomeProps) {
  const topItem = items[0] ?? null;
  const canShowLane = (lane: HubLane) => !visibleLanes || visibleLanes.includes(lane);
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
      <div className="grid grid-cols-2 gap-3">
        <div className="border-b border-border pb-3">
          <div className="text-xs uppercase text-muted-foreground">Open</div>
          <div className="mt-1 text-2xl font-semibold">{counts.open}</div>
        </div>
        <div className="border-b border-border pb-3">
          <div className="text-xs uppercase text-muted-foreground">Unread</div>
          <div className="mt-1 text-2xl font-semibold">{counts.unread}</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {canShowLane("waiting_on_you") ? (
          <Button type="button" variant="secondary" onClick={() => onLaneChange("waiting_on_you")}>
            Waiting on you
          </Button>
        ) : null}
        {canShowLane("notifications") ? (
          <Button type="button" variant="secondary" onClick={() => onLaneChange("notifications")}>
            Notifications
          </Button>
        ) : null}
        {canShowLane("suggestions") ? (
          <Button type="button" variant="secondary" onClick={() => onLaneChange("suggestions")}>
            Suggestions
          </Button>
        ) : null}
      </div>
      <div className="border-t border-border pt-4">
        <div className="text-sm font-medium">Needs you most</div>
        <div className="mt-2 text-sm text-muted-foreground">
          {topItem ? topItem.title : "Nothing needs attention right now."}
        </div>
      </div>
      {showAutopilotEntry ? (
        <div className="mt-auto border-t border-border pt-4">
          <div className="text-sm font-medium">Autopilot</div>
          <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
            <span>Manual review</span>
            <span className="rounded border border-border px-2 py-1 text-xs">Preview</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
