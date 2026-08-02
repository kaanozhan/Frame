/**
 * frameTemplates tests (T08): what the generated files may and may not say
 * once Frame is an overlay.
 *
 * The load-bearing assertion is negative — no template may reference a root
 * instruction file or a planted symlink, because the overlay creates neither
 * and a template that claims otherwise sends an agent looking for a file that
 * is not there.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const templates = require('../src/shared/frameTemplates');

// ─── wrapper template ─────────────────────────────────────────

test('the wrapper execs the real CLI with the preamble as initial prompt', () => {
  const script = templates.getWrapperTemplate('codex', {});
  assert.ok(script.startsWith('#!/usr/bin/env bash'));
  assert.ok(script.includes('frame_args=("$(cat "$PREAMBLE_FILE")")'));
  assert.ok(script.includes('exec "$REAL_CLI" "${frame_args[@]}" "$@"'));
  assert.ok(script.includes('exec "$REAL_CLI" "$@"'), 'no fallback when the preamble is missing');
});

test('the wrapper is generalized per tool, not written per CLI', () => {
  for (const tool of ['codex', 'gemini', 'some-future-cli']) {
    const script = templates.getWrapperTemplate(tool, {});
    assert.ok(script.includes(`command -v ${tool} `), `${tool} is not resolved`);
    assert.ok(script.includes(`Frame AI Tool Wrapper for ${tool}`));
  }
});

test('a tool with a prompt flag gets it in front of the prompt', () => {
  const script = templates.getWrapperTemplate('sometool', { promptFlag: '--prompt' });
  assert.ok(script.includes('frame_args=("--prompt" "$(cat "$PREAMBLE_FILE")")'));
});

test('the wrapper reads the preamble from a file, never inlines it', () => {
  const script = templates.getWrapperTemplate('codex', {});
  // Inlining multi-line prose full of quotes and backticks into a generated
  // shell script is how these break; the preamble stays data.
  assert.ok(script.includes('PREAMBLE_FILE='));
  assert.ok(script.includes('.frame/runtime/preamble.txt'));
});

test('the wrapper finds the project root by .frame/, not by a root AGENTS.md', () => {
  const script = templates.getWrapperTemplate('codex', {});
  assert.ok(script.includes('-d "$dir/.frame"'));
  assert.ok(!/AGENTS\.md/.test(script), 'the wrapper still hunts for a root AGENTS.md');
});

test('a custom preamble location is honoured', () => {
  const script = templates.getWrapperTemplate('codex', { preambleFile: '.frame/runtime/other.txt' });
  assert.ok(script.includes('.frame/runtime/other.txt'));
});

test('only the flags the tool declares are emitted', () => {
  const claudeLike = templates.getWrapperTemplate('claude', {
    promptFlag: '--append-system-prompt',
    settingsFlag: '--settings'
  });
  assert.ok(claudeLike.includes('"--append-system-prompt" "$(cat "$PREAMBLE_FILE")"'));
  assert.ok(claudeLike.includes('frame_args+=("--settings" "$SETTINGS_FILE")'));

  // A tool that declares neither must not acquire Claude's flags by accident —
  // an unknown flag makes most CLIs refuse to start at all.
  const bare = templates.getWrapperTemplate('codex', {});
  assert.ok(!bare.includes('--append-system-prompt'), 'undeclared prompt flag leaked in');
  assert.ok(!bare.includes('--settings'), 'undeclared settings flag leaked in');
  assert.ok(!bare.includes('SETTINGS_FILE"'), 'settings block emitted for a tool without the flag');
});

test('the wrapper resolves the real CLI with its own directory off PATH', () => {
  const script = templates.getWrapperTemplate('claude', { promptFlag: '--append-system-prompt' });
  assert.ok(script.includes('path_without_self'), 'no PATH stripping — this wrapper would exec itself');
  assert.ok(script.includes('[ "$entry" = "$SELF_DIR" ] && continue'));
  assert.ok(!/exec claude\b/.test(script), 'execs the CLI by name, which is this script');
});

// ─── wrapper behaviour, executed ──────────────────────────────

// The assertions above read the script; these run it. A wrapper that re-enters
// itself would recurse until the process table or the timeout gives out, which
// no string match can catch — the whole reason for the run-time resolution.
const POSIX = process.platform !== 'win32';

function stageWrapper(toolId, options, { preamble = 'PREAMBLE "quoted" `ticked`', settings = '{}' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-wrapper-'));
  const binDir = path.join(root, 'project', '.frame', 'bin');
  const runtimeDir = path.join(root, 'project', '.frame', 'runtime');
  const realDir = path.join(root, 'real');
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.mkdirSync(realDir, { recursive: true });

  fs.writeFileSync(path.join(binDir, toolId), templates.getWrapperTemplate(toolId, options), { mode: 0o755 });
  if (preamble !== null) fs.writeFileSync(path.join(runtimeDir, 'preamble.txt'), preamble);
  if (settings !== null) fs.writeFileSync(path.join(runtimeDir, 'claude-settings.json'), settings);

  // The "real" CLI just prints its arguments, one per line, tagged so the
  // wrapper's own output could never be mistaken for it.
  fs.writeFileSync(
    path.join(realDir, toolId),
    '#!/usr/bin/env bash\nfor a in "$@"; do echo "ARG:$a"; done\n',
    { mode: 0o755 }
  );

  return { root, binDir, realDir, projectDir: path.join(root, 'project') };
}

function runWrapper(staged, toolId, args) {
  return execFileSync('bash', ['-c', [toolId, ...args].join(' ')], {
    cwd: staged.projectDir,
    env: { ...process.env, PATH: `${staged.binDir}:${staged.realDir}:/usr/bin:/bin` },
    encoding: 'utf8',
    timeout: 10000
  });
}

test('a wrapper named after its tool does not re-enter itself', { skip: !POSIX }, () => {
  const staged = stageWrapper('claude', {
    promptFlag: '--append-system-prompt',
    settingsFlag: '--settings'
  });
  // .frame/bin is first on PATH and the wrapper is called `claude`: without
  // the strip, this call never returns.
  const out = runWrapper(staged, 'claude', []);
  assert.ok(out.includes('ARG:--append-system-prompt'), out);
  assert.ok(out.includes('ARG:PREAMBLE "quoted" `ticked`'), out);
  assert.ok(out.includes('ARG:--settings'), out);
});

test("the user's own arguments reach the real CLI unchanged", { skip: !POSIX }, () => {
  const staged = stageWrapper('claude', { promptFlag: '--append-system-prompt' });
  const out = runWrapper(staged, 'claude', ['--resume', 'abc123', '-p', '"two words"']);
  const args = out.trim().split('\n');
  assert.deepEqual(args.slice(-4), ['ARG:--resume', 'ARG:abc123', 'ARG:-p', 'ARG:two words']);
});

test('a missing preamble degrades to the bare CLI', { skip: !POSIX }, () => {
  const staged = stageWrapper('codex', {}, { preamble: null });
  const out = runWrapper(staged, 'codex', ['--model', 'o3']);
  assert.equal(out.trim(), 'ARG:--model\nARG:o3', 'the preamble-less wrapper still injected something');
});

test('FRAME_NO_WRAP runs the CLI with no Frame context', { skip: !POSIX }, () => {
  const staged = stageWrapper('claude', { promptFlag: '--append-system-prompt' });
  const out = execFileSync('bash', ['-c', 'FRAME_NO_WRAP=1 claude --resume x'], {
    cwd: staged.projectDir,
    env: { ...process.env, PATH: `${staged.binDir}:${staged.realDir}:/usr/bin:/bin` },
    encoding: 'utf8',
    timeout: 10000
  });
  assert.equal(out.trim(), 'ARG:--resume\nARG:x', 'the escape hatch still injected context');
});

test('the settings flag is skipped when the settings file is absent', { skip: !POSIX }, () => {
  const staged = stageWrapper('claude', {
    promptFlag: '--append-system-prompt',
    settingsFlag: '--settings'
  }, { settings: null });
  const out = runWrapper(staged, 'claude', []);
  assert.ok(!out.includes('ARG:--settings'), out);
  assert.ok(out.includes('ARG:--append-system-prompt'), out);
});

// ─── spec-hint settings ───────────────────────────────────────

test('the spec-hint settings carry both hook events', () => {
  const settings = templates.getSpecHintSettings();
  assert.ok(settings.hooks.PreToolUse);
  assert.ok(settings.hooks.UserPromptSubmit);
  assert.equal(settings.hooks.PreToolUse[0].matcher, 'Edit|Write');
  assert.ok(JSON.stringify(settings).includes('.frame/bin/spec-hint.js'));
});

test('the settings object is JSON-serializable as a settings file', () => {
  const settings = templates.getSpecHintSettings();
  assert.deepEqual(JSON.parse(JSON.stringify(settings)), settings);
});

test('every spec-hint command runs from inside .frame/', () => {
  const commands = JSON.stringify(templates.getSpecHintSettings()).match(/"command":"([^"]+)"/g) || [];
  assert.ok(commands.length > 0);
  for (const command of commands) {
    assert.ok(command.includes('.frame/'), `${command} points outside Frame's footprint`);
  }
});

// ─── the global layer's content ───────────────────────────────

test('no AGENTS template claims a planted symlink', () => {
  // The project-layer copy carried this note until the overlay stopped
  // planting the symlink it described.
  const project = templates.getAgentsTemplate('Demo', {});
  assert.ok(!/symlink/i.test(project), 'the project AGENTS layer still promises a symlink');
});

test('the global AGENTS core references no root file and no symlink', () => {
  const text = templates.getAgentsTemplate('Frame', {
    global: true,
    referencePath: 'REFERENCE.md'
  });

  assert.ok(!/symlink/i.test(text), 'the overlay plants no symlink');
  assert.ok(!/Creation date/.test(text));
  assert.ok(!/Project Facts/.test(text));
  assert.ok(text.includes('REFERENCE.md'));
});

test('the global core points at the reference it was given', () => {
  const text = templates.getAgentsTemplate('Frame', {
    global: true,
    referencePath: '/abs/frame-global/REFERENCE.md'
  });
  assert.ok(text.includes('/abs/frame-global/REFERENCE.md'));
  assert.ok(!text.includes('.frame/docs/REFERENCE.md'), 'the default path leaked into the global copy');
});

test('Frame-owned scripts are addressed under .frame/bin/', () => {
  const text = templates.getAgentsTemplate('Frame', { global: true, referencePath: 'REFERENCE.md' });
  for (const script of ['find-module.js', 'spec-context.js', 'check-freshness.js']) {
    assert.ok(text.includes(`.frame/bin/${script}`), `${script} is not addressed inside .frame/`);
  }
});

test('the project variant still renders its own facts and stamp', () => {
  const text = templates.getAgentsTemplate('MyProject', {
    project: { languages: ['javascript'], packageManager: 'npm', commands: {} }
  });
  assert.ok(text.includes('# MyProject - Frame Project'));
  assert.ok(/Project Facts/.test(text));
  assert.ok(/Creation date/.test(text));
});

// ─── config template ──────────────────────────────────────────

test('the config template carries gitSharing and none of the dead flags', () => {
  const config = templates.getFrameConfigTemplate('MyProject');
  assert.equal(config.settings.gitSharing, 'local', 'default sharing mode is local');
  assert.deepEqual(Object.keys(config.settings), ['gitSharing'], 'a dead flag survived in settings');
  assert.equal(config.features.specDriven, true, 'spec-driven defaults on');
});

test('the config template takes both init answers from options', () => {
  const config = templates.getFrameConfigTemplate('MyProject', { gitSharing: 'repo', specDriven: false });
  assert.equal(config.settings.gitSharing, 'repo');
  assert.equal(config.features.specDriven, false);
});

test('an invalid gitSharing option falls back to local', () => {
  const config = templates.getFrameConfigTemplate('MyProject', { gitSharing: 'team' });
  assert.equal(config.settings.gitSharing, 'local');
});
