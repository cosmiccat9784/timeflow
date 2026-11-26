/**
 * Timetable tab helpers — pure so the tab strip behaviour is testable.
 * Tabs are just timetable ids in display order plus the active id.
 */

export interface TabState {
  open: string[];
  activeId: string;
}

/**
 * Keep only ids that still exist, guarantee at least one tab, and make sure
 * the active tab is open (appending it when a caller switched without
 * touching the tab list).
 */
export function pruneTabs(open: string[], allIds: string[], activeId: string): TabState {
  const valid = open.filter((id, i) => allIds.includes(id) && open.indexOf(id) === i);
  const active = allIds.includes(activeId) ? activeId : valid[0] ?? allIds[0] ?? "";
  if (!active) return { open: [], activeId: "" };
  const list = valid.length ? valid : [active];
  if (!list.includes(active)) list.push(active);
  return { open: list, activeId: active };
}

/** Open a tab (no-op when already open) and focus it. */
export function openTab(state: TabState, id: string): TabState {
  if (state.open.includes(id)) return { ...state, activeId: id };
  return { open: [...state.open, id], activeId: id };
}

/**
 * Close a tab. Closing the active tab focuses its right neighbour, else its
 * left one. The last remaining tab cannot be closed.
 */
export function closeTab(state: TabState, id: string): TabState {
  const index = state.open.indexOf(id);
  if (index === -1 || state.open.length === 1) return state;
  const open = state.open.filter((x) => x !== id);
  if (state.activeId !== id) return { open, activeId: state.activeId };
  const next = open[Math.min(index, open.length - 1)] ?? open[0];
  return { open, activeId: next };
}

/** Cycle tabs with the keyboard (Ctrl+Tab / Ctrl+Shift+Tab). */
export function cycleTab(state: TabState, direction: 1 | -1): TabState {
  if (state.open.length < 2) return state;
  const i = state.open.indexOf(state.activeId);
  const next = (i + direction + state.open.length) % state.open.length;
  return { ...state, activeId: state.open[next] };
}

/** Reorder by drag: move `id` to the slot currently held by `beforeId`. */
export function moveTab(open: string[], id: string, beforeId: string): string[] {
  if (id === beforeId) return open;
  const from = open.indexOf(id);
  if (from === -1) return open;
  const rest = open.filter((x) => x !== id);
  const to = rest.indexOf(beforeId);
  if (to === -1) return open;
  rest.splice(to, 0, id);
  return rest;
}

/** Ids a "+" menu should offer: every timetable that is not already open. */
export function unopenedTimetables(allIds: string[], state: TabState): string[] {
  return allIds.filter((id) => !state.open.includes(id));
}
