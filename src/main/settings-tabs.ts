// Tabs of the settings page. The page is reloaded when the interface language changes, so the main process
// remembers the active tab (validated here) and the page restores it. Pure module (unit-testable).

export const SETTINGS_TABS = ["search", "browsing", "workspaces", "theme", "experimental"] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const DEFAULT_SETTINGS_TAB: SettingsTab = "search";

export const normalizeSettingsTab = (value: unknown): SettingsTab =>
  SETTINGS_TABS.find((tab) => tab === value) ?? DEFAULT_SETTINGS_TAB;
