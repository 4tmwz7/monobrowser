// First-run onboarding: pure step/state logic (no Electron imports, unit-tested).
// The step functions are also embedded verbatim into the onboarding page script (via toString),
// so they must stay self-contained and reference nothing but their own parameters.

export const ONBOARDING_STEPS = ["welcome", "look", "layout", "privacy", "done"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** Files that prove the browser has been used before (existing users never see the onboarding). */
export const ONBOARDING_MARKER_FILES: readonly string[] = [
  "language.json", "search-settings.json", "layout-settings.json", "glance-settings.json", "adblock-settings.json",
  "animation-settings.json", "startup-settings.json", "session.json", "history.json", "bookmarks.json",
  "downloads.json", "userscripts.json", "stats.json",
];

export const ONBOARDING_FILE = "onboarding.json";

export type OnboardingFlag = { done: boolean };

export const normalizeOnboardingFlag = (value: unknown): OnboardingFlag | null => {
  if (typeof value !== "object" || value === null) return null;
  const done = (value as Record<string, unknown>).done;
  return typeof done === "boolean" ? { done } : null;
};

export const shouldAutoShowOnboarding = (input: { flag: OnboardingFlag | null; existingFiles: readonly string[]; skipEnv: boolean }): boolean => {
  if (input.skipEnv) return false;
  if (input.flag?.done) return false;
  return !input.existingFiles.some((file) => ONBOARDING_MARKER_FILES.includes(file));
};

export const clampStep = (index: unknown): number => {
  const last = ONBOARDING_STEPS.length - 1;
  return typeof index === "number" && Number.isFinite(index) ? Math.min(last, Math.max(0, Math.trunc(index))) : 0;
};

export const nextStep = (index: number, count: number): number => Math.min(count - 1, index + 1);
export const prevStep = (index: number): number => Math.max(0, index - 1);
export const isLastStep = (index: number, count: number): boolean => index >= count - 1;

/** Enter = next, Esc = skip; Enter on a button/link/select keeps its native action. */
export const onboardingKeyAction = (key: string, targetTag: string): "next" | "skip" | null => {
  if (key === "Escape") return "skip";
  if (key === "Enter") return /^(BUTTON|A|SELECT|TEXTAREA)$/.test(targetTag.toUpperCase()) ? null : "next";
  return null;
};
