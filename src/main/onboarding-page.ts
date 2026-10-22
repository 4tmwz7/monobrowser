// First-run onboarding page (monobrowser://onboarding): a polished 5-step welcome flow.
// Pure module (no Electron): HTML is composed from data passed by the main process; the client
// script talks to the trusted preload bridge (window.browserApi) and applies every choice live.

import { ONBOARDING_STEPS, isLastStep, nextStep, onboardingKeyAction, prevStep } from "./onboarding.js";
import { INTERACTION_VARS_MB_CSS } from "./interaction-css.js";

export type OnboardingLanguage = "pl" | "en";

export type OnboardingPresetData = { id: string; name: string; colors: Record<string, string> };

export type RenderOnboardingOptions = {
  language: OnboardingLanguage;
  step: number;
  presets: readonly OnboardingPresetData[];
  defaultColors: Record<string, string>;
  fontDataUrl?: string;
};

const COPY = {
  pl: {
    title: "MonoBrowser — Witaj", step: "Krok", of: "z", skip: "Pomiń", back: "Wstecz", next: "Dalej", start: "Zacznij przeglądać",
    welcomePitch: "Minimalistyczna przeglądarka w stylu mono. Kilka szybkich ustawień i gotowe.", language: "Język", languageHint: "Zmiana działa od razu.",
    lookHeading: "Wygląd", lookText: "Wybierz motyw. Podgląd stosuje się natychmiast w całej przeglądarce.", themeDefault: "Domyślny", themeDefaultHint: "jasny lub ciemny jak system",
    animations: "Animacje interfejsu", animationsHint: "Delikatne przejścia i efekty najechania.",
    layoutHeading: "Układ", layoutText: "Gdzie mają być karty i pasek adresu?", horizontal: "Pasek poziomy", horizontalHint: "Kompaktowy pasek na górze", vertical: "Panel boczny", verticalHint: "Karty w pionie po lewej",
    compact: "Tryb kompaktowy", compactHint: "Chowa pasek i pokazuje go po najechaniu na krawędź ekranu (Ctrl+Shift+C).",
    spaces: "Przestrzenie to osobne zestawy kart (jak w Arc/Zen). Dodasz je i przełączysz później w menu lub palecie poleceń.",
    privacyHeading: "Prywatność i wyszukiwanie", privacyText: "Wszystko zmienisz później w Ustawieniach.", blocking: "Blokowanie treści", blockingHint: "Wbudowana ochrona przed reklamami i śledzeniem.",
    glance: "Glance (podgląd linków)", glanceHint: "Otwiera link w szybkim podglądzie bez opuszczania strony.", trigger: "Wyzwalacz", triggers: { alt: "Alt + klik", ctrl: "Ctrl + klik", shift: "Shift + klik", longpress: "Długie przytrzymanie" },
    search: "Wyszukiwarka", searchMore: "Własny adres wyszukiwarki ustawisz w Ustawieniach.",
    doneHeading: "Gotowe", doneText: "Kilka skrótów na start:", tips: [["Ctrl+K", "paleta poleceń"], ["Ctrl+T", "nowa karta"], ["Alt + klik", "Glance na linku"], ["Ctrl+Shift+N", "karta prywatna"]],
    reopen: "Ekran powitalny możesz otworzyć ponownie z palety poleceń (Ctrl+K).", glanceTipOff: "wyłączone",
  },
  en: {
    title: "MonoBrowser — Welcome", step: "Step", of: "of", skip: "Skip", back: "Back", next: "Next", start: "Start browsing",
    welcomePitch: "A minimalist monochrome browser. A few quick choices and you are set.", language: "Language", languageHint: "Applies immediately.",
    lookHeading: "Look", lookText: "Pick a theme. The preview applies instantly across the whole browser.", themeDefault: "Default", themeDefaultHint: "light or dark like the system",
    animations: "Interface animations", animationsHint: "Subtle transitions and hover effects.",
    layoutHeading: "Layout", layoutText: "Where should tabs and the address bar live?", horizontal: "Horizontal bar", horizontalHint: "Compact bar on top", vertical: "Vertical sidebar", verticalHint: "Tabs stacked on the left",
    compact: "Compact mode", compactHint: "Hides the bar and reveals it when you touch the screen edge (Ctrl+Shift+C).",
    spaces: "Spaces are separate sets of tabs (like Arc/Zen). Add and switch them later from the menu or the command palette.",
    privacyHeading: "Privacy & search", privacyText: "You can change all of this later in Settings.", blocking: "Content blocking", blockingHint: "Built-in protection against ads and trackers.",
    glance: "Glance (link preview)", glanceHint: "Opens a link in a quick preview without leaving the page.", trigger: "Trigger", triggers: { alt: "Alt + click", ctrl: "Ctrl + click", shift: "Shift + click", longpress: "Long press" },
    search: "Search engine", searchMore: "A custom search URL can be set in Settings.",
    doneHeading: "All set", doneText: "A few shortcuts to start with:", tips: [["Ctrl+K", "command palette"], ["Ctrl+T", "new tab"], ["Alt + click", "Glance on a link"], ["Ctrl+Shift+N", "private tab"]],
    reopen: "You can reopen this welcome screen from the command palette (Ctrl+K).", glanceTipOff: "turned off",
  },
} as const;

const safeJson = (value: unknown): string => JSON.stringify(value).replace(/</g, "\\u003c").replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);

export const renderOnboardingPageHtml = (options: RenderOnboardingOptions): string => {
  const { language, presets, defaultColors, fontDataUrl = "" } = options;
  const copy = COPY[language];
  const step = Math.min(ONBOARDING_STEPS.length - 1, Math.max(0, Math.trunc(options.step) || 0));
  const fontFace = fontDataUrl ? `@font-face{font-family:"Bebas Neue";src:url("${fontDataUrl}") format("truetype");font-weight:400;font-display:block}` : "";
  const data = safeJson({ language, step, steps: ONBOARDING_STEPS, presets, defaultColors, copy });
  // Self-contained reducer helpers are shared with the unit-tested module.
  const shared = [nextStep, prevStep, isLastStep, onboardingKeyAction].map((fn) => `const ${fn.name}=${fn.toString()};`).join("");

  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; img-src data:">
<title>${copy.title}</title>
<style>
${fontFace}
:root{font-family:ui-monospace,"Cascadia Mono","Courier New",monospace;${INTERACTION_VARS_MB_CSS}}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{display:flex;flex-direction:column;background:var(--mb-bg,#f0efe9);color:var(--mb-fg,#0a0a0a);overflow:hidden}
.top{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;padding:14px 22px;border-bottom:2px solid var(--mb-border,#b3b2ab);background:var(--mb-surface,#e4e3dc);font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}
.top .muted{color:var(--mb-muted,#5c5b57)}
main{flex:1 1 auto;overflow:auto;display:flex;justify-content:center;padding:28px 22px}
.stage{width:100%;max-width:760px;margin:auto 0}
.panel{display:grid;gap:18px;align-content:start}
.panel[hidden]{display:none}
.brand{margin:0;font-family:"Bebas Neue",Impact,"Arial Narrow",sans-serif;font-weight:400;text-transform:uppercase;line-height:.82;font-size:clamp(64px,13vw,140px);letter-spacing:-1px}
.brand span{color:var(--mb-muted,#5c5b57)}
h1.h{margin:0;font-family:"Bebas Neue",Impact,"Arial Narrow",sans-serif;font-weight:400;text-transform:uppercase;font-size:44px;line-height:.9}
p{margin:0;font-size:13px;line-height:1.55;color:var(--mb-muted,#5c5b57)}
h2{margin:0;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--mb-muted,#5c5b57)}
.group{display:grid;gap:10px}
.row{display:flex;gap:10px;flex-wrap:wrap}
.opt{position:relative;display:grid;gap:4px;padding:12px 14px;border:2px solid var(--mb-border,#b3b2ab);background:var(--mb-surface,#e4e3dc);cursor:pointer;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;min-width:110px}
.opt small{font-size:11px;font-weight:400;letter-spacing:.02em;text-transform:none;color:var(--mb-muted,#5c5b57)}
.opt input{position:absolute;opacity:0;inset:0;width:100%;height:100%;margin:0;cursor:pointer}
.opt:hover{background:var(--ctl-hover-bg)}
.opt:active{background:var(--ctl-press-bg)}
.opt:has(input:checked),.opt:has(input:checked):hover,.opt:has(input:checked):active{border-color:var(--mb-fg,#0a0a0a);background:var(--ctl-sel-bg);box-shadow:inset 0 0 0 1px var(--mb-fg,#0a0a0a)}
.opt:has(input:focus-visible){outline:2px solid var(--mb-accent,#9c9b95);outline-offset:2px}
.themes{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.themes .opt{min-width:0;padding:8px;align-content:start;grid-template-rows:auto auto 30px}
.themes .opt small{line-height:1.35}
.sw{display:grid;grid-template-rows:16px 1fr;height:56px;border:1px solid var(--mb-border,#b3b2ab);background:var(--s-bg)}
.sw i{display:block;background:var(--s-surface);border-bottom:1px solid var(--s-border)}
.sw b{display:flex;align-items:center;gap:6px;padding:0 8px}
.sw b::before{content:"";width:14px;height:14px;background:var(--s-accent)}
.sw b::after{content:"";flex:1;height:4px;background:var(--s-fg);opacity:.7}
.toggle{display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border:2px solid var(--mb-border,#b3b2ab);background:var(--mb-surface,#e4e3dc);cursor:pointer}
.toggle input{margin:2px 0 0;width:16px;height:16px;accent-color:var(--mb-accent,#9c9b95);flex:none}
.toggle span{display:grid;gap:3px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
.toggle small{font-size:11px;font-weight:400;letter-spacing:0;text-transform:none;color:var(--mb-muted,#5c5b57)}
.toggle:has(input:focus-visible){outline:2px solid var(--mb-accent,#9c9b95);outline-offset:2px}
select{max-width:280px;border:2px solid var(--mb-border,#b3b2ab);background:var(--mb-surface,#e4e3dc);color:var(--mb-fg,#0a0a0a);border-radius:0;padding:8px 10px;font:inherit;font-size:12px}
.mock{display:flex;height:74px;border:1px solid var(--mb-border,#b3b2ab);background:var(--mb-bg,#f0efe9);overflow:hidden}
.mock.h{flex-direction:column}
.mock .bar{display:flex;gap:4px;align-items:center;padding:0 6px;background:var(--mb-surface-2,#d8d7d1)}
.mock.h .bar{height:16px;border-bottom:1px solid var(--mb-border,#b3b2ab)}
.mock.v .bar{width:30px;flex-direction:column;align-items:stretch;justify-content:flex-start;padding:6px 4px;border-right:1px solid var(--mb-border,#b3b2ab)}
.mock .bar u{display:block;background:var(--mb-muted,#5c5b57);opacity:.6}
.mock .bar u:first-child{background:var(--mb-fg,#0a0a0a);opacity:1}
.mock.h .bar u{width:26px;height:6px}
.mock.v .bar u{height:6px}
.mock .page{flex:1;display:grid;place-items:center}
.mock .page::after{content:"";width:46%;height:6px;background:var(--mb-surface-2,#d8d7d1);border:1px solid var(--mb-border,#b3b2ab)}
.tips{display:grid;gap:0;border:2px solid var(--mb-border,#b3b2ab)}
.tips div{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;font-size:12px;border-top:1px solid var(--mb-border,#b3b2ab)}
.tips div:first-child{border-top:0}
.tips div.off{opacity:.45}
kbd{font:inherit;font-weight:700;border:1px solid var(--mb-fg,#0a0a0a);padding:1px 6px}
.foot{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 22px;border-top:2px solid var(--mb-border,#b3b2ab);background:var(--mb-surface,#e4e3dc)}
.dots{display:flex;gap:8px}
.dots button{width:12px;height:12px;padding:0;border:2px solid var(--mb-fg,#0a0a0a);background:transparent;cursor:pointer}
.dots button[aria-current=step]{background:var(--mb-fg,#0a0a0a)}
.btns{display:flex;gap:10px;align-items:center}
button.b{border:2px solid var(--mb-fg,#0a0a0a);background:var(--mb-fg,#0a0a0a);color:var(--mb-bg,#f0efe9);border-radius:0;padding:10px 16px;font:inherit;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;cursor:pointer}
button.b.ghost{background:transparent;color:var(--mb-fg,#0a0a0a)}
button.b.link{border-color:transparent;background:transparent;color:var(--mb-muted,#5c5b57);padding-left:6px;padding-right:6px}
button.b:hover:not(:disabled){background:var(--ctl-solid-hover)}
button.b:active:not(:disabled){background:var(--ctl-solid-press)}
button.b.ghost:hover:not(:disabled),button.b.link:hover:not(:disabled){background:var(--ctl-hover-bg);color:var(--mb-fg,#0a0a0a)}
button.b.ghost:active:not(:disabled),button.b.link:active:not(:disabled){background:var(--ctl-press-bg)}
button:focus-visible,select:focus-visible{outline:2px solid var(--mb-accent,#9c9b95);outline-offset:2px}
.toggle:hover{background:var(--ctl-hover-bg)}
select:hover{background:var(--ctl-hover-bg)}
button.b:disabled{opacity:.4;cursor:not-allowed}
button.b[hidden]{display:none}
@media (max-width:560px){.top,.foot{padding:12px 14px}main{padding:18px 14px}}
</style>
</head>
<body>
<div class="top"><span>MonoBrowser</span><span class="muted" id="stepLabel"></span></div>
<main><div class="stage" id="stage"></div></main>
<div class="foot">
  <div class="dots" id="dots" role="tablist"></div>
  <div class="btns">
    <button class="b link" type="button" id="skip"></button>
    <button class="b ghost" type="button" id="back"></button>
    <button class="b" type="button" id="next"></button>
  </div>
</div>
<script>
(() => {
const D = ${data};
const C = D.copy;
${shared}
const api = window.browserApi;
const N = D.steps.length;
let step = D.step;
let finishing = false;
const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const swatch = (colors) => {
  const s = el("span", "sw", "<i></i><b></b>");
  const map = { bg: "--s-bg", surface: "--s-surface", fg: "--s-fg", accent: "--s-accent", border: "--s-border" };
  for (const k of Object.keys(map)) s.style.setProperty(map[k], colors[k] || "transparent");
  return s;
};
const radio = (name, value, label, hint, checked, onChange, visual) => {
  const l = el("label", "opt");
  const i = el("input"); i.type = "radio"; i.name = name; i.value = value; i.checked = checked;
  i.addEventListener("change", () => { if (i.checked) onChange(value); });
  l.append(i);
  if (visual) l.append(visual);
  const t = el("span"); t.textContent = label; l.append(t);
  if (hint) { const h = el("small"); h.textContent = hint; l.append(h); }
  return l;
};
const toggle = (label, hint, checked, onChange) => {
  const l = el("label", "toggle");
  const i = el("input"); i.type = "checkbox"; i.checked = checked;
  i.addEventListener("change", () => onChange(i.checked));
  const s = el("span"); const a = el("span"); a.textContent = label; s.append(a);
  if (hint) { const h = el("small"); h.textContent = hint; s.append(h); }
  l.append(i, s);
  return l;
};
const mock = (kind) => el("span", "mock " + (kind === "horizontal" ? "h" : "v"), '<span class="bar"><u></u><u></u><u></u></span><span class="page"></span>');
const panels = [];
const safe = (p) => Promise.resolve(p).catch(() => undefined);

const build = async () => {
  const [theme, anim, layout, adblock, glance, search] = await Promise.all([
    safe(api.getTheme()), safe(api.getAnimationSettings()), safe(api.getLayoutSettings()),
    safe(api.getAdblockStatus()), safe(api.getGlanceSettings()), safe(api.getSearchSettings()),
  ]);
  const stage = $("stage");

  // 1 Welcome
  const p1 = el("section", "panel");
  const brand = el("h1", "brand"); brand.append("Mono"); const br = el("span"); br.textContent = "Browser"; brand.append(document.createElement("br"), br);
  p1.append(brand, el("p", "", ""));
  p1.lastChild.textContent = C.welcomePitch;
  const g1 = el("div", "group"); const h1 = el("h2"); h1.textContent = C.language; g1.append(h1);
  const r1 = el("div", "row");
  r1.append(radio("lang", "pl", "Polski", "", D.language === "pl", (v) => api.setLanguage(v)), radio("lang", "en", "English", "", D.language === "en", (v) => api.setLanguage(v)));
  const hh = el("p"); hh.textContent = C.languageHint; g1.append(r1, hh); p1.append(g1);

  // 2 Look
  const p2 = el("section", "panel");
  const t2 = el("h1", "h"); t2.textContent = C.lookHeading; const x2 = el("p"); x2.textContent = C.lookText;
  const grid = el("div", "themes");
  const cur = theme && theme.settings ? theme.settings.id : "default";
  const setTheme = (id) => safe(api.setTheme({ id }));
  grid.append(radio("theme", "default", C.themeDefault, C.themeDefaultHint, cur === "default", setTheme, swatch(D.defaultColors)));
  for (const p of D.presets) grid.append(radio("theme", p.id, p.name, "", cur === p.id, setTheme, swatch(p.colors)));
  p2.append(t2, x2, grid, toggle(C.animations, C.animationsHint, !anim || anim.enabled !== false, (v) => safe(api.setAnimationSettings({ enabled: v }))));

  // 3 Layout
  const p3 = el("section", "panel");
  const t3 = el("h1", "h"); t3.textContent = C.layoutHeading; const x3 = el("p"); x3.textContent = C.layoutText;
  const lr = el("div", "row");
  const curLayout = layout && layout.tabBarLayout === "vertical" ? "vertical" : "horizontal";
  const setLayout = (v) => safe(api.setLayoutSettings({ tabBarLayout: v }));
  lr.append(radio("layout", "horizontal", C.horizontal, C.horizontalHint, curLayout === "horizontal", setLayout, mock("horizontal")), radio("layout", "vertical", C.vertical, C.verticalHint, curLayout === "vertical", setLayout, mock("vertical")));
  lr.querySelectorAll(".opt").forEach((o) => { o.style.flex = "1 1 200px"; });
  p3.append(t3, x3, lr);
  if (layout && typeof layout.compactMode === "boolean") p3.append(toggle(C.compact, C.compactHint, layout.compactMode, (v) => safe(api.setLayoutSettings({ compactMode: v }))));
  if (layout && typeof layout.compactMode === "boolean") { const sp = el("p"); sp.textContent = C.spaces; p3.append(sp); }

  // The Glance tip on the last step follows the Glance choices made on step 4 (dimmed while Glance is off).
  const glanceView = { enabled: true, trigger: "alt", sync: () => {} };
  // 4 Privacy
  const p4 = el("section", "panel");
  const t4 = el("h1", "h"); t4.textContent = C.privacyHeading; const x4 = el("p"); x4.textContent = C.privacyText;
  p4.append(t4, x4);
  let blockOn = adblock ? adblock.enabled !== false : true;
  p4.append(toggle(C.blocking, C.blockingHint, blockOn, async (v) => {
    if (v === blockOn) return;
    const st = await safe(api.toggleAdblock()); blockOn = st ? st.enabled !== false : v;
  }));
  const gl = glance || { enabled: true, trigger: "alt" };
  const trig = el("select"); trig.setAttribute("aria-label", C.trigger);
  for (const k of Object.keys(C.triggers)) { const o = el("option"); o.value = k; o.textContent = C.triggers[k]; trig.append(o); }
  trig.value = gl.trigger; trig.disabled = !gl.enabled;
  glanceView.enabled = gl.enabled; glanceView.trigger = gl.trigger;
  trig.addEventListener("change", () => { glanceView.trigger = trig.value; glanceView.sync(); safe(api.setGlanceSettings({ trigger: trig.value })); });
  p4.append(toggle(C.glance, C.glanceHint, gl.enabled, (v) => { trig.disabled = !v; glanceView.enabled = v; glanceView.sync(); safe(api.setGlanceSettings({ enabled: v })); }));
  const tg = el("div", "group"); const th = el("h2"); th.textContent = C.trigger; tg.append(th, trig); p4.append(tg);
  const sg = el("div", "group"); const sh = el("h2"); sh.textContent = C.search; sg.append(sh);
  const sr = el("div", "row"); const eng = search && search.engine ? search.engine : "google";
  const setEngine = (v) => safe(api.setSearchSettings({ engine: v, customUrl: (search && search.customUrl) || "" }));
  if (eng === "custom") { const n = el("p"); n.textContent = C.searchMore; sg.append(n); }
  else { sr.append(radio("engine", "google", "Google", "", eng === "google", setEngine), radio("engine", "duckduckgo", "DuckDuckGo", "", eng === "duckduckgo", setEngine)); const n = el("p"); n.textContent = C.searchMore; sg.append(sr, n); }
  p4.append(sg);

  // 5 Done
  const p5 = el("section", "panel");
  const t5 = el("h1", "h"); t5.textContent = C.doneHeading; const x5 = el("p"); x5.textContent = C.doneText;
  const tips = el("div", "tips");
  C.tips.forEach((tip, index) => {
    const r = el("div"); const k = el("kbd"); k.textContent = tip[0]; const d = el("span"); d.textContent = tip[1]; r.append(k, d); tips.append(r);
    if (index === 2) {
      glanceView.sync = () => {
        k.textContent = glanceView.enabled ? (C.triggers[glanceView.trigger] || tip[0]) : tip[0];
        d.textContent = glanceView.enabled ? tip[1] : tip[1] + " (" + C.glanceTipOff + ")";
        r.classList.toggle("off", !glanceView.enabled);
      };
      glanceView.sync();
    }
  });
  const x6 = el("p"); x6.textContent = C.reopen;
  p5.append(t5, x5, tips, x6);

  panels.push(p1, p2, p3, p4, p5);
  for (const p of panels) { p.hidden = true; stage.append(p); }
};

const dots = $("dots");
const render = () => {
  panels.forEach((p, i) => { p.hidden = i !== step; });
  $("stepLabel").textContent = C.step + " " + (step + 1) + " " + C.of + " " + N;
  $("back").hidden = step === 0;
  $("skip").hidden = isLastStep(step, N);
  $("next").textContent = isLastStep(step, N) ? C.start : C.next;
  dots.querySelectorAll("button").forEach((d, i) => { if (i === step) d.setAttribute("aria-current", "step"); else d.removeAttribute("aria-current"); });
};
const go = (i) => { step = Math.max(0, Math.min(N - 1, i)); render(); safe(api.setOnboardingStep(step)); };
const finish = async () => { if (finishing) return; finishing = true; await safe(api.finishOnboarding()); };
const advance = () => { if (isLastStep(step, N)) finish(); else go(nextStep(step, N)); };

$("skip").textContent = C.skip; $("back").textContent = C.back;
for (let i = 0; i < N; i++) { const d = el("button"); d.type = "button"; d.setAttribute("aria-label", C.step + " " + (i + 1)); d.addEventListener("click", () => go(i)); dots.append(d); }
$("next").addEventListener("click", advance);
$("back").addEventListener("click", () => go(prevStep(step)));
$("skip").addEventListener("click", finish);
document.addEventListener("keydown", (e) => {
  const action = onboardingKeyAction(e.key, e.target && e.target.tagName ? e.target.tagName : "BODY");
  if (!action) return;
  e.preventDefault();
  if (action === "skip") finish(); else advance();
});
build().then(() => { render(); $("next").focus(); }).catch(() => undefined);
})();
</script>
</body>
</html>`;
};
