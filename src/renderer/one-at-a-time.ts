// Runs fn(opts) for each call, one call at a time and in order (each waits for the one before). Used for saving a
// PDF's or a Word document's edits, which must never overlap.
export interface FlushOptions { commit?: boolean; explicit?: boolean }
export function oneAtATime<R>(fn: (opts: FlushOptions) => R | Promise<R>) {
  let queue: Promise<unknown> = Promise.resolve(true);
  return (opts?: FlushOptions) => {
    const run = queue.then(() => fn(opts || {}));
    queue = run.catch(() => false);
    return run;
  };
}
