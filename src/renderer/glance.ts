type GlanceViewState = {
  title: string;
  url: string;
  loading: boolean;
  frame: { x: number; y: number; width: number; height: number };
  barHeight: number;
  labels: { close: string; expand: string; background: string; loading: string };
};

type GlanceApi = {
  getGlanceState: () => Promise<GlanceViewState | null>;
  onGlanceState: (callback: (state: GlanceViewState) => void) => () => void;
  closeGlance: () => Promise<boolean>;
  expandGlance: () => Promise<boolean>;
  openGlanceInBackground: () => Promise<boolean>;
};

declare global {
  interface Window {
    browserApi: GlanceApi;
  }
}

const frame = document.getElementById("frame") as HTMLDivElement;
const backdrop = document.getElementById("backdrop") as HTMLDivElement;
const titleEl = document.getElementById("title") as HTMLSpanElement;
const urlEl = document.getElementById("url") as HTMLSpanElement;
const closeButton = document.getElementById("glance-close") as HTMLButtonElement;
const expandButton = document.getElementById("glance-expand") as HTMLButtonElement;
const backgroundButton = document.getElementById("glance-background") as HTMLButtonElement;

const apply = (state: GlanceViewState | null): void => {
  if (!state) return;
  frame.hidden = false;
  frame.style.left = `${state.frame.x}px`;
  frame.style.top = `${state.frame.y}px`;
  frame.style.width = `${state.frame.width}px`;
  frame.style.height = `${state.frame.height}px`;
  const title = state.title || state.url;
  titleEl.textContent = state.loading ? `${state.labels.loading} ${title}` : title;
  urlEl.textContent = state.url;
  closeButton.title = state.labels.close;
  closeButton.setAttribute("aria-label", state.labels.close);
  expandButton.textContent = state.labels.expand;
  backgroundButton.textContent = state.labels.background;
};

closeButton.addEventListener("click", () => void window.browserApi.closeGlance());
backdrop.addEventListener("click", () => void window.browserApi.closeGlance());
expandButton.addEventListener("click", () => void window.browserApi.expandGlance());
backgroundButton.addEventListener("click", () => void window.browserApi.openGlanceInBackground());
window.browserApi.onGlanceState(apply);
void window.browserApi.getGlanceState().then(apply);
