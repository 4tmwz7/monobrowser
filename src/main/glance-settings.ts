export type GlanceTrigger = "alt" | "ctrl" | "shift" | "longpress";

export type GlanceSettings = {
  enabled: boolean;
  trigger: GlanceTrigger;
};

export const GLANCE_TRIGGERS: readonly GlanceTrigger[] = ["alt", "ctrl", "shift", "longpress"];

export const DEFAULT_GLANCE_SETTINGS: GlanceSettings = {
  enabled: true,
  trigger: "alt",
};

export const isGlanceTrigger = (value: unknown): value is GlanceTrigger =>
  typeof value === "string" && (GLANCE_TRIGGERS as readonly string[]).includes(value);

/** Merges a (possibly partial, untrusted) patch over the current settings, ignoring invalid fields. */
export const mergeGlanceSettings = (current: GlanceSettings, patch: unknown): GlanceSettings => {
  if (typeof patch !== "object" || patch === null) {
    return { ...current };
  }
  const raw = patch as Record<string, unknown>;
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : current.enabled,
    trigger: isGlanceTrigger(raw.trigger) ? raw.trigger : current.trigger,
  };
};

export const normalizeGlanceSettings = (value: unknown): GlanceSettings =>
  mergeGlanceSettings(DEFAULT_GLANCE_SETTINGS, value);
