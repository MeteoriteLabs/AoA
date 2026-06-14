import { useQuery } from "@tanstack/react-query";
import { ChevronsRight, LayoutDashboard, Settings2 } from "lucide-react";
import type { CockpitData } from "@armyofagents/shared";
import { cockpitApi } from "../../../api/cockpit";
import { queryKeys } from "../../../lib/queryKeys";
import { cn } from "../../../lib/utils";
import { COMMANDER_PANEL_CARD } from "../commanderChrome";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";
import { useCommanderCockpitPrefs } from "../useCommanderCockpitPrefs";
import {
  mountableCards,
  selectVisibleCards,
  type CockpitCardDef,
} from "./cockpitCardModel";
import { CockpitRunningCard } from "./CockpitRunningCard";
import { CockpitReviewCard } from "./CockpitReviewCard";
import { CockpitMyTasksCard } from "./CockpitMyTasksCard";
import { CockpitTodayCard } from "./CockpitTodayCard";
import { CockpitDiscussionsCard } from "./CockpitDiscussionsCard";
import { CockpitApprovalsCard } from "./CockpitApprovalsCard";

// ---------------------------------------------------------------------------
// Interaction callbacks type
// ---------------------------------------------------------------------------

export interface CockpitInteractions {
  onOpenTask?: (issueId: string, title: string) => void;
  onAsk?: (text: string) => void;
  onOpenFullPage?: (href: string) => void;
}

// ---------------------------------------------------------------------------
// Empty cockpit data (used while loading / on error)
// ---------------------------------------------------------------------------

const EMPTY_DATA: CockpitData = {
  running: [],
  review: [],
  myTasks: [],
  today: { reminders: [], dueTasks: [] },
  discussions: [],
  // Phase 3c: approvals required by CockpitData type
  approvals: [],
  // Phase 3d: pinned required by CockpitData type
  pinned: [],
};

// ---------------------------------------------------------------------------
// Card registry — 3b: 5 cards. Cards are PRESENTATIONAL; data comes from
// the shared batched /cockpit query, not per-card fetches.
// ---------------------------------------------------------------------------

export interface CockpitCardRenderDef extends CockpitCardDef {
  isActive: (data: CockpitData) => boolean;
  /** Phase 3c: companyId threaded through so cards that need per-source API calls
   * (e.g. CockpitApprovalsCard) can dispatch correctly without a separate context. */
  render: (props: { data: CockpitData; companyId: string } & CockpitInteractions) => React.ReactElement | null;
}

export const COCKPIT_REGISTRY: CockpitCardRenderDef[] = [
  {
    id: "running",
    title: "Running now",
    defaultOn: true,
    isActive: (d) => d.running.length > 0,
    render: ({ data, onOpenTask, onAsk }) => (
      <CockpitRunningCard runs={data.running} onOpenTask={onOpenTask} onAsk={onAsk} />
    ),
  },
  {
    id: "review",
    title: "Review",
    defaultOn: true,
    isActive: (d) => d.review.length > 0,
    render: ({ data, onOpenTask, onAsk }) => (
      <CockpitReviewCard items={data.review} onOpenTask={onOpenTask} onAsk={onAsk} />
    ),
  },
  {
    id: "myTasks",
    title: "My tasks",
    defaultOn: true,
    isActive: (d) => d.myTasks.length > 0,
    render: ({ data, onOpenTask, onAsk }) => (
      <CockpitMyTasksCard items={data.myTasks} onOpenTask={onOpenTask} onAsk={onAsk} />
    ),
  },
  {
    id: "today",
    title: "Today",
    defaultOn: true,
    isActive: (d) => d.today.reminders.length > 0 || d.today.dueTasks.length > 0,
    render: ({ data, onOpenTask, onAsk }) => (
      <CockpitTodayCard
        reminders={data.today.reminders}
        dueTasks={data.today.dueTasks}
        onOpenTask={onOpenTask}
        onAsk={onAsk}
      />
    ),
  },
  {
    id: "discussions",
    title: "Discussions",
    defaultOn: true,
    isActive: (d) => d.discussions.length > 0,
    render: ({ data, onOpenFullPage, onAsk }) => (
      <CockpitDiscussionsCard items={data.discussions} onOpenFullPage={onOpenFullPage} onAsk={onAsk} />
    ),
  },
  // Phase 3c: unified approvals queue (founder-only; server returns [] for non-founders)
  {
    id: "approvals",
    title: "Approvals",
    defaultOn: true,
    isActive: (d) => d.approvals.length > 0,
    render: ({ data, companyId, onOpenFullPage, onAsk }) => (
      <CockpitApprovalsCard
        items={data.approvals}
        companyId={companyId}
        onOpenFullPage={onOpenFullPage}
        onAsk={onAsk}
      />
    ),
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
  onOpenTask,
  onAsk,
  onOpenFullPage,
}: {
  companyId: string;
  onCollapse: () => void;
} & CockpitInteractions) {
  const [prefs, setPrefs] = useCommanderCockpitPrefs();

  // ONE batched query. LiveEvents (LiveUpdatesProvider) invalidate this key for
  // instant updates; the modest refetchInterval is a belt-and-suspenders fallback
  // for heartbeat/crew runs between events.
  const { data } = useQuery({
    queryKey: queryKeys.cockpit(companyId),
    queryFn: () => cockpitApi.get(companyId),
    enabled: !!companyId,
    refetchInterval: 8000,
  });

  const cockpitData = data ?? EMPTY_DATA;

  // Active map derived from the registry's own isActive predicates — single source of
  // truth (also feeds the card-render gate), so no separate hardcoded map to drift.
  const active = Object.fromEntries(
    COCKPIT_REGISTRY.map((c) => [c.id, c.isActive(cockpitData)]),
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
        {/* Mountable cards (ordered by prefs.order, not hidden, defaultOn). Cards
            are now PRESENTATIONAL — active is derived from the shared batched data,
            not from per-card self-reporting. */}
        {mountableCards(COCKPIT_REGISTRY, prefs.hidden, prefs.order).map((c) => (
          <div key={c.id} className="mb-2 last:mb-0">
            {/* Phase 3c: companyId threaded so cards like CockpitApprovalsCard can call per-source APIs. */}
            {c.render({ data: cockpitData, companyId, onOpenTask, onAsk, onOpenFullPage })}
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
