import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
const port = parentPort;
if (!port) throw new Error('this script runs in a worker thread only');
const requireWhenNeeded = createRequire(import.meta.url);

(async () => {
  try {
    const mammoth: typeof import('mammoth') = requireWhenNeeded('mammoth');
    const bytes: Uint8Array = workerData.bytes;
    const res = await mammoth.extractRawText({ buffer: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) });
    port.postMessage({ ok: true, body: String(res.value || '') });
  } catch (err) {
    port.postMessage({ ok: false, error: 'Could not read the text of this Word document: ' + err.message });
  }
})();
