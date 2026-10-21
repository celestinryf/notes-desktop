// @ts-check
'use strict';
/* Runs a worker-thread script once: posts it workerData, resolves with the first message it sends, and gives up after
   timeoutMs. Long or untrusted parsing (PDF text, PDF rewriting) runs this way so it never stalls the app. */
const path = require('path');
const { Worker } = require('worker_threads');

// A hostile file must not be able to take the app's memory with it: the worker's JavaScript heap is capped (the file
// bytes themselves live outside it, and are capped by the callers), and running out ends the worker with an error.
const MAX_WORKER_HEAP_MB = 1024;

function runWorker(script, workerData, timeoutMs, timeoutMessage) {
  return new Promise((resolve, reject) => {
    const w = new Worker(path.join(__dirname, script), { workerData, resourceLimits: { maxOldGenerationSizeMb: MAX_WORKER_HEAP_MB } });
    const timer = setTimeout(() => { w.terminate(); reject(new Error(timeoutMessage || 'This took too long.')); }, timeoutMs);
    w.once('message', (m) => { clearTimeout(timer); w.terminate(); resolve(m); });
    w.once('error', (err) => { clearTimeout(timer); w.terminate(); reject(/memory/i.test(err.message) ? new Error('This file needs too much memory to process.') : err); });
    // Ended without answering (a no-op after a message or an error has settled the promise).
    w.once('exit', () => { clearTimeout(timer); reject(new Error('The worker stopped before it finished.')); });
  });
}

module.exports = { runWorker };
