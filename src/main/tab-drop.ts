// Pure logic of dropping a dragged tab on the tab strip (shared by the renderer bundle and the tests).
// No Electron or DOM imports.

export type DropRect = { left: number; top: number; right: number; bottom: number };
export type DropButton = { id: number; rect: DropRect };
export type TabDrop = { tabId: number; before: boolean };

/**
 * The tab nearest to the pointer and the side of it the pointer is on. `stacked` = a vertical list (compare the
 * vertical position), otherwise a row (compare the horizontal one). Ties go to the first button in order.
 */
export const nearestTabDrop = (buttons: readonly DropButton[], point: { x: number; y: number }, stacked: boolean): TabDrop | null => {
  let best: { button: DropButton; dist: number } | null = null;
  for (const button of buttons) {
    const { rect } = button;
    const dx = Math.max(rect.left - point.x, 0, point.x - rect.right);
    const dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom);
    const dist = dx * dx + dy * dy;
    if (!best || dist < best.dist) best = { button, dist };
  }
  if (!best) return null;
  const { rect } = best.button;
  const before = stacked ? point.y < rect.top + (rect.bottom - rect.top) / 2 : point.x < rect.left + (rect.right - rect.left) / 2;
  return { tabId: best.button.id, before };
};

/**
 * Where the dragged tab goes: the id of the tab it ends up in front of (null: the end of its group), or `undefined`
 * when the drop changes nothing (onto itself, or right where it already is). `groupIds` = the tabs of the dragged
 * tab's group (same pinned state) in their current order.
 */
export const planTabMove = (groupIds: readonly number[], draggedId: number, drop: TabDrop | null): { beforeId: number | null } | undefined => {
  if (!drop || drop.tabId === draggedId || !groupIds.includes(draggedId)) return undefined;
  const index = groupIds.indexOf(drop.tabId);
  if (index < 0) return undefined;
  const beforeId = drop.before ? drop.tabId : (groupIds[index + 1] ?? null);
  if (beforeId === draggedId) return undefined;
  // Already in front of that tab (or already last for the end): nothing to do.
  if (beforeId === (groupIds[groupIds.indexOf(draggedId) + 1] ?? null)) return undefined;
  return { beforeId };
};

/** The order that results from `planTabMove` (what the main process produces for the group). */
export const applyTabMove = (groupIds: readonly number[], draggedId: number, beforeId: number | null): number[] => {
  const rest = groupIds.filter((id) => id !== draggedId);
  const at = beforeId === null ? rest.length : rest.indexOf(beforeId);
  rest.splice(at < 0 ? rest.length : at, 0, draggedId);
  return rest;
};

export type DragEndPoint = { clientX: number; clientY: number; screenX: number; screenY: number };

/**
 * The coordinates of a `dragend` event are only meaningful when the platform filled them in: some report 0,0 for a drag
 * that ended outside the window or without a drop. null = do not trust them.
 */
export const trustedDragEndPoint = (event: DragEndPoint): { x: number; y: number } | null =>
  event.clientX === 0 && event.clientY === 0 && event.screenX === 0 && event.screenY === 0 ? null : { x: event.clientX, y: event.clientY };

export const rectContainsPoint = (rect: DropRect, point: { x: number; y: number }): boolean =>
  point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
