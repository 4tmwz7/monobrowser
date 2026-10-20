// UI animations: persisted on/off setting plus the shared CSS (--mb-dur / --mb-ease contract) that every
// themed surface (shell, overlays, popups, internal pages) receives together with the theme tokens.
// Pure module (no Electron imports) so it can be unit-tested.

export type AnimationSettings = { enabled: boolean };

export const DEFAULT_ANIMATION_SETTINGS: AnimationSettings = { enabled: true };

export const normalizeAnimationSettings = (value: unknown): AnimationSettings => {
  if (typeof value !== "object" || value === null) return { ...DEFAULT_ANIMATION_SETTINGS };
  const enabled = (value as Record<string, unknown>).enabled;
  return { enabled: typeof enabled === "boolean" ? enabled : DEFAULT_ANIMATION_SETTINGS.enabled };
};

/** Effective state: the setting, unless the OS asks for reduced motion or the environment disables animations (e2e). */
let effectiveEnabled = true;
export const setAnimationsEffective = (enabled: boolean): void => { effectiveEnabled = enabled; };
export const areAnimationsEffective = (): boolean => effectiveEnabled;

export const resolveAnimationsEffective = (settings: AnimationSettings, prefersReducedMotion: boolean, envDisabled: boolean): boolean =>
  settings.enabled && !prefersReducedMotion && !envDisabled;

const EASE = "cubic-bezier(.2,.7,.2,1)";
const ON_VARS = `--mb-dur:160ms;--mb-dur-slow:240ms;--mb-ease:${EASE};--mb-press:.98`;
const OFF_VARS = "--mb-dur:0ms;--mb-dur-slow:0ms;--mb-press:1";

/** Shared rules: hover/press feedback, panel/dialog appear. All durations come from the variables, so 0ms disables them. */
const SHARED_RULES = [
  "@keyframes mb-fade-in{from{opacity:0}}",
  "@keyframes mb-pop-in{from{opacity:0;transform:translateY(4px) scale(.98)}}",
  "button,select,input,textarea,a,summary{transition:background-color var(--mb-dur,160ms) var(--mb-ease,ease),color var(--mb-dur,160ms) var(--mb-ease,ease),border-color var(--mb-dur,160ms) var(--mb-ease,ease),box-shadow var(--mb-dur,160ms) var(--mb-ease,ease),opacity var(--mb-dur,160ms) var(--mb-ease,ease),transform var(--mb-dur,160ms) var(--mb-ease,ease)}",
  "button:active:not(:disabled){transform:scale(var(--mb-press,.98))}",
  "body{transition:background-color var(--mb-dur,160ms) var(--mb-ease,ease),color var(--mb-dur,160ms) var(--mb-ease,ease)}",
  ".panel:not([hidden]){animation:mb-fade-in var(--mb-dur,160ms) var(--mb-ease,ease) both}",
  "dialog[open]{animation:mb-pop-in var(--mb-dur,160ms) var(--mb-ease,ease) both}",
  ".empty,.status-message:not([hidden]){animation:mb-fade-in var(--mb-dur-slow,240ms) var(--mb-ease,ease) both}",
  // Overlay views (find, palette, notes, glance): the main process adds mb-in after the view is attached, mb-out before it is removed.
  "[data-mb-overlay]{--mb-from:translateY(-4px) scale(.98)}",
  "[data-mb-overlay=pop-up]{--mb-from:translateY(4px) scale(.98)}",
  "[data-mb-overlay=slide-right]{--mb-from:translateX(12px)}",
  "[data-mb-overlay=fade]{--mb-from:none}",
  "@keyframes mb-overlay-in{from{opacity:0;transform:var(--mb-from)}}",
  "@keyframes mb-reveal{to{opacity:1}}",
  "body:not(.mb-in) [data-mb-overlay]{opacity:0;animation:mb-reveal 0s 1500ms forwards}",
  "body.mb-in [data-mb-overlay]{animation:mb-overlay-in var(--mb-dur,160ms) var(--mb-ease,ease) backwards}",
  // Safety net: transitions with a hard-coded duration are switched off too when animations are off.
  ".mb-no-anim *,.mb-no-anim *::before,.mb-no-anim *::after{transition-duration:0s!important;transition-delay:0s!important}",
  "body.mb-out [data-mb-overlay]{opacity:0;transform:var(--mb-from);transition:opacity var(--mb-dur,160ms) var(--mb-ease,ease),transform var(--mb-dur,160ms) var(--mb-ease,ease)}",
].join("");

export const animationCss = (enabled: boolean): string =>
  `:root{${enabled ? ON_VARS : OFF_VARS}}@media (prefers-reduced-motion:reduce){:root{${OFF_VARS}}}${SHARED_RULES}`;
