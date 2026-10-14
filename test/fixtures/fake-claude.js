#!/usr/bin/env node
'use strict';
// Stand-in for the `claude` CLI in tests: prints what it was asked, then edits the note it was told the user
// is looking at (appends a line) and creates a new note file, so the import path is exercised end to end.
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const p = args.indexOf('-p');
const prompt = p !== -1 ? args[p + 1] : '';
process.stdout.write('fake claude: cwd=' + process.cwd() + '\n');
process.stdout.write('prompt length=' + prompt.length + '\n');
const m = /looking at "([^"]+)"/.exec(prompt);
if (m) {
  const target = path.resolve(process.cwd(), m[1]);
  if (fs.existsSync(target)) {
    fs.appendFileSync(target, '\n- added by the bot\n');
    process.stdout.write('edited ' + m[1] + '\n');
  }
}
fs.writeFileSync(path.join(process.cwd(), 'Bot created this.md'), '# Bot created this\n\nhello\n');
process.stdout.write('created Bot created this.md\n');
process.stdout.write('done\n');
process.exit(0);
