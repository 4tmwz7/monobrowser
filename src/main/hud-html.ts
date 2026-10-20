// Strony nakładek HUD (pasek postępu, podgląd adresu linku). Ładowane jako data: URL,
// bez preloadu i bez IPC – proces główny steruje nimi przez executeJavaScript.
// Kolory jak w pozostałych nakładkach (find.html): zmienne w :root, do podmiany w jednolitym motywie.

import { LEGACY_ALIAS_CSS } from "./theme.js";

const HUD_BASE_CSS = `
:root { ${LEGACY_ALIAS_CSS} font-family: ui-monospace, "Cascadia Mono", "Courier New", monospace; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; user-select: none; }
`;

const wrapHud = (body: string, css: string, script: string): string =>
  `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><style>${HUD_BASE_CSS}${css}</style></head><body>${body}<script>${script}</script></body></html>`;

/** 2 px pasek u góry strony: czarna i biała linia, żeby był widoczny na jasnych i ciemnych stronach. */
export const PROGRESS_HUD_HTML = wrapHud(
  `<div id="bar"></div>`,
  `#bar { height: 100%; width: 0; opacity: 0; background: linear-gradient(var(--black) 50%, var(--white) 50%); }`,
  `(() => {
  const bar = document.getElementById('bar');
  let token = 0;
  window.__start = () => {
    token += 1;
    bar.style.transition = 'none';
    bar.style.opacity = '1';
    bar.style.width = '0';
    void bar.offsetWidth;
    bar.style.transition = 'width 9s cubic-bezier(.08,.6,.2,1)';
    bar.style.width = '88%';
  };
  window.__done = () => {
    const mine = ++token;
    bar.style.transition = 'width .15s ease-out';
    bar.style.width = '100%';
    setTimeout(() => {
      if (mine !== token) return;
      bar.style.transition = 'opacity .2s linear';
      bar.style.opacity = '0';
    }, 170);
  };
})();`,
);

/** Etykieta z adresem linku pod kursorem; __set zwraca naturalną szerokość tekstu (px). */
export const STATUS_HUD_HTML = wrapHud(
  `<div id="s"></div>`,
  `@keyframes hud-in { from { opacity: 0; transform: translateY(3px); } }
#s { animation: hud-in var(--mb-dur, 160ms) var(--mb-ease, ease) backwards; display: block; width: 100%; height: 100%; padding: 0 8px; line-height: 20px; border: 1px solid var(--black); background: var(--white); color: var(--black); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`,
  `(() => {
  const s = document.getElementById('s');
  let last = 0;
  window.__set = (text) => {
    s.textContent = text;
    const now = Date.now();
    if (now - last > 400) { s.style.animation = 'none'; void s.offsetWidth; s.style.animation = ''; }
    last = now;
    s.style.width = 'auto';
    s.style.display = 'inline-block';
    const width = Math.ceil(s.getBoundingClientRect().width);
    s.style.width = '100%';
    s.style.display = 'block';
    return width;
  };
})();`,
);
