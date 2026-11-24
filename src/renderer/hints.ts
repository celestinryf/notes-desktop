export const HINT_MS = 5000;

export const HINT = { palette: 'palette', sidebar: 'sidebar-hidden', find: 'find-options' } as const;
export const ALL_HINTS: readonly string[] = Object.values(HINT);

export type HintDeps = {
  shown: () => readonly string[] | null;
  remember: (ids: string[]) => unknown;
  show: (message: string) => void;
  hide: () => void;
  canShow?: () => boolean;
};

export function createHints(deps: HintDeps) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const shownNow = new Set<string>();
  function seen(id: string) {
    const ids = deps.shown();
    return !ids || ids.includes(id) || shownNow.has(id);
  }
  function hint(id: string, message: string) {
    if (seen(id)) return false;
    if (deps.canShow && !deps.canShow()) return false;
    shownNow.add(id);
    deps.show(message);
    clearTimeout(timer);
    timer = setTimeout(deps.hide, HINT_MS);
    deps.remember(Array.from(new Set([...(deps.shown() ?? []), ...shownNow])));
    return true;
  }
  function dismiss() {
    clearTimeout(timer);
    deps.hide();
  }
  function forget() {
    shownNow.clear();
    deps.remember([]);
  }
  return { hint, seen, dismiss, forget };
}
