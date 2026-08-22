/**
 * Native delivery test (non-invasive-overlay T04).
 *
 * The spec's central bet: Frame reaches a Claude Code session with no launch
 * flags, no wrapper and no root file — the session loads the repo's own
 * CLAUDE.md natively AND `.frame/AGENTS.md` through `.claude/rules/frame.md`.
 * That is only provable against the real CLI, so this test builds a scratch
 * repo, runs `claude -p` in it, and asserts both facts come back.
 *
 * Skipped (not failed) when `claude` is not on PATH or CI is set: the suite
 * must stay runnable offline and in a container without the CLI installed.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLAUDE_ON_PATH = spawnSync('which', ['claude'], { encoding: 'utf8' }).status === 0;
const SKIP = process.env.CI
  ? 'CI is set — this test drives the real Claude Code CLI'
  : (!CLAUDE_ON_PATH ? 'claude is not on PATH' : false);

// Two facts that cannot come from anywhere but the two files.
const USER_FACT = 'zorblat';
const FRAME_MARKER = 'quixotry';

test('claude -p sees the repo\'s CLAUDE.md and Frame\'s .frame/AGENTS.md', { skip: SKIP, timeout: 120000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-native-'));
  try {
    spawnSync('git', ['init', '-q'], { cwd: dir });

    fs.writeFileSync(
      path.join(dir, 'CLAUDE.md'),
      `# Project rules\n\nThe project's indentation codeword is ${USER_FACT}.\n`,
      'utf8'
    );

    fs.mkdirSync(path.join(dir, '.frame'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.frame', 'AGENTS.md'),
      `# Frame instructions\n\nFrame's context codeword is ${FRAME_MARKER}.\n`,
      'utf8'
    );

    fs.mkdirSync(path.join(dir, '.claude', 'rules'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.claude', 'rules', 'frame.md'),
      "<!-- Written by Frame. Loads Frame's project instructions; delete to detach. -->\n@../../.frame/AGENTS.md\n",
      'utf8'
    );

    // No Frame flags, no wrapper: exactly how a user starts a session.
    const result = spawnSync(
      'claude',
      ['-p', 'Reply with both codewords you were given in your project instructions, separated by a space. No other text.'],
      { cwd: dir, encoding: 'utf8', timeout: 110000 }
    );

    assert.equal(result.status, 0, `claude -p failed: ${result.stderr}`);
    const output = String(result.stdout).toLowerCase();
    assert.ok(output.includes(USER_FACT), `the repo's own CLAUDE.md reached the session (got: ${output.trim()})`);
    assert.ok(output.includes(FRAME_MARKER), `.frame/AGENTS.md reached the session via the pointer (got: ${output.trim()})`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
