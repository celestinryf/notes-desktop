import { state } from './state.ts';

export const traceClock = () => Math.round((performance.timeOrigin + performance.now()) * 10) / 10;

export function craftTrace(event: string, fields?: TraceFields) {
  if (!state.info || !state.info.craftTrace) return;
  window.notesApi.app.trace(event, Object.assign({ t: traceClock() }, fields));
}
