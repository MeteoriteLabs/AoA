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

/** Cards in render order: prefs.order first, then registry order for the rest.
 *  Generic so the registry's richer item type (with a `render` fn) is preserved. */
export function orderCards<T extends CockpitCardDef>(registry: T[], order: string[]): T[] {
  const byId = new Map(registry.map((c) => [c.id, c]));
  return [
    ...order.map((id) => byId.get(id)).filter((c): c is T => !!c),
    ...registry.filter((c) => !order.includes(c.id)),
  ];
}

/** Cards that should MOUNT (ordered, not hidden, defaultOn). They self-report `active`
 *  and render null when empty. Order drives the DOM — single source of truth. */
export function mountableCards<T extends CockpitCardDef>(
  registry: T[],
  hidden: string[],
  order: string[],
): T[] {
  return orderCards(registry, order).filter((c) => !hidden.includes(c.id) && c.defaultOn);
}

/** Cards currently VISIBLE (mountable + has data) — drives the "All clear" decision.
 *  show-only-active: empty cards drop out (unless a future pin). */
export function selectVisibleCards(input: CockpitVisibilityInput): CockpitCardDef[] {
  const { registry, hidden, order, active } = input;
  return mountableCards(registry, hidden, order).filter((c) => active[c.id] === true);
}
