import { useCallback, useState, type ReactElement } from "react";
import { ChevronsRight, LayoutDashboard, Settings2 } from "lucide-react";
import { cn } from "../../../lib/utils";
import { COMMANDER_PANEL_CARD } from "../commanderChrome";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";
import { useCommanderCockpitPrefs } from "../useCommanderCockpitPrefs";
import { selectVisibleCards, type CockpitCardDef } from "./cockpitCardModel";
import { CockpitRunningCard } from "./CockpitRunningCard";

// ---------------------------------------------------------------------------
// Card registry (3a: one card; 3b/3c push more)
// ---------------------------------------------------------------------------

type CockpitCardRenderDef = CockpitCardDef & {
  render: (p: { companyId: string; onActiveChange: (a: boolean) => void }) => ReactElement;
};

export const COCKPIT_REGISTRY: CockpitCardRenderDef[] = [
  {
    id: "running",
    title: "Running now",
    defaultOn: true,
    render: (p) => <CockpitRunningCard {...p} />,
  },
];

// ---------------------------------------------------------------------------
// Config popover — show/hide cards
// ---------------------------------------------------------------------------

function CockpitConfigPopover({
  prefs,
  setPrefs,
  registry,
}: {
  prefs: ReturnType<typeof useCommanderCockpitPrefs>[0];
  setPrefs: ReturnType<typeof useCommanderCockpitPrefs>[1];
  registry: CockpitCardDef[];
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Configure cockpit cards"
          title="Configure cockpit cards"
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        >
          <Settings2 className="size-3.5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="p-2">
        <p className="mb-1.5 px-1 text-[11px] font-medium text-muted-foreground">Show cards</p>
        {registry.map((card) => {
          const isHidden = prefs.hidden.includes(card.id);
          return (
            <label
              key={card.id}
              className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 text-xs hover:bg-muted/50"
            >
              <input
                type="checkbox"
                className="accent-brand"
                checked={!isHidden}
                onChange={() => {
                  const next = isHidden
                    ? prefs.hidden.filter((id) => id !== card.id)
                    : [...prefs.hidden, card.id];
                  setPrefs({ ...prefs, hidden: next });
                }}
              />
              {card.title}
            </label>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Full panel (expanded state)
// ---------------------------------------------------------------------------

export function CommanderCockpitPanel({
  companyId,
  onCollapse,
}: {
  companyId: string;
  onCollapse: () => void;
}) {
  const [prefs, setPrefs] = useCommanderCockpitPrefs();
  const [active, setActive] = useState<Record<string, boolean>>({});

  const onActiveChange = useCallback(
    (id: string, a: boolean) =>
      setActive((m) => (m[id] === a ? m : { ...m, [id]: a })),
    [],
  );

  const visible = selectVisibleCards({
    registry: COCKPIT_REGISTRY,
    hidden: prefs.hidden,
    order: prefs.order,
    active,
  });

  return (
    <div
      data-testid="commander-cockpit-panel"
      className={cn("relative flex h-full min-w-0 flex-1 flex-col", COMMANDER_PANEL_CARD)}
    >
      <header className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2 text-xs font-medium">
        <span>Cockpit</span>
        <div className="ml-auto flex items-center gap-0.5">
          <CockpitConfigPopover prefs={prefs} setPrefs={setPrefs} registry={COCKPIT_REGISTRY} />
          <button
            type="button"
            aria-label="Collapse cockpit"
            title="Collapse cockpit"
            onClick={onCollapse}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          >
            <ChevronsRight className="size-3.5" aria-hidden />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {/* All non-hidden defaultOn registry cards mount so each can self-report
            active. Cards return null when they have no data (show-only-active). */}
        {COCKPIT_REGISTRY.filter((c) => !prefs.hidden.includes(c.id) && c.defaultOn).map((c) => (
          <div key={c.id} className="mb-2 last:mb-0">
            {c.render({
              companyId,
              onActiveChange: (a) => onActiveChange(c.id, a),
            })}
          </div>
        ))}

        {visible.length === 0 && (
          <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
            All clear — nothing needs you right now.
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Semi-rail (collapsed state)
// ---------------------------------------------------------------------------

export function CommanderCockpitRail({
  badge,
  onExpand,
}: {
  badge: number;
  onExpand: () => void;
}) {
  return (
    <div
      data-testid="commander-cockpit-rail"
      className={cn(
        "flex h-full w-9 shrink-0 flex-col items-center gap-1 py-2",
        COMMANDER_PANEL_CARD,
      )}
    >
      <button
        type="button"
        aria-label="Expand cockpit"
        title="Expand cockpit"
        onClick={onExpand}
        className="relative flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      >
        <LayoutDashboard className="size-3.5" aria-hidden />
        {badge > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-white">
            {badge}
          </span>
        )}
      </button>
    </div>
  );
}
