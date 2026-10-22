import path from 'node:path';
import { Worker } from 'node:worker_threads';

const MAX_WORKER_HEAP_MB = 1024;

type WorkerReply<T> = ({ ok: true } & T) | { ok: false, error: string };

function runWorker<T>(script: string, workerData: unknown, timeoutMs: number, timeoutMessage?: string): Promise<WorkerReply<T>> {
  return new Promise((resolve, reject) => {
    const w = new Worker(path.join(import.meta.dirname, script), { workerData, resourceLimits: { maxOldGenerationSizeMb: MAX_WORKER_HEAP_MB } });
    const timer = setTimeout(() => { w.terminate(); reject(new Error(timeoutMessage || 'This took too long.')); }, timeoutMs);
    w.once('message', (m) => { clearTimeout(timer); w.terminate(); resolve(m); });
    w.once('error', (err) => { clearTimeout(timer); w.terminate(); reject(/memory/i.test(err.message) ? new Error('This file needs too much memory to process.') : err); });
    w.once('exit', () => { clearTimeout(timer); reject(new Error('The worker stopped before it finished.')); });
  });
}

export { runWorker };
export type { WorkerReply };
