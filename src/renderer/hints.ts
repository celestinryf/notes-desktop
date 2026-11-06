export const HINT_MS = 5000;

export type HintDeps = {
  shown: () => readonly string[] | null;
  remember: (ids: string[]) => unknown;
  show: (message: string) => void;
  hide: () => void;
};

export function createHints(deps: HintDeps) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  function hint(id: string, message: string) {
    const seen = deps.shown();
    if (!seen || seen.includes(id)) return false;
    deps.show(message);
    clearTimeout(timer);
    timer = setTimeout(deps.hide, HINT_MS);
    deps.remember([...seen, id]);
    return true;
  }
  function dismiss() {
    clearTimeout(timer);
    deps.hide();
  }
  function forget() {
    deps.remember([]);
  }
  return { hint, dismiss, forget };
}
