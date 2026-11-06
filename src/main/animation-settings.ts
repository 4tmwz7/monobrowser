// UI animations: persisted on/off + intensity setting plus the shared CSS (--mb-dur / --mb-ease contract) that every
// themed surface (shell, overlays, popups, internal pages) receives together with the theme tokens.
// Pure module (no Electron imports) so it can be unit-tested.

/** "subtle": shorter, no overshoot, no stagger. "full": the default springy motion. */
export type AnimationLevel = "subtle" | "full";
export type AnimationSettings = { enabled: boolean; level: AnimationLevel };

export const ANIMATION_LEVELS: readonly AnimationLevel[] = ["subtle", "full"];
export const DEFAULT_ANIMATION_SETTINGS: AnimationSettings = { enabled: true, level: "full" };

export const normalizeAnimationSettings = (value: unknown): AnimationSettings => {
  if (typeof value !== "object" || value === null) return { ...DEFAULT_ANIMATION_SETTINGS };
  const { enabled, level } = value as Record<string, unknown>;
  return {
    enabled: typeof enabled === "boolean" ? enabled : DEFAULT_ANIMATION_SETTINGS.enabled,
    level: ANIMATION_LEVELS.includes(level as AnimationLevel) ? (level as AnimationLevel) : DEFAULT_ANIMATION_SETTINGS.level,
  };
};

/** Effective state: the setting, unless the OS asks for reduced motion or the environment disables animations (e2e). */
let effectiveEnabled = true;
let effectiveLevel: AnimationLevel = "full";
export const setAnimationsEffective = (enabled: boolean, level: AnimationLevel = effectiveLevel): void => { effectiveEnabled = enabled; effectiveLevel = level; };
export const areAnimationsEffective = (): boolean => effectiveEnabled;
export const getAnimationLevel = (): AnimationLevel => effectiveLevel;

/** "Fast" duration (hover/press and every exit) per level, in ms: the single source for the CSS variable and for the main process timers. */
export const FAST_DURATION_MS: Record<AnimationLevel, number> = { full: 120, subtle: 90 };
/** Margin on top of a fade-out transition before its view is hidden/removed (the script that starts it is asynchronous). */
const FADE_OUT_MARGIN_MS = 30;
/** How long an overlay view must stay up to finish its exit transition; 0 when animations are off (remove at once). */
export const overlayFadeOutMs = (): number => (effectiveEnabled ? FAST_DURATION_MS[effectiveLevel] + FADE_OUT_MARGIN_MS : 0);

export const resolveAnimationsEffective = (settings: AnimationSettings, prefersReducedMotion: boolean, envDisabled: boolean): boolean =>
  settings.enabled && !prefersReducedMotion && !envDisabled;

// Timing contract: fast (120 ms) = hover/press and every exit, base (180 ms) = enter, slow (320 ms) = layout moves
// (sidebar, tab strip). Entering uses a decelerating curve (optionally with a small overshoot), leaving an accelerating one.
const EASE = "cubic-bezier(.22,1,.36,1)";
const EASE_IN = "cubic-bezier(.4,0,1,1)";
const FULL_VARS = `--mb-dur-fast:${FAST_DURATION_MS.full}ms;--mb-dur:180ms;--mb-dur-slow:320ms;--mb-ease:${EASE};--mb-ease-in:${EASE_IN};--mb-spring:cubic-bezier(.34,1.32,.64,1);--mb-press:.98;--mb-stagger:24ms;--mb-shift:8px;--mb-scale-from:.96;--mb-on:1`;
const SUBTLE_VARS = `--mb-dur-fast:${FAST_DURATION_MS.subtle}ms;--mb-dur:130ms;--mb-dur-slow:220ms;--mb-ease:${EASE};--mb-ease-in:${EASE_IN};--mb-spring:${EASE};--mb-press:.99;--mb-stagger:0ms;--mb-shift:4px;--mb-scale-from:.98;--mb-on:1`;
const OFF_VARS = "--mb-dur-fast:0ms;--mb-dur:0ms;--mb-dur-slow:0ms;--mb-press:1;--mb-stagger:0ms;--mb-shift:0px;--mb-scale-from:1;--mb-on:0";

/** Shared rules: hover/press feedback, panel/dialog appear. All durations come from the variables, so 0ms disables them. */
const SHARED_RULES = [
  "@keyframes mb-fade-in{from{opacity:0}}",
  "@keyframes mb-pop-in{from{opacity:0;transform:translateY(calc(var(--mb-shift,8px)*.75)) scale(var(--mb-scale-from,.96))}}",
  // Staggered entrance of page blocks (cards of an internal page, parts of the start page).
  "@keyframes mb-rise{from{opacity:0;transform:translateY(var(--mb-shift,8px))}}",
  "button,select,input,textarea,a,summary{transition:background-color var(--mb-dur-fast,120ms) var(--mb-ease,ease),color var(--mb-dur-fast,120ms) var(--mb-ease,ease),border-color var(--mb-dur-fast,120ms) var(--mb-ease,ease),box-shadow var(--mb-dur-fast,120ms) var(--mb-ease,ease),opacity var(--mb-dur-fast,120ms) var(--mb-ease,ease),transform var(--mb-dur-fast,120ms) var(--mb-ease,ease)}",
  "button:active:not(:disabled){transform:scale(var(--mb-press,.98))}",
  "body{transition:background-color var(--mb-dur,180ms) var(--mb-ease,ease),color var(--mb-dur,180ms) var(--mb-ease,ease)}",
  ".panel:not([hidden]){animation:mb-fade-in var(--mb-dur,180ms) var(--mb-ease,ease) both}",
  // sibling-index() is unsupported in old engines: the delay is then invalid at computed-value time and falls back to 0.
  ".panel:not([hidden])>:is(.card,section),main>.card{animation:mb-rise var(--mb-dur-slow,320ms) var(--mb-ease,ease) backwards;animation-delay:calc(min(sibling-index(),6)*var(--mb-stagger,0ms))}",
  "dialog[open]{animation:mb-pop-in var(--mb-dur,180ms) var(--mb-spring,var(--mb-ease,ease)) both}",
  ".empty,.status-message:not([hidden]){animation:mb-fade-in var(--mb-dur-slow,320ms) var(--mb-ease,ease) both}",
  // Overlay views (find, palette, notes, glance): the main process adds mb-in after the view is attached, mb-out before it is removed.
  "[data-mb-overlay]{--mb-from:translateY(-4px) scale(.98)}",
  "[data-mb-overlay=pop-up]{--mb-from:translateY(4px) scale(.98)}",
  "[data-mb-overlay=slide-right]{--mb-from:translateX(12px)}",
  "[data-mb-overlay=fade]{--mb-from:none}",
  "@keyframes mb-overlay-in{from{opacity:0;transform:var(--mb-from)}}",
  "@keyframes mb-reveal{to{opacity:1}}",
  "body:not(.mb-in) [data-mb-overlay]{opacity:0;animation:mb-reveal 0s 1500ms forwards}",
  "body.mb-in [data-mb-overlay]{animation:mb-overlay-in var(--mb-dur,180ms) var(--mb-spring,var(--mb-ease,ease)) backwards}",
  // Safety net: transitions with a hard-coded duration are switched off too when animations are off.
  ".mb-no-anim *,.mb-no-anim *::before,.mb-no-anim *::after{transition-duration:0s!important;transition-delay:0s!important}",
  "body.mb-out [data-mb-overlay]{opacity:0;transform:var(--mb-from);transition:opacity var(--mb-dur-fast,120ms) var(--mb-ease-in,ease),transform var(--mb-dur-fast,120ms) var(--mb-ease-in,ease)}",
].join("");

export const animationCss = (enabled: boolean, level: AnimationLevel = "full"): string =>
  `:root{${enabled ? (level === "subtle" ? SUBTLE_VARS : FULL_VARS) : OFF_VARS}}@media (prefers-reduced-motion:reduce){:root{${OFF_VARS}}}${SHARED_RULES}`;
