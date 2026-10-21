import { el, I } from './dom.js';

// A long-running mode must stay visible and stoppable while its menu is closed.

const activities = new Map(); // key -> { chip, a }
export function setActivity(key, a) {
  const had = activities.get(key);
  if (!a) { if (had) { had.chip.remove(); activities.delete(key); } return; }
  if (had) {
    had.a = a;
    had.chip.querySelector('.activity-text').textContent = a.text;
    had.chip.title = a.stopLabel;
    return;
  }
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'activity-chip';
  chip.title = a.stopLabel;
  chip.innerHTML = '<span class="activity-dot" aria-hidden="true"></span>' + I(a.icon) + '<span class="activity-text"></span>' + I('x');
  chip.querySelector('.activity-text').textContent = a.text;
  const entry = { chip, a };
  chip.addEventListener('click', () => entry.a.stop());
  activities.set(key, entry);
  el.activityBar.append(chip);
}
