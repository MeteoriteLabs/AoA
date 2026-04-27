const NESTING_KEY = "aoa:inbox:nestingEnabled";
const COLLAPSED_KEY = "aoa:inbox:collapsed:set";

const NESTING_CHANGE_EVENT = "inbox-nesting-change";

/** Whether parent-child nesting is currently enabled in the inbox. */
export function getInboxNestingEnabled(): boolean {
  try {
    return localStorage.getItem(NESTING_KEY) === "1";
  } catch {
    return false;
  }
}

/** Toggle nesting on/off and persist; emits a window event so listeners refresh. */
export function setInboxNestingEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(NESTING_KEY, enabled ? "1" : "0");
    window.dispatchEvent(new CustomEvent(NESTING_CHANGE_EVENT, { detail: { enabled } }));
  } catch {
    // localStorage unavailable (private mode, SSR) — silently no-op
  }
}

/** Subscribe to nesting toggle changes (returns an unsubscribe). */
export function subscribeInboxNestingChange(handler: (enabled: boolean) => void): () => void {
  function onEvent(e: Event) {
    if (e instanceof CustomEvent) handler(e.detail?.enabled === true);
  }
  window.addEventListener(NESTING_CHANGE_EVENT, onEvent as EventListener);
  return () => window.removeEventListener(NESTING_CHANGE_EVENT, onEvent as EventListener);
}

/** Read the set of collapsed parent-issue IDs from localStorage. */
export function getCollapsedSet(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

/** Toggle a parent ID's collapsed state and persist; returns the new set. */
export function toggleCollapsed(parentId: string): Set<string> {
  const set = getCollapsedSet();
  if (set.has(parentId)) {
    set.delete(parentId);
  } else {
    set.add(parentId);
  }
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set]));
  } catch {
    // ignore
  }
  return set;
}

/** Compute the visible ordered list of issue IDs given a parent-grouped tree. */
export function computeVisibleOrderedIds(
  topLevel: Array<{ id: string }>,
  childrenByParent: Map<string, Array<{ id: string }>>,
  collapsed: Set<string>,
): string[] {
  const out: string[] = [];
  for (const parent of topLevel) {
    out.push(parent.id);
    if (!collapsed.has(parent.id)) {
      const children = childrenByParent.get(parent.id) ?? [];
      for (const c of children) out.push(c.id);
    }
  }
  return out;
}
