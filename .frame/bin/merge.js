#!/usr/bin/env node
// Frame orchestration command — auto-generated. Talks to Frame via $FRAME_ORCH_BUS.
const fs = require('fs');
const path = require('path');
const BUS = process.env.FRAME_ORCH_BUS;
if (!BUS) {
  console.error('FRAME_ORCH_BUS not set — run this from inside a Frame orchestration session.');
  process.exit(2);
}

const type = "merge";
const slug = process.argv[2] || process.env.FRAME_ORCH_SLUG || '';
if (!slug) {
  console.error('usage: ' + path.basename(process.argv[1]) + ' <spec-slug>');
  process.exit(2);
}
const req = { type, slug, args: process.argv.slice(3), ts: new Date().toISOString(), pid: process.pid };
try { fs.mkdirSync(BUS, { recursive: true }); } catch (e) {}
const name = Date.now() + '-' + type + '-' + Math.random().toString(36).slice(2, 8) + '.json';
const dest = path.join(BUS, name);
const tmp = dest + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(req));
fs.renameSync(tmp, dest); // atomic publish — the watcher only ever sees complete files
console.log('[frame] ' + type + ' request queued for "' + slug + '"');
