'use strict';
const fs = require('fs');
const path = require('path');
const idx = process.argv.slice(2).filter((a) => !a.startsWith('-')).pop();
if (!idx || !idx.endsWith('.idx')) process.exit(2);
fs.writeFileSync(path.join(process.cwd(), idx.slice(0, -'.idx'.length) + '.ind'), '\\begin{theindex}\n\\end{theindex}\n');
