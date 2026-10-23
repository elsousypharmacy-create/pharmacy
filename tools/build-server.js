// Builds the single-file server/Code.js from server/src/*.js (order = server/files.json).
// server/Code.js stays a complete single-file server because the live updater (serverUpdate)
// fetches only that file from GitHub. usage: node tools/build-server.js [--check]
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'server');
const list = JSON.parse(fs.readFileSync(path.join(dir, 'files.json'), 'utf8'));
const out = list.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n') + '\n';
const target = path.join(dir, 'Code.js');
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8') !== out) { console.error('server/Code.js is out of date: run node tools/build-server.js'); process.exit(1); }
  console.log('OK: server/Code.js matches server/src'); 
} else { fs.writeFileSync(target, out); console.log('built', target, out.length, 'bytes'); }
