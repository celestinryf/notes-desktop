import type { App, BrowserWindow } from 'electron';

export const GHOST_SWITCHES: [string, string][] = [['disable-features', 'CalculateNativeWinOcclusion']];

type GhostWindow = Pick<BrowserWindow, 'setOpacity' | 'setIgnoreMouseEvents' | 'setSkipTaskbar'>;
type GhostApp = Pick<App, 'on'> & { commandLine: Pick<App['commandLine'], 'appendSwitch'> };

export function ghost(w: GhostWindow) {
  w.setOpacity(0);
  w.setIgnoreMouseEvents(true);
  w.setSkipTaskbar(true);
}

export function ghostEveryWindow(app: GhostApp) {
  for (const [name, value] of GHOST_SWITCHES) app.commandLine.appendSwitch(name, value);
  app.on('browser-window-created', (_event, w) => ghost(w));
}
