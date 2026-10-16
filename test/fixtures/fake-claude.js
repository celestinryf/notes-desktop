#!/usr/bin/env node
'use strict';
// Stand-in for the `claude` CLI in tests: prints what it was asked, then edits the note it was told the user
// is looking at (appends a line) and creates a new note file, so the import path is exercised end to end.
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
// `claude auth status`: FAKE_CLAUDE_AUTH picks the sign-in it reports (default: a claude.ai subscription).
if (args[0] === 'auth' && args[1] === 'status') {
  const kind = process.env.FAKE_CLAUDE_AUTH || 'claude.ai';
  const status = kind === 'none' ? { loggedIn: false } : { loggedIn: true, authMethod: kind, apiProvider: 'firstParty', subscriptionType: kind === 'claude.ai' ? 'max' : null };
  process.stdout.write(JSON.stringify(status, null, 2) + '\n');
  process.exit(0);
}
// Proves the app keeps API-billing variables away from the agent.
process.stdout.write('api key env: ' + (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? 'present' : 'absent') + '\n');
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
