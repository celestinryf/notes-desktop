import { state } from './state.ts';
import { traceClock } from '../shared/helpers.mts';

export function craftTrace(event: string, fields?: TraceFields) {
  if (!state.info || !state.info.craftTrace) return;
  window.notesApi.app.trace(event, Object.assign({ t: traceClock() }, fields));
}
