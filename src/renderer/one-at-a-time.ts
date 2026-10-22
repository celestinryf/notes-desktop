export interface FlushOptions { commit?: boolean; explicit?: boolean }
export function oneAtATime<R>(fn: (opts: FlushOptions) => R | Promise<R>) {
  let queue: Promise<unknown> = Promise.resolve(true);
  return (opts?: FlushOptions) => {
    const run = queue.then(() => fn(opts || {}));
    queue = run.catch(() => false);
    return run;
  };
}
