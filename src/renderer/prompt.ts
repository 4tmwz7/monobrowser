type PromptLine = { text: string; style?: "strong" | "muted" | "warn" };

type PromptPayload = {
  id: number;
  title: string;
  lines: PromptLine[];
  fields?: { username: string; password: string };
  primary: string;
  secondary: string;
  danger?: boolean;
  focusFirst: boolean;
};

type PromptApi = {
  onShow: (callback: (payload: PromptPayload) => void) => () => void;
  submit: (id: number, result: { action: "primary" | "secondary"; username?: string; password?: string }) => void;
  reportHeight: (height: number) => void;
};

declare global {
  interface Window {
    promptApi: PromptApi;
  }
}

const wrap = document.getElementById("wrap") as HTMLDivElement;
const titleEl = document.getElementById("title") as HTMLDivElement;
const linesEl = document.getElementById("lines") as HTMLDivElement;
const form = document.getElementById("body") as HTMLFormElement;
const fieldsEl = document.getElementById("fields") as HTMLDivElement;
const userLabel = document.getElementById("user-label") as HTMLSpanElement;
const passLabel = document.getElementById("pass-label") as HTMLSpanElement;
const usernameInput = document.getElementById("username") as HTMLInputElement;
const passwordInput = document.getElementById("password") as HTMLInputElement;
const primaryButton = document.getElementById("primary") as HTMLButtonElement;
const secondaryButton = document.getElementById("secondary") as HTMLButtonElement;

let currentId = -1;
let hasFields = false;
let done = false;

const reportHeight = (): void => window.promptApi.reportHeight(Math.ceil(wrap.getBoundingClientRect().height));

const finish = (action: "primary" | "secondary"): void => {
  if (done) return;
  done = true;
  window.promptApi.submit(currentId, hasFields && action === "primary"
    ? { action, username: usernameInput.value, password: passwordInput.value }
    : { action });
  // Credentials never stay in the DOM after submitting.
  usernameInput.value = "";
  passwordInput.value = "";
};

const show = (payload: PromptPayload): void => {
  currentId = payload.id;
  done = false;
  hasFields = Boolean(payload.fields);
  titleEl.textContent = payload.title;
  linesEl.replaceChildren(...payload.lines.map((line) => {
    const el = document.createElement("div");
    el.className = `line${line.style ? ` ${line.style}` : ""}`;
    el.textContent = line.text;
    return el;
  }));
  linesEl.style.display = "grid";
  linesEl.style.gap = "6px";
  fieldsEl.hidden = !payload.fields;
  if (payload.fields) {
    userLabel.textContent = payload.fields.username;
    passLabel.textContent = payload.fields.password;
  }
  usernameInput.value = "";
  passwordInput.value = "";
  primaryButton.textContent = payload.primary;
  secondaryButton.textContent = payload.secondary;
  primaryButton.classList.toggle("danger", Boolean(payload.danger));
  reportHeight();
  if (payload.focusFirst) {
    (payload.fields ? usernameInput : secondaryButton).focus();
  }
};

form.addEventListener("submit", (event) => {
  event.preventDefault();
  finish("primary");
});
secondaryButton.addEventListener("click", () => finish("secondary"));
window.promptApi.onShow(show);
