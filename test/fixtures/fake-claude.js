#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
if (args[0] === 'auth' && args[1] === 'status') {
  const kind = process.env.FAKE_CLAUDE_AUTH || 'claude.ai';
  const status = kind === 'none' ? { loggedIn: false } : { loggedIn: true, authMethod: kind, apiProvider: 'firstParty', subscriptionType: kind === 'claude.ai' ? 'max' : null };
  process.stdout.write(JSON.stringify(status, null, 2) + '\n');
  process.exit(0);
}
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
