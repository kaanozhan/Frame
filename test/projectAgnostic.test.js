/**
 * Cross-project fixture suite (T02+). The committed golden STRUCTURE.json in
 * test/fixtures/js-src-app locks today's src/+CJS+npm parser behavior — the
 * backwards-compat guarantee every parser change (T03-T06) must preserve
 * byte-for-byte. T05 extends this file with per-fixture stack assertions.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const PARSER = path.join(REPO_ROOT, 'scripts', 'update-structure.js');
const FIXTURES = path.join(__dirname, 'fixtures');

function runParser(projectRoot, args = []) {
  return spawnSync('node', [PARSER, ...args], {
    env: { ...process.env, FRAME_PROJECT_ROOT: projectRoot },
    encoding: 'utf8'
  });
}

test('golden: js-src-app STRUCTURE.json is in sync with the parser (--check)', () => {
  const res = runParser(path.join(FIXTURES, 'js-src-app'), ['--check']);
  assert.equal(res.status, 0, `--check reported drift:\n${res.stdout}${res.stderr}`);
});

test('golden: full regen on js-src-app copy is byte-identical to the committed golden', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-golden-'));
  try {
    fs.cpSync(path.join(FIXTURES, 'js-src-app'), tmp, { recursive: true });
    const res = runParser(tmp);
    assert.equal(res.status, 0, res.stderr);
    const regenerated = fs.readFileSync(path.join(tmp, 'STRUCTURE.json'), 'utf8');
    const golden = fs.readFileSync(path.join(FIXTURES, 'js-src-app', 'STRUCTURE.json'), 'utf8');
    assert.equal(regenerated, golden);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
