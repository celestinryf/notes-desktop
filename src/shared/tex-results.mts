export type Tone = 'muted' | 'normal' | 'ok' | 'danger';

export const plural = (n: number, one: string, many?: string) => n.toLocaleString() + ' ' + (n === 1 ? one : many || one + 's');
export const ISSUE_ICON: Record<TexIssue['kind'], string> = { error: 'circle-alert', warning: 'triangle-alert', badbox: 'move-horizontal' };
const ISSUE_ORDER: Record<TexIssue['kind'], number> = { error: 0, warning: 1, badbox: 2 };
export const slashes = (p: string) => p.replace(/\\/g, '/');
export const dirOf = (p: string) => slashes(p).replace(/\/[^/]*$/, '');
export const isWithin = (dir: string, file: string) => slashes(file).toLowerCase().startsWith(slashes(dir).toLowerCase().replace(/\/$/, '') + '/');
export const samePath = (a: string, b: string) => slashes(a).toLowerCase() === slashes(b).toLowerCase();

export function joinPath(dir: string, rel: string) {
  if (/^([A-Za-z]:)?[\\/]/.test(rel)) return slashes(rel);
  const parts = slashes(dir).split('/');
  for (const piece of slashes(rel).split('/')) {
    if (piece === '..') parts.pop();
    else if (piece && piece !== '.') parts.push(piece);
  }
  return parts.join('/');
}

export function statusOf(result: TexCompileResult | null, running: boolean, edited?: boolean): { text: string, tone: Tone, icon: string | null } {
  if (running) return { text: 'Compiling…', tone: 'muted', icon: null };
  if (!result) return { text: 'Not compiled yet', tone: 'muted', icon: null };
  if (!result.ok) {
    if (result.reason === 'no-tex') return { text: 'No TeX found', tone: 'normal', icon: 'triangle-alert' };
    if (result.reason === 'stopped') return { text: 'Stopped', tone: 'muted', icon: null };
    if (result.reason === 'timeout') return { text: 'Stopped after 2 minutes', tone: 'danger', icon: 'circle-alert' };
    return { text: 'Could not compile', tone: 'danger', icon: 'circle-alert' };
  }
  if (result.log.errors) return { text: plural(result.log.errors, 'error'), tone: 'danger', icon: 'circle-alert' };
  if (!result.pdf) return { text: 'No PDF made', tone: 'danger', icon: 'circle-alert' };
  if (edited) return { text: 'Edited since compiling', tone: 'muted', icon: null };
  if (result.log.warnings) return { text: 'Compiled, ' + plural(result.log.warnings, 'warning'), tone: 'ok', icon: 'check' };
  return { text: 'Compiled', tone: 'ok', icon: 'check' };
}

export function sortedIssues(issues: TexIssue[]) {
  return issues.map((issue, i) => ({ issue, i })).sort((a, b) => ISSUE_ORDER[a.issue.kind] - ISSUE_ORDER[b.issue.kind] || a.i - b.i).map((x) => x.issue);
}
