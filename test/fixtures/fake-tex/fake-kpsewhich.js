'use strict';
if (process.env.FAKE_KPSEWHICH_FAILS) process.exit(3);
process.stdout.write('C:/fake-tex/texmf\n');
