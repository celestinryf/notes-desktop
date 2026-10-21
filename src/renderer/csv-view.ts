'use strict';
/* CSV and TSV files as a table. Read-only: editing is in the text view (Ctrl+E), so the file is never rewritten by
   looking at it. Parsing follows RFC 4180 (quoted fields may hold the delimiter, line breaks and doubled quotes) and is
   lenient about the rest. Every cell is set with textContent, never as HTML.

   NotesCsv.render(container, text, ext) */
export const NotesCsv = (function () {
  const MAX_ROWS = 2000; // rows drawn; the rest are counted and the text view has them all
  const MAX_COLS = 200;
  const MAX_CELLS = 60000; // a wide file draws fewer rows, so the page never builds a huge table at once
  const NUMBER = /^[-+]?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?%?$/;

  // The delimiter: a tab for .tsv; otherwise whichever of , ; and tab is most common outside quotes on the first line.
  function detectDelimiter(text, ext) {
    if (ext === 'tsv') return '\t';
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') quoted = !quoted;
      else if (!quoted && (c === '\n' || c === '\r')) break;
      else if (!quoted && c in counts) counts[c]++;
    }
    return Object.keys(counts).reduce((best, d) => (counts[d] > counts[best] ? d : best), ',');
  }

  // Rows of fields, the first `limit` kept; total counts them all. Each row knows the text line it starts on (a quoted
  // field can span lines), so the table's numbers are the text view's line numbers.
  type Row = string[] & { line?: number };
  function parse(text, delim, limit) {
    const rows: Row[] = [];
    let row: Row = [];
    let field = '', quoted = false, total = 0, line = 1, rowLine = 1;
    const endRow = () => { row.push(field); field = ''; total++; if (rows.length < limit) { row.line = rowLine; rows.push(row); } row = []; rowLine = line; };
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '\n') line++;
      if (quoted) {
        if (c === '\r' && text[i + 1] !== '\n') line++;
        if (c !== '"') field += c;
        else if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
        continue;
      }
      if (c === '"' && field === '') quoted = true; // a quote opens a field only at its start
      else if (c === delim) { row.push(field); field = ''; }
      else if (c === '\r') { if (text[i + 1] === '\n') { i++; line++; } else line++; endRow(); }
      else if (c === '\n') endRow();
      else field += c;
    }
    if (field !== '' || row.length) endRow(); // a last line without a line break
    return { rows, total };
  }

  const note = (text) => Object.assign(document.createElement('p'), { className: 'csv-note', textContent: text });
  const cell = (tag, text, className) => {
    const c = document.createElement(tag);
    c.textContent = text;
    if (className) c.className = className;
    if (text.length > 30) c.title = text; // long values are cut short in the cell; the whole of it on hover
    return c;
  };

  // Draws the table and returns its counts: { rows (data rows, all of them), cols }.
  function render(container, text, ext) {
    container.replaceChildren();
    const src = String(text || '');
    const { rows, total } = parse(src, detectDelimiter(src, ext), MAX_ROWS + 1);
    if (!rows.length || (rows.length === 1 && rows[0].length === 1 && rows[0][0] === '')) {
      container.append(note('This file is empty. Switch to Text (Ctrl+E) to write in it.'));
      return { rows: 0, cols: 0 };
    }
    const widest = rows.reduce((n, r) => Math.max(n, r.length), 0);
    const cols = Math.min(widest, MAX_COLS);
    const shown = rows.slice(1, 1 + Math.max(1, Math.floor(MAX_CELLS / Math.max(cols, 1))));
    // A column of numbers is right-aligned as a whole, its header too: most of its filled cells must be numbers.
    const numeric = Array.from({ length: cols }, (_, c) => {
      let filled = 0, nums = 0;
      for (const r of shown) { const v = (r[c] || '').trim(); if (!v) continue; filled++; if (NUMBER.test(v)) nums++; }
      return filled > 0 && nums / filled >= 0.8;
    });
    const table = document.createElement('table');
    table.className = 'csv-table';
    const head = document.createElement('tr');
    const corner = cell('th', String(rows[0].line), 'rownum');
    head.append(corner);
    for (let c = 0; c < cols; c++) { const th = cell('th', rows[0][c] || '', numeric[c] ? 'num' : ''); th.scope = 'col'; head.append(th); }
    const thead = document.createElement('thead');
    thead.append(head);
    const tbody = document.createElement('tbody');
    for (const r of shown) {
      const tr = document.createElement('tr');
      const num = cell('th', String(r.line), 'rownum');
      num.scope = 'row';
      tr.append(num);
      for (let c = 0; c < cols; c++) tr.append(cell('td', r[c] || '', numeric[c] ? 'num' : ''));
      tbody.append(tr);
    }
    table.append(thead, tbody);
    container.append(table);
    const rest: (string)[] = [];
    if (total - 1 > shown.length) rest.push('the first ' + shown.length.toLocaleString() + ' rows of ' + (total - 1).toLocaleString());
    if (widest > cols) rest.push('the first ' + cols + ' columns of ' + widest);
    if (rest.length) container.append(note('Showing ' + rest.join(', and ') + '. Switch to Text (Ctrl+E) to see and edit all of it.'));
    return { rows: total - 1, cols: widest };
  }

  return { detectDelimiter, parse, render };
})();
