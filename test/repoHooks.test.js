/**
 * This repository's own Claude Code hooks (.claude/settings.json) run its
 * scripts/*-hint.js by relative path. Claude Code runs a hook in the
 * session's current directory, which follows the agent's `cd`: after
 * `cd src/templates/commands/claude-code` every hook failed with "Cannot
 * find module …/scripts/docs-hint.js". Each command now moves to
 * $CLAUDE_PROJECT_DIR first (hooks-run-from-project-root).
 *
 * The commands run against stand-in scripts in a temp copy, never the
 * repository's real ones, so the test has no side effects here.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const settings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.claude', 'settings.json'), 'utf8'));
const scriptHooks = [];
for (const list of Object.values(settings.hooks)) {
  for (const entry of list) for (const h of entry.hooks) if (/scripts\/[\w-]+\.js/.test(h.command)) scriptHooks.push(h.command);
}

function standIn() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-repohooks-'));
  fs.mkdirSync(path.join(dir, 'scripts'));
  for (const c of scriptHooks) {
    const name = c.match(/scripts\/([\w-]+\.js)/)[1];
    fs.writeFileSync(path.join(dir, 'scripts', name), `process.stdout.write('ran ${name} ' + process.argv.slice(2).join(' ') + ' in ' + process.cwd());\n`);
  }
  const sub = path.join(dir, 'src', 'templates', 'commands', 'claude-code');
  fs.mkdirSync(sub, { recursive: true });
  return { dir: fs.realpathSync(dir), sub };
}

const run = (command, cwd, extra = {}) => spawnSync('/bin/sh', ['-c', command], { cwd, env: { PATH: process.env.PATH, ...extra }, encoding: 'utf8' });

test('every script hook of this repo moves to the project root first', () => {
  assert.equal(scriptHooks.length, 6);
  for (const c of scriptHooks) assert.match(c, /^cd "\$\{CLAUDE_PROJECT_DIR:-\.\}" 2>\/dev\/null; node scripts\/[\w-]+\.js [\w-]+$/, c);
});

test('after the agent cd\'d into a subfolder, each script hook runs from the project root', () => {
  const { dir, sub } = standIn();
  try {
    for (const c of scriptHooks) {
      const r = run(c, sub, { CLAUDE_PROJECT_DIR: dir });
      assert.equal(r.status, 0, `${c}\n${r.stderr}`);
      assert.doesNotMatch(r.stderr, /Cannot find module/);
      assert.match(r.stdout, new RegExp(`^ran [\\w-]+\\.js [\\w-]+ in ${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), 'cwd is the root, so the scripts find it');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('without $CLAUDE_PROJECT_DIR a hook run from the root works as before', () => {
  const { dir } = standIn();
  try {
    for (const c of scriptHooks) {
      const r = run(c, dir);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /^ran /);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
