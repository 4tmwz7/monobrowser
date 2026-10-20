// Unified browser theme: one token set shared by the shell, overlays, internal pages and popup menus.
// Pure module (no Electron imports) so it can be unit-tested.

import { animationCss, areAnimationsEffective } from "./animation-settings.js";

export type ThemeTokenKey = "bg" | "surface" | "surface2" | "fg" | "muted" | "accent" | "onAccent" | "border" | "danger";

export const THEME_TOKEN_KEYS: readonly ThemeTokenKey[] = ["bg", "surface", "surface2", "fg", "muted", "accent", "onAccent", "border", "danger"];

/** CSS custom property for every token. */
export const THEME_CSS_VARS: Readonly<Record<ThemeTokenKey, string>> = {
  bg: "--mb-bg", surface: "--mb-surface", surface2: "--mb-surface-2", fg: "--mb-fg", muted: "--mb-muted",
  accent: "--mb-accent", onAccent: "--mb-on-accent", border: "--mb-border", danger: "--mb-danger",
};

export type ThemeColors = Record<ThemeTokenKey, string>;
export type ThemeScheme = "light" | "dark";
export type ThemeTokens = ThemeColors & { scheme: ThemeScheme };

/** Persisted choice: "default" (auto light/dark), a preset id, or "custom" (with its own colors). */
export type ThemeSettings = { id: string; custom?: ThemeColors };

const HEX = /^#[0-9a-fA-F]{6}$/;

export const normalizeHex = (value: unknown): string | null =>
  typeof value === "string" && HEX.test(value.trim()) ? value.trim().toLowerCase() : null;

// ── Color math ──────────────────────────────────────────────────────────────
const channel = (hex: string, index: number): number => {
  const v = parseInt(hex.slice(index, index + 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

export const luminance = (hex: string): number => 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);

export const contrastRatio = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Linear mix of two #rrggbb colors; amount = share of `b`. */
export const mixHex = (a: string, b: string, amount: number): string => {
  const part = (i: number): string => {
    const x = parseInt(a.slice(i, i + 2), 16);
    const y = parseInt(b.slice(i, i + 2), 16);
    return Math.round(x + (y - x) * amount).toString(16).padStart(2, "0");
  };
  return `#${part(1)}${part(3)}${part(5)}`;
};

/** Text color for content drawn on top of the accent color: the theme's own bg/fg when readable, else black/white. */
export const pickOnAccent = (accent: string, bg: string, fg: string): string => {
  const own = contrastRatio(bg, accent) >= contrastRatio(fg, accent) ? bg : fg;
  if (contrastRatio(own, accent) >= 4.5) return own;
  return contrastRatio("#0a0a0a", accent) >= contrastRatio("#ffffff", accent) ? "#0a0a0a" : "#ffffff";
};

export const schemeOf = (colors: Pick<ThemeColors, "bg" | "fg">): ThemeScheme =>
  luminance(colors.bg) < luminance(colors.fg) ? "dark" : "light";

export const withScheme = (colors: ThemeColors): ThemeTokens => ({ ...colors, scheme: schemeOf(colors) });

// ── Default theme (the original monochrome look) ────────────────────────────
export const DEFAULT_LIGHT: ThemeTokens = {
  scheme: "light",
  bg: "#f0efe9", surface: "#e4e3dc", surface2: "#d8d7d1", fg: "#0a0a0a", muted: "#5c5b57",
  accent: "#9c9b95", onAccent: "#0a0a0a", border: "#b3b2ab", danger: "#8b2931",
};

export const DEFAULT_DARK: ThemeTokens = {
  scheme: "dark",
  bg: "#0a0a0a", surface: "#161614", surface2: "#242421", fg: "#f0efe9", muted: "#a5a49e",
  accent: "#9c9b95", onAccent: "#0a0a0a", border: "#3a3a36", danger: "#e58a90",
};

export const DEFAULT_THEME_ID = "default";
export const CUSTOM_THEME_ID = "custom";
export const DEFAULT_THEME_SETTINGS: ThemeSettings = { id: DEFAULT_THEME_ID };

export const defaultTokens = (systemDark: boolean): ThemeTokens => (systemDark ? DEFAULT_DARK : DEFAULT_LIGHT);

export const stripScheme = (tokens: ThemeTokens | ThemeColors): ThemeColors => {
  const out = {} as ThemeColors;
  for (const key of THEME_TOKEN_KEYS) out[key] = tokens[key];
  return out;
};

// ── Presets ─────────────────────────────────────────────────────────────────
export type ThemePreset = { id: string; name: string; tokens: ThemeTokens };

type Palette = {
  id: string; name: string;
  base: string;     // page background
  bar: string;      // tab bar / toolbar / headers
  surface: string;  // raised surface: hover, active tab, search box
  text: string;     // primary text
  muted: string;    // secondary text
  accent: string;   // signature accent
  danger: string;   // red from the official palette
};

// Palette values come from each theme's official repository (see THIRD-PARTY-NOTICES.md).
const PALETTES: readonly Palette[] = [
  { id: "rose-pine", name: "Rosé Pine", base: "#191724", bar: "#191724", surface: "#26233a", text: "#e0def4", muted: "#908caa", accent: "#ebbcba", danger: "#eb6f92" },
  { id: "rose-pine-moon", name: "Rosé Pine Moon", base: "#232136", bar: "#232136", surface: "#393552", text: "#e0def4", muted: "#908caa", accent: "#c4a7e7", danger: "#eb6f92" },
  { id: "rose-pine-dawn", name: "Rosé Pine Dawn", base: "#faf4ed", bar: "#f2e9e1", surface: "#dfdad9", text: "#575279", muted: "#797593", accent: "#907aa9", danger: "#b4637a" },
  { id: "everforest-dark", name: "Everforest Dark", base: "#2d353b", bar: "#272e33", surface: "#3d484d", text: "#d3c6aa", muted: "#9da9a0", accent: "#a7c080", danger: "#e67e80" },
  { id: "everforest-light", name: "Everforest Light", base: "#fdf6e3", bar: "#efebd4", surface: "#f4f0d9", text: "#5c6a72", muted: "#4b585e", accent: "#8da101", danger: "#f85552" },
  { id: "gruvbox-dark", name: "Gruvbox Dark", base: "#282828", bar: "#1d2021", surface: "#3c3836", text: "#ebdbb2", muted: "#bdae93", accent: "#fabd2f", danger: "#fb4934" },
  { id: "gruvbox-light", name: "Gruvbox Light", base: "#fbf1c7", bar: "#ebdbb2", surface: "#d5c4a1", text: "#3c3836", muted: "#504945", accent: "#b57614", danger: "#9d0006" },
  { id: "nord", name: "Nord", base: "#2e3440", bar: "#2e3440", surface: "#3b4252", text: "#eceff4", muted: "#d8dee9", accent: "#88c0d0", danger: "#bf616a" },
  { id: "dracula", name: "Dracula", base: "#282a36", bar: "#21222c", surface: "#44475a", text: "#f8f8f2", muted: "#bfc3d9", accent: "#bd93f9", danger: "#ff5555" },
  { id: "tokyo-night", name: "Tokyo Night", base: "#1a1b26", bar: "#16161e", surface: "#292e42", text: "#a9b1d6", muted: "#9aa5ce", accent: "#7aa2f7", danger: "#f7768e" },
  { id: "solarized-dark", name: "Solarized Dark", base: "#002b36", bar: "#002b36", surface: "#073642", text: "#93a1a1", muted: "#93a1a1", accent: "#b58900", danger: "#dc322f" },
  { id: "solarized-light", name: "Solarized Light", base: "#fdf6e3", bar: "#eee8d5", surface: "#e3dcc5", text: "#073642", muted: "#586e75", accent: "#b58900", danger: "#dc322f" },
  { id: "kanagawa-wave", name: "Kanagawa Wave", base: "#1f1f28", bar: "#16161d", surface: "#363646", text: "#dcd7ba", muted: "#c8c093", accent: "#7e9cd8", danger: "#e46876" },
  { id: "one-dark", name: "One Dark", base: "#282c34", bar: "#21252b", surface: "#3e4451", text: "#abb2bf", muted: "#abb2bf", accent: "#61afef", danger: "#e06c75" },
];

/** Moves `muted` toward `fg` until it reaches `min` contrast on bg/surface/surface2 (secondary text must stay readable on every surface). */
export const ensureMutedContrast = (muted: string, fg: string, surfaces: readonly string[], min = 4.5): string => {
  const worst = (color: string): number => Math.min(...surfaces.map((surface) => contrastRatio(color, surface)));
  for (let step = 0; step <= 20 && worst(muted) < min; step += 1) {
    const next = mixHex(muted, fg, 0.1);
    if (next === muted) break;
    muted = next;
  }
  return muted;
};

const presetFromPalette = (p: Palette): ThemePreset => {
  const colors: ThemeColors = {
    bg: p.base, surface: p.bar, surface2: p.surface, fg: p.text, muted: ensureMutedContrast(p.muted, p.text, [p.base, p.bar, p.surface]), accent: p.accent,
    onAccent: pickOnAccent(p.accent, p.base, p.text),
    border: mixHex(p.base, p.text, 0.28),
    danger: p.danger,
  };
  return { id: p.id, name: p.name, tokens: withScheme(colors) };
};

export const THEME_PRESETS: readonly ThemePreset[] = PALETTES.map(presetFromPalette);

export const findPreset = (id: string): ThemePreset | undefined => THEME_PRESETS.find((preset) => preset.id === id);

// ── Validation / normalization ──────────────────────────────────────────────
/** Reads a complete color set from untrusted data; missing/invalid tokens come from `base`. Null when nothing valid was found. */
export const normalizeThemeColors = (value: unknown, base: ThemeColors = DEFAULT_LIGHT): ThemeColors | null => {
  if (typeof value !== "object" || value === null) return null;
  const out = {} as ThemeColors;
  let found = 0;
  for (const key of THEME_TOKEN_KEYS) {
    const hex = normalizeHex((value as Record<string, unknown>)[key]);
    if (hex) found += 1;
    out[key] = hex ?? base[key];
  }
  return found > 0 ? out : null;
};

export const normalizeThemeSettings = (value: unknown): ThemeSettings => {
  if (typeof value !== "object" || value === null) return { ...DEFAULT_THEME_SETTINGS };
  const raw = value as { id?: unknown; custom?: unknown };
  const id = typeof raw.id === "string" ? raw.id : DEFAULT_THEME_ID;
  if (id === CUSTOM_THEME_ID) {
    const custom = normalizeThemeColors(raw.custom);
    return custom ? { id: CUSTOM_THEME_ID, custom } : { ...DEFAULT_THEME_SETTINGS };
  }
  if (id === DEFAULT_THEME_ID || findPreset(id)) return { id };
  return { ...DEFAULT_THEME_SETTINGS };
};

/** Resolves the saved choice into concrete tokens (Default follows the system light/dark setting). */
export const resolveTheme = (settings: ThemeSettings, systemDark: boolean): ThemeTokens => {
  if (settings.id === CUSTOM_THEME_ID && settings.custom) return withScheme(settings.custom);
  return findPreset(settings.id)?.tokens ?? defaultTokens(systemDark);
};

// ── Migration of the old customColors (start page + tab bar) ────────────────
type LegacyGroup = Record<string, unknown>;

/** Old `customColors` from search-settings.json -> a custom theme (or Default when nothing was customized). */
export const migrateLegacyColors = (legacy: unknown): ThemeSettings => {
  if (typeof legacy !== "object" || legacy === null) return { ...DEFAULT_THEME_SETTINGS };
  const sp = ((legacy as { startPage?: unknown }).startPage ?? {}) as LegacyGroup;
  const tb = ((legacy as { tabBar?: unknown }).tabBar ?? {}) as LegacyGroup;
  const pick = (...candidates: unknown[]): string | null => {
    for (const candidate of candidates) {
      const hex = normalizeHex(candidate);
      if (hex) return hex;
    }
    return null;
  };
  const bg = pick(sp.background, tb.tabActiveBg);
  const fg = pick(sp.text, tb.tabActiveFg);
  const surface = pick(tb.tabbarBg, tb.tabBg);
  const surface2 = pick(tb.tabHoverBg, sp.searchBg);
  const muted = pick(tb.tabFg, tb.tabbarFg);
  const accent = pick(sp.accent, tb.accent);
  if (!bg && !fg && !surface && !surface2 && !muted && !accent) return { ...DEFAULT_THEME_SETTINGS };

  const base = DEFAULT_LIGHT;
  const nextBg = bg ?? base.bg;
  const nextFg = fg ?? base.fg;
  const nextAccent = accent ?? base.accent;
  const colors: ThemeColors = {
    bg: nextBg,
    fg: nextFg,
    surface: surface ?? (bg ? mixHex(nextBg, nextFg, 0.08) : base.surface),
    surface2: surface2 ?? (bg ? mixHex(nextBg, nextFg, 0.16) : base.surface2),
    muted: muted ?? (fg || bg ? mixHex(nextFg, nextBg, 0.35) : base.muted),
    accent: nextAccent,
    onAccent: pickOnAccent(nextAccent, nextBg, nextFg),
    border: mixHex(nextBg, nextFg, 0.28),
    danger: base.danger,
  };
  return { id: CUSTOM_THEME_ID, custom: colors };
};

// ── CSS ─────────────────────────────────────────────────────────────────────
/** `:root{...}` block with all tokens and color-scheme. */
export const themeCss = (tokens: ThemeTokens): string => {
  const vars = THEME_TOKEN_KEYS.map((key) => `${THEME_CSS_VARS[key]}:${tokens[key]}`).join(";");
  return `:root{color-scheme:${tokens.scheme};${vars}}${animationCss(areAnimationsEffective())}`;
};

export const THEME_STYLE_ID = "mb-theme";

export const themeStyleTag = (tokens: ThemeTokens): string => `<style id="${THEME_STYLE_ID}">${themeCss(tokens)}</style>`;

/** Inserts the theme style as the first thing in <head> (or at the top when the document has none). */
export const injectThemeIntoHtml = (html: string, tokens: ThemeTokens): string => {
  const tag = themeStyleTag(tokens);
  const head = /<head\b[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length);
  return tag + html;
};

const THEME_SWAP_CSS = ".mb-theme-swap,.mb-theme-swap *,.mb-theme-swap *::before,.mb-theme-swap *::after{transition:none!important}";

/** Script (for webContents.executeJavaScript) that updates or creates the theme style element in a live page. */
export const themeApplyScript = (tokens: ThemeTokens): string =>
  // Transitions are suspended while the tokens swap: a background tab does not tick transitions, so the
  // body would otherwise keep the old color (dark header over a light body) until the tab is shown again.
  `(()=>{const r=document.documentElement;let s=document.getElementById(${JSON.stringify(THEME_STYLE_ID)});if(!s){s=document.createElement('style');s.id=${JSON.stringify(THEME_STYLE_ID)};(document.head||r).prepend(s)}r.classList.add('mb-theme-swap');s.textContent=${JSON.stringify(themeCss(tokens) + THEME_SWAP_CSS)};r.classList.toggle('mb-no-anim',${!areAnimationsEffective()});void r.offsetWidth;setTimeout(()=>r.classList.remove('mb-theme-swap'),80)})()`;

/** Aliases for the old --black/--white/--grey/--accent variables used by the internal pages. */
export const LEGACY_ALIAS_CSS = "--black:var(--mb-fg,#0a0a0a);--white:var(--mb-bg,#f0efe9);--grey:var(--mb-muted,#5c5b57);--accent:var(--mb-accent,#9c9b95);--on-accent:var(--mb-on-accent,#0a0a0a);--surface:var(--mb-surface,#e4e3dc);--surface-2:var(--mb-surface-2,#d8d7d1);--danger:var(--mb-danger,#8b2931);--line:var(--mb-border,#b3b2ab);";
