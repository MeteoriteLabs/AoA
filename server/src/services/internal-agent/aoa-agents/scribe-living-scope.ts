export interface ScribeItem {
  id: string;
  type: string;
  title: string;
  createdAt: string;
}

/** Task-type items → ordered Plan steps (creation order), linked to the item. */
export function buildPlanStepsFromItems(
  items: ScribeItem[],
): Array<{ title: string; linkedItemId: string }> {
  return [...items]
    .filter((i) => i.type === "task")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((i) => ({ title: i.title, linkedItemId: i.id }));
}

/** Readiness gate: finalize the living scope only when actually leaving
 *  'discuss' (→'scope') and there is something to finalize. */
export function shouldFinalizeScope(input: {
  fromPhase: string;
  toPhase: string;
  itemCount: number;
}): boolean {
  return input.fromPhase === "discuss" && input.toPhase === "scope" && input.itemCount > 0;
}
