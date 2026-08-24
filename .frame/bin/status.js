#!/usr/bin/env node
// Frame orchestration command — auto-generated. Talks to Frame via $FRAME_ORCH_BUS.
const fs = require('fs');
const path = require('path');
const BUS = process.env.FRAME_ORCH_BUS;
if (!BUS) {
  console.error('FRAME_ORCH_BUS not set — run this from inside a Frame orchestration session.');
  process.exit(2);
}

const statePath = path.join(BUS, 'state.json');
try {
  const raw = fs.readFileSync(statePath, 'utf8');
  process.stdout.write(raw.endsWith('\n') ? raw : raw + '\n');
} catch (e) {
  console.log('{}'); // no session state yet
}
