import { el, I } from './dom.ts';

export interface Activity { text: string; icon: string; stop: () => void; stopLabel: string }
interface ActivityEntry { chip: HTMLButtonElement; text: HTMLSpanElement; a: Activity }
const activities = new Map<string, ActivityEntry>();
export function setActivity(key: string, a: Activity | null) {
  const had = activities.get(key);
  if (!a) { if (had) { had.chip.remove(); activities.delete(key); } return; }
  if (had) {
    had.a = a;
    had.text.textContent = a.text;
    had.chip.title = a.stopLabel;
    return;
  }
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'activity-chip';
  chip.title = a.stopLabel;
  chip.innerHTML = '<span class="activity-dot" aria-hidden="true"></span>' + I(a.icon) + '<span class="activity-text"></span>' + I('x');
  const text = document.createElement('span');
  text.className = 'activity-text';
  text.textContent = a.text;
  chip.innerHTML = chip.innerHTML.replace('<span class="activity-text"></span>', '');
  chip.insertBefore(text, chip.lastElementChild);
  const entry = { chip, text, a };
  chip.addEventListener('click', () => entry.a.stop());
  activities.set(key, entry);
  el.activityBar.append(chip);
}
