// Pure layout math for split view (two tabs side by side) and compact mode
// (chrome hidden, revealed as an overlay). No Electron imports so it is unit-testable.

export type Rect = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };

/** Space around/between the panes: the active pane's accent border is drawn in it. */
export const SPLIT_FRAME_PAD = 3;
export const SPLIT_GAP = 8;
export const SPLIT_MIN_PANE = 220;
export const DEFAULT_SPLIT_RATIO = 0.5;
export const MIN_SPLIT_RATIO = 0.15;
export const MAX_SPLIT_RATIO = 0.85;

export type SplitSide = "left" | "right";

const usableWidth = (area: Rect): number => Math.max(0, area.width - SPLIT_FRAME_PAD * 2 - SPLIT_GAP);

/** Clamps a (possibly untrusted) ratio so that both panes keep a sensible minimum width. */
export const clampSplitRatio = (ratio: unknown, areaWidth: number = Number.POSITIVE_INFINITY): number => {
  let value = typeof ratio === "number" && Number.isFinite(ratio) ? ratio : DEFAULT_SPLIT_RATIO;
  const usable = Math.max(0, areaWidth - SPLIT_FRAME_PAD * 2 - SPLIT_GAP);
  let min = MIN_SPLIT_RATIO;
  let max = MAX_SPLIT_RATIO;
  if (Number.isFinite(usable) && usable > 0) {
    // Never demand more than half of the usable width per pane.
    const minByWidth = Math.min(0.5, SPLIT_MIN_PANE / usable);
    min = Math.max(min, minByWidth);
    max = Math.min(max, 1 - minByWidth);
  }
  value = Math.min(max, Math.max(min, value));
  return Math.round(value * 10000) / 10000;
};

export type SplitLayout = {
  ratio: number;
  left: Rect;
  right: Rect;
  /** The gap between the panes (the draggable divider). */
  divider: Rect;
};

/** Lays out two panes inside the page area (same coordinate space as `area`). */
export const computeSplitLayout = (area: Rect, ratio: number): SplitLayout => {
  const clamped = clampSplitRatio(ratio, area.width);
  const usable = usableWidth(area);
  const leftWidth = Math.round(usable * clamped);
  const height = Math.max(0, area.height - SPLIT_FRAME_PAD * 2);
  const top = area.y + SPLIT_FRAME_PAD;
  const leftX = area.x + SPLIT_FRAME_PAD;
  const left = { x: leftX, y: top, width: leftWidth, height };
  const divider = { x: leftX + leftWidth, y: top, width: SPLIT_GAP, height };
  const right = { x: divider.x + SPLIT_GAP, y: top, width: Math.max(0, usable - leftWidth), height };
  return { ratio: clamped, left, right, divider };
};

/** Ratio for a pointer x measured from the area's left edge (center of the divider follows the pointer). */
export const ratioFromPointer = (area: Rect, pointerX: number): number => {
  const usable = usableWidth(area);
  if (usable <= 0) return DEFAULT_SPLIT_RATIO;
  return clampSplitRatio((pointerX - SPLIT_FRAME_PAD - SPLIT_GAP / 2) / usable, area.width);
};

export const rectContains = (rect: Rect, point: Point): boolean =>
  point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height;

/** Which half of the page area a drag point is over (drop zone for "drop a tab to split"); null outside. */
export const dropZoneForPoint = (area: Rect, point: Point): SplitSide | null => {
  if (!rectContains(area, point)) return null;
  return point.x < area.x + area.width / 2 ? "left" : "right";
};

/** Translates a rect into another origin (e.g. window coordinates -> frame view coordinates). */
export const offsetRect = (rect: Rect, dx: number, dy: number): Rect => ({ ...rect, x: rect.x + dx, y: rect.y + dy });

/** The rect an accent border drawn around a pane should occupy (pane rect grown by 2px, inside the frame pad). */
export const paneBorderRect = (pane: Rect): Rect => ({ x: pane.x - 2, y: pane.y - 2, width: pane.width + 4, height: pane.height + 4 });
