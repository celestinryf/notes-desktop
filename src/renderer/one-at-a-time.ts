// Runs fn(opts) for each call, one call at a time and in order (each waits for the one before). Used for saving a
// PDF's or a Word document's edits, which must never overlap.
export function oneAtATime(fn) {
  let queue = Promise.resolve(true);
  return (opts) => {
    const run = queue.then(() => fn(opts || {}));
    queue = run.catch(() => false);
    return run;
  };
}
