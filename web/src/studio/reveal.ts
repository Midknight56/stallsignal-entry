export interface RevealTarget {
  tabIndex: number;
  hasAttribute(name: string): boolean;
  scrollIntoView(options?: ScrollIntoViewOptions): void;
  focus(options?: FocusOptions): void;
}

// Scroll a widget the visitor just added into view and move focus to its title. The widget may not be drawn yet,
// so look again on each animation frame, at most 20 frames.
export function revealWidget(
  find: () => RevealTarget | null,
  frame: (next: () => void) => void,
  tries = 0,
): boolean {
  const el = find();
  if (!el) {
    if (tries < 20) frame(() => revealWidget(find, frame, tries + 1));
    return false;
  }
  el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  if (!el.hasAttribute('tabindex')) el.tabIndex = -1;
  el.focus({ preventScroll: true });
  return true;
}

// The title of the newest widget with this title, inside the Studio canvas.
export function widgetTitle(title: string): HTMLElement | null {
  const canvas = document.querySelector('.studio-canvas');
  if (!canvas) return null;
  const hits = Array.from(canvas.querySelectorAll<HTMLElement>('*')).filter(
    (n) => n.childElementCount === 0 && n.textContent?.trim() === title,
  );
  return hits[hits.length - 1] ?? null;
}
