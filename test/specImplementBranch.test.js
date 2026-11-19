/**
 * spec.implement's pre-flight branch rule in a Frame workspace.
 *
 * A workspace is a linked git worktree on a branch Frame created
 * (`ws/<name>`), and Frame pushes and opens the PR from that branch. The rule
 * used to read `ws/<name>` as "another piece of work's branch" and offer to
 * switch to `feat/<slug>`; accepting moved the worktree off the branch Frame
 * pushes, so the agent's commits never reached the PR. The template now
 * passes in a linked worktree and never offers to switch there. This pins
 * the rule and checks that the test it gives the agent tells a workspace
 * from the main checkout in a real repository.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const TEMPLATE = path.join(__dirname, '..', 'src', 'templates', 'commands', 'claude-code', 'spec.implement.md');

function branchSection() {
  const text = fs.readFileSync(TEMPLATE, 'utf8');
  const start = text.indexOf('**The branch.**');
  const end = text.indexOf('**Ask in the normal message flow', start);
  assert.ok(start >= 0 && end > start, 'the branch rule is where pre-flight expects it');
  return text.slice(start, end);
}

test('a linked worktree (every Frame workspace) passes, before any branch-name rule, and is never switched', () => {
  const s = branchSection();
  const worktree = s.indexOf('linked git worktree');
  assert.ok(worktree >= 0, 'the rule names linked worktrees');
  assert.ok(worktree < s.indexOf('`main`/`master`') && worktree < s.indexOf('has nothing to do with'),
    'it is checked first, so a ws/<name> branch never reaches the "unrelated branch" rule');
  assert.match(s, /git rev-parse --show-toplevel/);
  assert.match(s, /git worktree list --porcelain/);
  assert.match(s, /never switch, create or rename a\s+branch\s+here,\s+and do not offer to/);
});

test('the check the rule gives the agent tells a workspace from the main checkout', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-wt-'));
  try {
    const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
    const main = path.join(dir, 'project');
    git(['init', '-q', '-b', 'main', main], dir);
    git(['commit', '-q', '--allow-empty', '-m', 'init'], main);
    const ws = path.join(dir, 'ws-teal');
    git(['worktree', 'add', '-q', '-b', 'ws/teal', ws], main);
    // Compared as plain text, the way an agent reads two command outputs.
    const linked = (cwd) => {
      const top = git(['rev-parse', '--show-toplevel'], cwd);
      const first = git(['worktree', 'list', '--porcelain'], cwd).split('\n')[0].replace(/^worktree /, '');
      return top !== first;
    };
    fs.mkdirSync(path.join(main, 'src'));
    fs.mkdirSync(path.join(ws, 'src'));
    assert.equal(linked(main), false, 'the main checkout is not a linked worktree');
    assert.equal(linked(path.join(main, 'src')), false, 'nor is a folder inside it');
    assert.equal(linked(ws), true, 'a workspace is');
    assert.equal(linked(path.join(ws, 'src')), true, 'from a folder inside it too');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
