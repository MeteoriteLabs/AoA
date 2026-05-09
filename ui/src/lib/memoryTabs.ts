export interface MemoryTab {
  id: string;
  kind: "memory_item" | "asset";
  title: string;
}

export interface TabsState {
  tabs: MemoryTab[];
  activeId: string | null;
}

/** Two tabs are equal when both id AND kind match. */
function sameTab(a: MemoryTab, b: { id: string; kind: MemoryTab["kind"] }): boolean {
  return a.id === b.id && a.kind === b.kind;
}

/**
 * Open-or-activate: if a tab matching {id, kind} already exists, mark it
 * active. Otherwise append a new tab and mark IT active.
 */
export function openOrActivate(state: TabsState, tab: MemoryTab): TabsState {
  const existing = state.tabs.findIndex((t) => sameTab(t, tab));
  if (existing >= 0) {
    return { ...state, activeId: state.tabs[existing].id };
  }
  return { tabs: [...state.tabs, tab], activeId: tab.id };
}

/**
 * Close a tab. If the closed tab was active, activate the previous tab in the
 * list (or the new first tab if the closed one was the first). When the last
 * tab closes, activeId becomes null.
 */
export function closeTab(
  state: TabsState,
  id: string,
  kind: MemoryTab["kind"],
): TabsState {
  const idx = state.tabs.findIndex((t) => sameTab(t, { id, kind }));
  if (idx < 0) return state;

  const tabs = state.tabs.filter((_, i) => i !== idx);

  // If we didn't close the active tab, the active id is preserved.
  const wasActive = state.activeId === id && state.tabs[idx].kind === kind;
  if (!wasActive) {
    return { tabs, activeId: state.activeId };
  }

  if (tabs.length === 0) return { tabs, activeId: null };

  // Activate the previous tab (or the new first tab if we removed index 0).
  const newActiveIndex = idx > 0 ? idx - 1 : 0;
  return { tabs, activeId: tabs[newActiveIndex].id };
}
