import fs from 'node:fs';
import path from 'node:path';
import { isRecord, traceClock } from './shared/helpers.mts';

const MAX_FIELDS = 20;
const MAX_TEXT = 200;
const MAX_NAME = 40;

function traceFields(value: unknown): TraceFields {
  const fields: TraceFields = {};
  if (!isRecord(value)) return fields;
  for (const [key, v] of Object.entries(value).slice(0, MAX_FIELDS)) {
    if (key.length > MAX_NAME || key === '__proto__') continue;
    if (typeof v === 'string') fields[key] = v.slice(0, MAX_TEXT);
    else if ((typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean' || v === null) fields[key] = v;
  }
  return fields;
}

function createCraftTrace(dataDir: string, enabled: boolean) {
  const file = path.join(dataDir, 'craft-trace.jsonl');
  if (enabled) {
    try { fs.mkdirSync(dataDir, { recursive: true }); } catch (_) {  }
  }
  function write(event: string, fields?: TraceFields) {
    if (!enabled) return;
    const line = JSON.stringify(Object.assign({ t: traceClock() }, fields, { event })) + '\n';
    try { fs.appendFileSync(file, line); } catch (_) {  }
  }
  function fromPage(event: unknown, fields: unknown) {
    if (!enabled || typeof event !== 'string' || !event || event.length > MAX_NAME) return;
    write(event, Object.assign(traceFields(fields), { from: 'page' }));
  }
  return { enabled, file, write, fromPage };
}

export { createCraftTrace };
