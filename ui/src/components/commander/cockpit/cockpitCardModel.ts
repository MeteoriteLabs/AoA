// ui/src/components/commander/cockpit/cockpitCardModel.ts
// Pure model — no React, no side effects, safe to unit-test in isolation.

export interface CockpitCardDef {
  id: string;
  title: string;
  /** lucide icon name handled by the component; kept out of the pure model */
  defaultOn: boolean;
}

export interface CockpitVisibilityInput {
  registry: CockpitCardDef[];
  hidden: string[];          // prefs.hidden
  order: string[];           // prefs.order
  active: Record<string, boolean>; // cardId -> has data
}

/** Cards to render, in order. show-only-active: drop empty cards (unless a future pin). */
export function selectVisibleCards(input: CockpitVisibilityInput): CockpitCardDef[] {
  const { registry, hidden, order, active } = input;
  const byId = new Map(registry.map((c) => [c.id, c]));
  const ordered = [
    ...order.map((id) => byId.get(id)).filter((c): c is CockpitCardDef => !!c),
    ...registry.filter((c) => !order.includes(c.id)),
  ];
  return ordered.filter((c) => !hidden.includes(c.id) && c.defaultOn && active[c.id] === true);
}
