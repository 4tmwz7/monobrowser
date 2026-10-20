type Rect = { x: number; y: number; width: number; height: number };
type FrameState = {
  mode: "split" | "drop" | "idle";
  width: number;
  height: number;
  left?: Rect;
  right?: Rect;
  divider?: Rect;
  active?: "left" | "right";
  dragging?: boolean;
  labels: { drop: string; reset: string };
};
type SplitFrameApi = {
  onState: (callback: (state: FrameState) => void) => () => void;
  dragStart: () => void;
  dragMove: (x: number) => void;
  dragEnd: () => void;
  drop: (zone: "left" | "right") => void;
  reset: () => void;
};
declare global {
  interface Window { splitFrameApi: SplitFrameApi }
}

const paneLeft = document.getElementById("pane-left") as HTMLDivElement;
const paneRight = document.getElementById("pane-right") as HTMLDivElement;
const divider = document.getElementById("divider") as HTMLDivElement;
const zone = document.getElementById("zone") as HTMLDivElement;
const zoneLabel = document.getElementById("zone-label") as HTMLSpanElement;

let current: FrameState | null = null;
let dragging = false;

const place = (element: HTMLElement, rect: Rect | undefined, grow: number): void => {
  if (!rect) { element.style.display = "none"; return; }
  element.style.display = "";
  element.style.left = `${rect.x - grow}px`;
  element.style.top = `${rect.y - grow}px`;
  element.style.width = `${rect.width + grow * 2}px`;
  element.style.height = `${rect.height + grow * 2}px`;
};

const render = (state: FrameState): void => {
  current = state;
  document.body.classList.toggle("drop", state.mode === "drop");
  document.body.classList.toggle("dragging", state.dragging === true || dragging);
  place(paneLeft, state.left, 2);
  place(paneRight, state.right, 2);
  paneLeft.classList.toggle("active", state.active === "left");
  paneRight.classList.toggle("active", state.active === "right");
  place(divider, state.divider, 0);
  divider.title = state.labels.reset;
  zoneLabel.textContent = state.labels.drop;
};

// Divider drag: main raises this view above the pages so pointer moves keep arriving even
// when the pointer is over a page; x is measured from the frame's left edge (= page area).
divider.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  try { divider.setPointerCapture(event.pointerId); } catch { /* not capturable */ }
  dragging = true;
  document.body.classList.add("dragging");
  window.splitFrameApi.dragStart();
});
divider.addEventListener("dblclick", () => window.splitFrameApi.reset());
let moveFrame: number | null = null;
let lastX = 0;
document.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  if (event.buttons === 0) { endDrag(); return; }
  lastX = event.clientX;
  if (moveFrame !== null) return;
  moveFrame = window.requestAnimationFrame(() => {
    moveFrame = null;
    if (dragging) window.splitFrameApi.dragMove(lastX);
  });
});
const endDrag = (): void => {
  if (!dragging) return;
  dragging = false;
  document.body.classList.remove("dragging");
  window.splitFrameApi.dragEnd();
};
document.addEventListener("pointerup", endDrag);
document.addEventListener("pointercancel", endDrag);
divider.addEventListener("lostpointercapture", endDrag);
window.addEventListener("blur", endDrag);

// Tab dropped on the left/right half of the page area.
const zoneFor = (event: DragEvent): "left" | "right" =>
  event.clientX < (current?.width ?? window.innerWidth) / 2 ? "left" : "right";
const showZone = (side: "left" | "right" | null): void => {
  zone.classList.toggle("on", side !== null);
  if (!side) return;
  const half = Math.round((current?.width ?? window.innerWidth) / 2);
  zone.style.left = side === "left" ? "6px" : `${half}px`;
  zone.style.width = `${half - 6}px`;
};
document.addEventListener("dragenter", (event) => {
  if (current?.mode !== "drop") return;
  event.preventDefault();
  showZone(zoneFor(event));
});
document.addEventListener("dragover", (event) => {
  if (current?.mode !== "drop") return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  showZone(zoneFor(event));
});
document.addEventListener("dragleave", (event) => {
  if (event.relatedTarget === null) showZone(null);
});
document.addEventListener("drop", (event) => {
  if (current?.mode !== "drop") return;
  event.preventDefault();
  const side = zoneFor(event);
  showZone(null);
  window.splitFrameApi.drop(side);
});

window.splitFrameApi.onState((state) => {
  if (state.mode !== "drop") showZone(null);
  render(state);
});
