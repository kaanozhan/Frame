/**
 * Native delivery test (non-invasive-overlay T04/T19).
 *
 * The spec's central bet: Frame reaches a Claude Code session with no launch
 * flags, no wrapper and no root file — the session loads the repo's own
 * CLAUDE.md natively AND Frame's instructions through `.claude/rules/frame.md`.
 * That is only provable against the real CLI, so these tests build a scratch
 * repo and run `claude -p` in it.
 *
 * The second test is the reason `.claude/rules/frame.md` holds a copy rather
 * than an `@`-import: from a sub-directory the rule file still loads, but an
 * import resolving above the working directory is not expanded, so the
 * import-based version reached the session with nothing in it.
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

/** The rule file exactly as Frame writes it: a copy of .frame/AGENTS.md. */
function writeRuleFile(dir) {
  const templates = require('../src/shared/frameTemplates');
  const agents = fs.readFileSync(path.join(dir, '.frame', 'AGENTS.md'), 'utf8');
  fs.mkdirSync(path.join(dir, '.claude', 'rules'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'rules', 'frame.md'), templates.getClaudeRuleTemplate(agents), 'utf8');
}

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

    writeRuleFile(dir);

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

test('a session started in a sub-directory still gets Frame\'s instructions', { skip: SKIP, timeout: 120000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-native-sub-'));
  try {
    spawnSync('git', ['init', '-q'], { cwd: dir });

    fs.mkdirSync(path.join(dir, '.frame'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.frame', 'AGENTS.md'),
      `# Frame instructions\n\nFrame's context codeword is ${FRAME_MARKER}.\n`,
      'utf8'
    );
    writeRuleFile(dir);

    // Where people actually start sessions: inside the code, not at the root.
    const subDir = path.join(dir, 'src');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, 'app.js'), 'module.exports = {};\n', 'utf8');

    const result = spawnSync(
      'claude',
      ['-p', 'Reply with the codeword from your project instructions. If you were given none, reply NONE. No other text.'],
      { cwd: subDir, encoding: 'utf8', timeout: 110000 }
    );

    assert.equal(result.status, 0, `claude -p failed: ${result.stderr}`);
    const output = String(result.stdout).toLowerCase();
    assert.ok(
      output.includes(FRAME_MARKER),
      `Frame's instructions reached a sub-directory session (got: ${output.trim()})`
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
