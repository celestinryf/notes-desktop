export const SLOW_NOTICE_MS = 400;

export function noticeIfSlow<T>(work: Promise<T>, notice: () => void, ms = SLOW_NOTICE_MS): Promise<T> {
  const timer = setTimeout(notice, ms);
  return work.finally(() => clearTimeout(timer));
}

export function oneAtATime(job: () => Promise<void>) {
  let running: Promise<void> | null = null;
  return () => {
    if (!running) running = job().finally(() => { running = null; });
    return running;
  };
}
