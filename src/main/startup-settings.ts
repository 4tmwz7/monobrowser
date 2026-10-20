export type StartupMode = "restore" | "newtab";

export type StartupSettings = { startupMode: StartupMode };

export const DEFAULT_STARTUP_SETTINGS: StartupSettings = { startupMode: "restore" };

export const normalizeStartupSettings = (value: unknown): StartupSettings => {
  if (typeof value !== "object" || value === null) return { ...DEFAULT_STARTUP_SETTINGS };
  const mode = (value as Record<string, unknown>).startupMode;
  return { startupMode: mode === "restore" || mode === "newtab" ? mode : DEFAULT_STARTUP_SETTINGS.startupMode };
};
