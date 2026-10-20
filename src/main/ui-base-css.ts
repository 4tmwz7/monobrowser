// Shared visual base for internal pages and popups: one type scale, form-control font, headers, empty states, focus rings.
// Pure module (strings only) so it can be unit-tested. Colors only come from the --mb-* tokens (via the legacy aliases).

/** Type scale in px: caption/hint, small text, body, title, display. Use only these sizes in internal UI. */
export const TYPE_SCALE = { caption: 11, small: 12, body: 13, title: 15, display: 20 } as const;

/** Height in px of single-line inputs and selects in internal pages. */
export const CONTROL_HEIGHT = 34;

/** Goes FIRST in a page's <style>: zero-specificity baseline, every later rule overrides it. */
export const UI_BASE_START_CSS = `
  :where(button,input,select,textarea) { font:inherit; }
  :where(input,textarea)::placeholder { font:inherit; }
`;

/** Goes LAST in a page's <style>: headers on theme tokens, shared empty state, focus ring. */
export const UI_BASE_END_CSS = `
  /* Themed scrollbars: thin, muted thumb on the surface track (inherited by every scroll container). */
  :root { scrollbar-width:thin; scrollbar-color:var(--mb-muted) var(--mb-surface); }
  header { background:var(--mb-surface,var(--white)); color:var(--black); border-bottom:2px solid var(--black); }
  header h1, header > span, header .heading h1 { color:var(--black); }
  header button, header .clear-history { border-color:var(--black); background:var(--black); color:var(--white); }
  header button.danger { background:transparent; color:var(--black); }
  header button:hover:not(:disabled), header .clear-history:hover:not(:disabled) { background:var(--accent); color:var(--mb-on-accent,var(--black)); }
  /* Disabled header actions stay readable (muted text and frame, at least 3:1 on the header surface) instead of fading out. */
  header button:disabled, header button.danger:disabled, header .clear-history:disabled { opacity:1; background:transparent; border-color:var(--grey); color:var(--grey); cursor:not-allowed; }
  .empty, .stats-empty { display:block; flex:0 0 auto; padding:22px 16px; border:2px dashed var(--line,var(--black)); background:transparent; color:var(--grey); font-size:${TYPE_SCALE.body}px; line-height:1.5; text-align:left; }
  .panel:has(> .empty) { border:0; background:transparent; }
  .card > .empty, .card > .stats-empty { border:0; padding:10px 4px; }
  input:where([type=text],[type=number],[type=search],[type=url],[type=password],:not([type])), select, textarea { min-width:0; border:2px solid var(--black); border-radius:0; background:var(--white); color:var(--black); padding:9px 10px; font-size:${TYPE_SCALE.small}px; outline:0; }
  /* One control height for every single-line field and select: text is never clipped and neighbours line up. */
  input:where([type=text],[type=number],[type=search],[type=url],[type=password],:not([type])), select { height:${CONTROL_HEIGHT}px; padding-top:0; padding-bottom:0; line-height:normal; }
  input::placeholder, textarea::placeholder { color:var(--grey); opacity:1; }
  input:where([type=text],[type=number],[type=search],[type=url],[type=password],:not([type])):focus, select:focus, textarea:focus { box-shadow:4px 4px 0 var(--accent); }
  :where(button,a,input,select,textarea,summary):focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
`;

const hexToRgba = (hex: string, alpha: number): string => {
  const n = (i: number): number => Number.parseInt(hex.slice(i, i + 2), 16);
  return `rgba(${n(1)},${n(3)},${n(5)},${alpha})`;
};

/** CSS for the find-in-page highlights injected into web pages: accent tint for all matches, solid accent for the active one. Keeps the page's own text color for readability on tinted matches. */
export const findHighlightCss = (tokens: { accent: string; onAccent: string }): string =>
  `::highlight(monobrowser-find-all){background-color:${hexToRgba(tokens.accent, 0.45)}}` +
  `::highlight(monobrowser-find-active){background-color:${tokens.accent};color:${tokens.onAccent};text-decoration:underline}`;
