'use strict';
const fs = require('fs');
const path = require('path');

const NAMES = [
  'panel-left', 'list', 'folder-tree', 'columns-2', 'ellipsis', 'search', 'command', 'x', 'plus', 'minus',
  'chevron-right', 'chevron-left', 'chevron-down', 'arrow-up', 'arrow-down', 'external-link',
  'square-pen', 'folder-open', 'notebook-text', 'star', 'bell', 'trash-2', 'folder', 'folder-plus', 'book-open',
  'book-plus', 'hash', 'file-text', 'copy', 'rotate-ccw', 'history', 'link', 'pin',
  'code-xml', 'volume-2', 'mic', 'lock', 'lock-open', 'alarm-clock', 'paperclip', 'audio-lines', 'printer',
  'sticky-note', 'bot', 'download', 'share-2', 'replace', 'refresh-cw', 'file-output', 'terminal', 'radio',
  'sun-moon', 'settings', 'check', 'circle-alert', 'save', 'pin-off', 'book', 'mail', 'list-filter', 'arrow-right-left',
  'eye', 'eye-off', 'highlighter', 'type', 'pencil', 'image', 'signature', 'message-square', 'layout-grid', 'undo-2', 'redo-2',
  'zoom-in', 'rotate-cw', 'bold', 'italic', 'underline', 'square-stack', 'palette',
  'cloud-check', 'cloud-upload', 'cloud-alert', 'globe', 'log-out',
];

const pkg = path.dirname(require.resolve('lucide-static/package.json'));
const version = require('lucide-static/package.json').version;
const out = {};
for (const name of NAMES) {
  const svg = fs.readFileSync(path.join(pkg, 'icons', name + '.svg'), 'utf8');
  const inner = /<svg[^>]*>([\s\S]*)<\/svg>/.exec(svg)[1].replace(/\s*\n\s*/g, '').trim();
  out[name] = inner;
}
const file = path.join(__dirname, '..', 'src', 'renderer', 'icons.js');
fs.writeFileSync(file, `// @ts-check
'use strict';
/* lucide-static ${version}, ISC licence, Copyright (c) Lucide Icons and Contributors */
(function () {
  /** @type {Record<string, string>} */
  const PATHS = ${JSON.stringify(out, null, 2)};
  /**
   * @param {string} name
   * @param {number} [size]
   */
  function svg(name, size) {
    const body = PATHS[name];
    if (!body) throw new Error('Unknown icon: ' + name);
    const s = size || 16;
    return '<svg class="icon" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + body + '</svg>';
  }
  /**
   * @param {Element | null} node
   * @returns {node is HTMLElement | SVGElement}
   */
  function hasDataset(node) {
    return node instanceof HTMLElement || node instanceof SVGElement;
  }
  /** @param {ParentNode | null} [root] */
  function hydrate(root) {
    (root || document).querySelectorAll('[data-icon]').forEach((el) => {
      if (!hasDataset(el)) return;
      const first = el.firstElementChild;
      const firstIcon = hasDataset(first) && first.classList.contains('icon') ? first : null;
      if (firstIcon && firstIcon.dataset.name === el.dataset.icon) return;
      if (firstIcon) firstIcon.remove();
      el.insertAdjacentHTML('afterbegin', svg(String(el.dataset.icon)));
      const inserted = el.firstElementChild;
      if (hasDataset(inserted)) inserted.dataset.name = el.dataset.icon;
    });
  }
  const api = { svg, hydrate, names: Object.keys(PATHS) };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else window.NotesIcons = api;
})();
`);
console.log('wrote ' + file + ' (' + NAMES.length + ' icons)');
