// Toggle semantics for extension toolbar popups. Clicking the toolbar icon of an open popup first blurs the popup
// (the click moves focus to the shell), which dismisses it; the click itself then arrives and would open it again.
// A popup dismissed by an outside click/blur therefore remembers when and which extension it belonged to, and a
// re-open of the same extension right after is ignored: the second click closes the popup, as users expect.
// No Electron imports so it is unit-testable.

/** A re-open of the same extension within this window after an outside dismissal is the click that caused it. */
export const REOPEN_GUARD_MS = 300;

export type OutsideClose = { extensionId: string; at: number };

export const shouldIgnoreReopen = (last: OutsideClose | null, extensionId: string, now: number): boolean =>
  last !== null && last.extensionId === extensionId && now - last.at >= 0 && now - last.at < REOPEN_GUARD_MS;
