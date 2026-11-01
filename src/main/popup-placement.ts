// Placement of styled popups (menus, switchers) relative to the element that opened them.
// Pure geometry, no Electron imports. Coordinates are window content pixels.

export type PopupPlacement = "below" | "above" | "right" | "left";
export type PopupRect = { x: number; y: number; width: number; height: number };

export type PopupGeometryInput = {
  /** Point used when no rect is known: top-left of the popup for "below". */
  anchor: { x: number; y: number };
  /** Bounding rect of the opening element; enables above/right placement and auto-flipping. */
  rect?: PopupRect | null;
  /** Preferred placement; it flips when the other side has clearly more room. */
  placement?: PopupPlacement;
  width: number;
  preferredHeight: number;
  contentWidth: number;
  contentHeight: number;
  /** Context-style popups are clamped inside the window instead of hanging from the anchor. */
  clampInside?: boolean;
  /** An area that stays free of popups (the native window controls drawn over the top-right corner on Windows). */
  avoid?: PopupRect | null;
};

export type PopupGeometry = {
  bounds: PopupRect;
  /** Which edge stays fixed when the popup content changes height. */
  fixedEdge: "top" | "bottom";
  /** y of the fixed edge. */
  edgeY: number;
  /** Lowest allowed top edge when a popup hanging from the bottom edge had to keep clear of `avoid`. */
  minTop?: number;
};

const MIN_HEIGHT = 180;
const GAP = 7;
const MARGIN = 4;

/** Moves a popup that would overlap `avoid` (horizontally and vertically) below it; no-op when it does not. */
export const keepClearOf = (geometry: PopupGeometry, avoid: PopupRect | null | undefined): PopupGeometry => {
  if (!avoid) return geometry;
  const { bounds } = geometry;
  const clearY = avoid.y + avoid.height;
  const overlapsX = bounds.x < avoid.x + avoid.width && bounds.x + bounds.width > avoid.x;
  if (!overlapsX || bounds.y >= clearY || bounds.y + bounds.height <= avoid.y) return geometry;
  if (geometry.fixedEdge === "top") {
    return { ...geometry, bounds: { ...bounds, y: clearY }, edgeY: clearY };
  }
  // Hanging from the bottom edge: the bottom stays, the popup becomes shorter.
  const bottom = bounds.y + bounds.height;
  const height = Math.max(MIN_HEIGHT, bottom - clearY);
  return { ...geometry, bounds: { ...bounds, y: bottom - height, height }, minTop: clearY };
};

export const computePopupGeometry = (input: PopupGeometryInput): PopupGeometry => keepClearOf(computeRawPopupGeometry(input), input.avoid);

const computeRawPopupGeometry = (input: PopupGeometryInput): PopupGeometry => {
  const { anchor, rect, width, preferredHeight, contentWidth, contentHeight } = input;
  const popupWidth = Math.min(width, Math.max(260, contentWidth - 16));

  if (input.clampInside) {
    const height = Math.min(preferredHeight, Math.max(MIN_HEIGHT, contentHeight - 8));
    const x = Math.max(MARGIN, Math.min(anchor.x, contentWidth - popupWidth - MARGIN));
    const y = Math.max(MARGIN, Math.min(anchor.y, contentHeight - height - MARGIN));
    return { bounds: { x: Math.round(x), y: Math.round(y), width: Math.round(popupWidth), height: Math.round(height) }, fixedEdge: "top", edgeY: Math.round(anchor.y) };
  }

  const x = Math.max(MARGIN, Math.min(anchor.x, contentWidth - popupWidth - MARGIN));
  let placement: PopupPlacement = input.placement ?? "below";

  if (!rect) {
    // Legacy behaviour: hang from the anchor point and shrink to the room below.
    const height = Math.min(preferredHeight, Math.max(MIN_HEIGHT, contentHeight - anchor.y - GAP));
    return { bounds: { x: Math.round(x), y: Math.round(anchor.y), width: Math.round(popupWidth), height: Math.round(height) }, fixedEdge: "top", edgeY: Math.round(anchor.y) };
  }

  const roomBelow = contentHeight - (rect.y + rect.height) - GAP;
  const roomAbove = rect.y - GAP;
  if (placement === "below" && preferredHeight > roomBelow && roomAbove > roomBelow) placement = "above";
  else if (placement === "above" && preferredHeight > roomAbove && roomBelow > roomAbove) placement = "below";

  if (placement === "right") {
    const height = Math.min(preferredHeight, Math.max(MIN_HEIGHT, contentHeight - 2 * MARGIN));
    const rightX = Math.max(MARGIN, Math.min(rect.x + rect.width + MARGIN, contentWidth - popupWidth - MARGIN));
    const y = Math.max(MARGIN, Math.min(rect.y, contentHeight - height - MARGIN));
    return { bounds: { x: Math.round(rightX), y: Math.round(y), width: Math.round(popupWidth), height: Math.round(height) }, fixedEdge: "top", edgeY: Math.round(y) };
  }

  if (placement === "left") {
    const height = Math.min(preferredHeight, Math.max(MIN_HEIGHT, contentHeight - 2 * MARGIN));
    const leftX = Math.max(MARGIN, Math.min(rect.x - popupWidth - MARGIN, contentWidth - popupWidth - MARGIN));
    const y = Math.max(MARGIN, Math.min(rect.y, contentHeight - height - MARGIN));
    return { bounds: { x: Math.round(leftX), y: Math.round(y), width: Math.round(popupWidth), height: Math.round(height) }, fixedEdge: "top", edgeY: Math.round(y) };
  }

  if (placement === "above") {
    const bottom = Math.round(rect.y - MARGIN);
    const height = Math.min(preferredHeight, Math.max(MIN_HEIGHT, bottom - GAP));
    return { bounds: { x: Math.round(x), y: Math.max(MARGIN, bottom - Math.round(height)), width: Math.round(popupWidth), height: Math.round(height) }, fixedEdge: "bottom", edgeY: bottom };
  }

  const top = Math.round(rect.y + rect.height);
  const height = Math.min(preferredHeight, Math.max(MIN_HEIGHT, contentHeight - top - GAP));
  return { bounds: { x: Math.round(x), y: top, width: Math.round(popupWidth), height: Math.round(height) }, fixedEdge: "top", edgeY: top };
};

/** New bounds after the popup content reported a different height (the fixed edge stays put). */
export const resizePopupBounds = (
  bounds: PopupRect,
  fixedEdge: "top" | "bottom",
  edgeY: number,
  requestedHeight: number,
  contentHeight: number,
  minTop: number = MARGIN,
): { bounds: PopupRect; heightLimited: boolean } => {
  const top = Math.max(MARGIN, minTop);
  const maximum = fixedEdge === "bottom"
    ? Math.max(MIN_HEIGHT, edgeY - Math.max(GAP, top))
    : Math.max(MIN_HEIGHT, contentHeight - edgeY - GAP);
  const height = Math.max(MIN_HEIGHT, Math.min(Math.ceil(requestedHeight), maximum));
  const y = fixedEdge === "bottom" ? Math.max(top, edgeY - height) : bounds.y;
  return { bounds: { ...bounds, y, height }, heightLimited: requestedHeight > maximum };
};

export type AnchoredPopupInput = {
  /** The button the popup hangs from (window content coordinates). */
  anchor: PopupRect;
  /** Same words electron-chrome-extensions uses: "bottom left" (default) hangs below, right-aligned to the button; "right" starts at the button's left edge; "top" opens above it. */
  alignment?: string;
  width: number;
  height: number;
  contentWidth: number;
  contentHeight: number;
  avoid?: PopupRect | null;
};

const ANCHORED_PADDING = 5;

/**
 * Bounds of an extension action popup hosted inside the window: placed like the library's own popup (below or above the
 * button), flipped when it does not fit on that side, then clamped into the window and kept clear of `avoid`.
 */
export const computeAnchoredPopupBounds = (input: AnchoredPopupInput): PopupRect => {
  const { anchor, contentWidth, contentHeight } = input;
  const width = Math.max(1, Math.min(Math.round(input.width), contentWidth - 2 * MARGIN));
  const height = Math.max(1, Math.min(Math.round(input.height), contentHeight - 2 * MARGIN));
  const alignment = input.alignment ?? "";
  const x = alignment.includes("right") ? anchor.x : anchor.x + anchor.width - width;
  const below = anchor.y + anchor.height + ANCHORED_PADDING;
  const above = anchor.y - height - ANCHORED_PADDING;
  let y = alignment.includes("top") ? above : below;
  if (y < MARGIN && below + height <= contentHeight - MARGIN) y = below;
  else if (y + height > contentHeight - MARGIN && above >= MARGIN) y = above;
  const bounds: PopupRect = {
    x: Math.round(Math.max(MARGIN, Math.min(x, contentWidth - width - MARGIN))),
    y: Math.round(Math.max(MARGIN, Math.min(y, contentHeight - height - MARGIN))),
    width,
    height,
  };
  return keepClearOf({ bounds, fixedEdge: "top", edgeY: bounds.y }, input.avoid).bounds;
};
