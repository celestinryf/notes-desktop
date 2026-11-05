import path from 'node:path';

type Shortcut = { target: string, args?: string, appUserModelId?: string };

const samePath = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const unquote = (s: string) => s.trim().replace(/^"(.*)"$/, '$1');

function needsAppId(link: Shortcut, execPath: string, root: string, appId: string) {
  const args = link.args || '';
  if (!link.target || !args.trim()) return false;
  return samePath(link.target, execPath) && samePath(unquote(args), root) && link.appUserModelId !== appId;
}

export type { Shortcut };
export { needsAppId };
