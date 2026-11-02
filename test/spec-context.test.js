/**
 * spec-context.js --file — spec history, then the file's decision cards
 * (decision-cards-core T06).
 *
 * `/spec.plan` runs `spec-context.js --file` on the files it is about to
 * plan for, so this is how a spec-less decision reaches that step. With no
 * card file the output is the one this CLI printed before cards existed,
 * pinned against the last commit before this spec.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const CLI = path.join(REPO, 'scripts', 'spec-context.js');

/** A project holding one real finished spec, so the file has spec history. */
function mkProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-specctx-'));
  fs.mkdirSync(path.join(root, '.frame', 'specs'), { recursive: true });
  fs.cpSync(path.join(REPO, '.frame', 'specs', 'spec-close-step'), path.join(root, '.frame', 'specs', 'spec-close-step'), { recursive: true });
  return root;
}

function run(root, args, cli = CLI) {
  return execFileSync('node', [cli, ...args], { encoding: 'utf8', env: { ...process.env, FRAME_PROJECT_ROOT: root } });
}

const card = (over = {}) => JSON.stringify({
  id: '20261014-aaaaaa', date: '2026-10-14',
  decision: 'The close script never fails a run outside --strict.',
  why: 'An unattended run stops on a failed check.',
  keywords: ['spec close'], files: ['scripts/spec-close.js'],
  source: 'notes:2026-10-14 Close script exit codes', supersedes: null, extends: null, ...over
});

const writeCards = (root, lines) => fs.writeFileSync(path.join(root, '.frame', 'decisions.jsonl'), `${lines.join('\n')}\n`);

test('--file prints the spec history, then the file\'s spec-less cards', () => {
  const root = mkProject();
  const before = run(root, ['--file', 'scripts/spec-close.js']);
  writeCards(root, [card()]);
  const out = run(root, ['--file', 'scripts/spec-close.js']);
  assert.ok(out.startsWith(before), 'the history is printed exactly as before');
  assert.equal(out.slice(before.length), [
    'Recorded decisions for scripts/spec-close.js — 1 card(s), newest first:',
    '  - 2026-10-14 20261014-aaaaaa — The close script never fails a run outside --strict.',
    '    why: An unattended run stops on a failed check.',
    '    story: PROJECT_NOTES.md "### [2026-10-14] Close script exit codes"',
    ''
  ].join('\n'));
});

test('a file with no spec history still lists its cards', () => {
  const root = mkProject();
  writeCards(root, [card({ files: ['src/none.js'] })]);
  const out = run(root, ['--file', './src/none.js']);
  assert.ok(out.startsWith('No spec history for src/none.js.\nRecorded decisions for src/none.js — 1 card(s)'));
});

test('spec cards, superseded cards and other files\' cards are left out', () => {
  const root = mkProject();
  writeCards(root, [
    card({ id: '20261001-aaaaaa', source: 'spec:spec-close-step' }),
    card({ id: '20261002-bbbbbb', decision: 'The old rule.' }),
    card({ id: '20261003-cccccc', decision: 'The new rule.', supersedes: '20261002-bbbbbb' }),
    card({ id: '20261004-dddddd', decision: 'Another file.', files: ['src/other.js'] })
  ]);
  const out = run(root, ['--file', 'scripts/spec-close.js']);
  assert.match(out, /— 1 card\(s\), newest first:/);
  assert.match(out, /The new rule\./);
  assert.ok(!/The old rule\.|Another file\.|20261001-aaaaaa/.test(out));
});

// The last commit before decision cards. Absent in a shallow clone.
const BEFORE_CARDS = (() => {
  try {
    return execFileSync('git', ['show', '8ce2aa8:scripts/spec-context.js'],
      { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
})();

test('with no card file, --file and topic output are byte-identical to the CLI before cards', { skip: !BEFORE_CARDS && 'history unavailable' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-specctx-before-'));
  fs.copyFileSync(path.join(REPO, 'scripts', 'spec-index.js'), path.join(dir, 'spec-index.js'));
  fs.writeFileSync(path.join(dir, 'spec-context.js'), BEFORE_CARDS);
  const root = mkProject();
  for (const args of [['--file', 'scripts/spec-close.js'], ['--file', 'src/none.js'], ['spec', 'close'], ['--list']]) {
    assert.equal(run(root, args), run(root, args, path.join(dir, 'spec-context.js')), args.join(' '));
  }
});
