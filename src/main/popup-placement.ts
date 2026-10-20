// Placement of styled popups (menus, switchers) relative to the element that opened them.
// Pure geometry, no Electron imports. Coordinates are window content pixels.

export type PopupPlacement = "below" | "above" | "right";
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
};

export type PopupGeometry = {
  bounds: PopupRect;
  /** Which edge stays fixed when the popup content changes height. */
  fixedEdge: "top" | "bottom";
  /** y of the fixed edge. */
  edgeY: number;
};

const MIN_HEIGHT = 180;
const GAP = 7;
const MARGIN = 4;

export const computePopupGeometry = (input: PopupGeometryInput): PopupGeometry => {
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
): { bounds: PopupRect; heightLimited: boolean } => {
  const maximum = fixedEdge === "bottom"
    ? Math.max(MIN_HEIGHT, edgeY - GAP)
    : Math.max(MIN_HEIGHT, contentHeight - edgeY - GAP);
  const height = Math.max(MIN_HEIGHT, Math.min(Math.ceil(requestedHeight), maximum));
  const y = fixedEdge === "bottom" ? Math.max(MARGIN, edgeY - height) : bounds.y;
  return { bounds: { ...bounds, y, height }, heightLimited: requestedHeight > maximum };
};
