'use strict';
const fs = require('fs');
const path = require('path');
const stem = process.argv.slice(2).filter((a) => !a.startsWith('-')).pop();
if (!stem) process.exit(2);
fs.writeFileSync(path.join(process.cwd(), stem + '.bbl'), '\\begin{thebibliography}{1}\n\\end{thebibliography}\n');
