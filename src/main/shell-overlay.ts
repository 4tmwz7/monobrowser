// Tracks whether any overlay view (menu popup, extension popup, prompt, palette, notes, find, glance...) lies above the
// window. On Windows the shell document's `-webkit-app-region: drag` areas are reported to the window as the title bar
// even where a child WebContentsView covers them, so while an overlay is open the shell drops every drag region
// (body.overlay-open) and the overlay receives its hover/clicks. `onChange` fires only when the combined state flips.

export type OverlayTracker<V> = {
  /** A view went on top of the window (or was raised again). */
  addView: (view: V) => void;
  /** A view left the window. */
  removeView: (view: V) => void;
  /** A popup that is not a tracked view (the menu popup slot, the extension popup): true while it is open. */
  setFlag: (name: string, open: boolean) => void;
  /** Drops views that are no longer live (destroyed / detached without removeView) and re-evaluates the state. */
  refresh: () => void;
  isOpen: () => boolean;
};

export const createOverlayTracker = <V>(onChange: (open: boolean) => void, isLive: (view: V) => boolean = () => true): OverlayTracker<V> => {
  const views = new Set<V>();
  const flags = new Set<string>();
  let last = false;
  const sync = (): void => {
    for (const view of views) if (!isLive(view)) views.delete(view);
    const open = views.size > 0 || flags.size > 0;
    if (open === last) return;
    last = open;
    onChange(open);
  };
  return {
    addView: (view) => { views.add(view); sync(); },
    removeView: (view) => { views.delete(view); sync(); },
    setFlag: (name, open) => { if (open) flags.add(name); else flags.delete(name); sync(); },
    refresh: sync,
    isOpen: () => last,
  };
};
