import { Bell, Home, Inbox, Lightbulb, Mail } from "lucide-react";
import type { HubLane } from "@armyofagents/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type HubRailLane = HubLane | null;

interface HubRailProps {
  activeLane: HubRailLane;
  counts: { open: number; unread: number };
  visibleLanes?: HubLane[];
  onLaneChange: (lane: HubRailLane) => void;
}

const lanes: Array<{
  lane: HubRailLane;
  label: string;
  icon: typeof Home;
}> = [
  { lane: null, label: "Home", icon: Home },
  { lane: "waiting_on_you", label: "Waiting on you", icon: Inbox },
  { lane: "notifications", label: "Notifications", icon: Bell },
  { lane: "suggestions", label: "Suggestions", icon: Lightbulb },
];

export function HubRail({ activeLane, counts, visibleLanes, onLaneChange }: HubRailProps) {
  const visibleRailLanes = lanes.filter(
    ({ lane }) => lane === null || !visibleLanes || visibleLanes.includes(lane),
  );

  return (
    <nav
      aria-label="Hub lanes"
      className="flex h-full w-16 shrink-0 flex-col items-center gap-2 rounded-xl border border-border bg-background py-3 shadow-sm"
    >
      {visibleRailLanes.map(({ lane, label, icon: Icon }) => {
        const active = activeLane === lane;
        return (
          <Button
            key={label}
            type="button"
            variant={active ? "secondary" : "ghost"}
            size="icon"
            aria-label={label}
            aria-pressed={active}
            title={label}
            onClick={() => onLaneChange(lane)}
            className={cn("relative", active && "border-brand text-brand")}
          >
            <Icon className="size-4" aria-hidden="true" />
            {lane === "waiting_on_you" && counts.open > 0 ? (
              <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-brand px-1 text-[10px] leading-4 text-white">
                {counts.open}
              </span>
            ) : null}
          </Button>
        );
      })}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Mail reserved"
        title="Mail reserved"
        disabled
        className="mt-auto"
      >
        <Mail className="size-4" aria-hidden="true" />
      </Button>
    </nav>
  );
}
