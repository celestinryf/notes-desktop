export const HINT_MS = 5000;

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
  function hint(id: string, message: string) {
    const seen = deps.shown();
    if (!seen || seen.includes(id) || shownNow.has(id)) return false;
    if (deps.canShow && !deps.canShow()) return false;
    shownNow.add(id);
    deps.show(message);
    clearTimeout(timer);
    timer = setTimeout(deps.hide, HINT_MS);
    deps.remember(Array.from(new Set([...seen, ...shownNow])));
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
  return { hint, dismiss, forget };
}
