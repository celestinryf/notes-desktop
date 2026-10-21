// @ts-check
export function toLocalInputValue(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

export function quickPick(kind) {
  const d = new Date();
  d.setSeconds(0, 0);
  if (kind === '1h') { d.setTime(d.getTime() + 3600 * 1000); return d.getTime(); }
  if (kind === 'evening') { if (d.getHours() >= 18) d.setDate(d.getDate() + 1); d.setHours(18, 0, 0, 0); return d.getTime(); }
  if (kind === 'tomorrow') { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.getTime(); }
  if (kind === 'monday') { const add = ((8 - d.getDay()) % 7) || 7; d.setDate(d.getDate() + add); d.setHours(9, 0, 0, 0); return d.getTime(); }
  return null;
}
