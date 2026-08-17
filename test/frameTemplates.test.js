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

// ─── shell init template (T02) ────────────────────────────────

// `.frame/bin` first on PATH is set before the user's rc files run, and those
// files reorder PATH afterwards — which is how a `codex` installed by
// `npm i -g` came to win. These functions are what makes the ordering
// irrelevant, so the assertions that matter are: a function per tool, each
// delegating to the *wrapper* rather than re-execing the tool name (which
// would recurse), and PATH moved rather than duplicated.

const INIT_BIN = '/tmp/some project/.frame/bin';

test('the POSIX init file defines one function per configured tool', () => {
  const init = templates.getShellInitTemplate({
    family: 'posix',
    binDir: INIT_BIN,
    toolIds: ['claude', 'codex', 'gemini']
  });
  for (const id of ['claude', 'codex', 'gemini']) {
    assert.ok(init.includes(`${id}() {`), `no function for ${id}`);
    assert.ok(init.includes(`"$FRAME_BIN/${id}" "$@"`), `${id} does not delegate to the wrapper`);
    assert.ok(init.includes(`command ${id} "$@"`), `${id} has no missing-wrapper fallback`);
  }
});

test('a custom tool gets its function in both files', () => {
  const posix = templates.getShellInitTemplate({ family: 'posix', binDir: INIT_BIN, toolIds: ['my-cli'] });
  const fish = templates.getShellInitTemplate({ family: 'fish', binDir: INIT_BIN, toolIds: ['my-cli'] });
  assert.ok(posix.includes('my-cli() {'));
  assert.ok(fish.includes('function my-cli'));
});

test('a function never re-execs the bare tool name outside `command`', () => {
  // `claude() { claude "$@"; }` would recurse forever. `command claude` is the
  // only bare form allowed: it bypasses functions while still using PATH.
  const init = templates.getShellInitTemplate({ family: 'posix', binDir: INIT_BIN, toolIds: ['claude'] });
  const body = init.slice(init.indexOf('claude() {'));
  for (const line of body.split('\n')) {
    if (!line.includes('claude')) continue;
    assert.ok(
      line.includes('$FRAME_BIN/claude') || line.includes('command claude') || line.includes('claude() {'),
      `bare re-exec would recurse: ${line}`
    );
  }
});

test('an id that would not parse as a function name is skipped, not escaped', () => {
  const init = templates.getShellInitTemplate({
    family: 'posix',
    binDir: INIT_BIN,
    toolIds: ['claude', 'rm -rf /', '2bad', '']
  });
  assert.ok(init.includes('claude() {'));
  assert.ok(!init.includes('rm -rf /'), 'a broken definition takes the whole file down with it');
  assert.ok(!init.includes('2bad'));
});

test('the bin directory is exported and quoted', () => {
  const init = templates.getShellInitTemplate({ family: 'posix', binDir: INIT_BIN, toolIds: [] });
  assert.ok(init.includes(`FRAME_BIN='${INIT_BIN}'`), 'a path with a space would split');
  assert.ok(init.includes('export FRAME_BIN'));
  assert.ok(init.includes('export PATH'), 'subshells inherit PATH, not functions');
});

test('a path with a quote in it is escaped rather than breaking the file', () => {
  const init = templates.getShellInitTemplate({ family: 'posix', binDir: "/tmp/o'brien/.frame/bin", toolIds: [] });
  assert.ok(init.includes("'\\''"), init.split('\n').find((l) => l.includes('FRAME_BIN=')));
});

test('the fish file uses fish syntax, not POSIX', () => {
  const init = templates.getShellInitTemplate({ family: 'fish', binDir: INIT_BIN, toolIds: ['claude'] });
  assert.ok(init.includes(`set -gx FRAME_BIN '${INIT_BIN}'`));
  assert.ok(init.includes('set -gx PATH $FRAME_BIN $__frame_rest'));
  assert.ok(init.includes('"$FRAME_BIN/claude" $argv'));
  assert.ok(init.includes('command claude $argv'));
  assert.ok(!init.includes('"$@"'), 'POSIX argument syntax leaked into the fish file');
});

test('a family Frame has no file for, or no bin directory, produces nothing', () => {
  assert.equal(templates.getShellInitTemplate({ family: 'nushell', binDir: INIT_BIN, toolIds: ['claude'] }), '');
  assert.equal(templates.getShellInitTemplate({ family: 'posix', binDir: '', toolIds: ['claude'] }), '');
  assert.equal(templates.getShellInitTemplate({}), '');
});

// ─── shell init behaviour, executed ───────────────────────────

// The string assertions above cannot tell a valid init file from one that
// makes the shell bail on a syntax error — and a file that fails to parse
// would leave the lane with no functions and no way to notice. These source it
// for real, in each shell family that takes it.

function stageInit(toolIds = ['claude']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-init-'));
  const binDir = path.join(root, 'project with space', '.frame', 'bin');
  const shellDir = path.join(root, 'project with space', '.frame', 'runtime', 'shell');
  const realDir = path.join(root, 'real');
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(shellDir, { recursive: true });
  fs.mkdirSync(realDir, { recursive: true });

  const initFile = path.join(shellDir, 'init.sh');
  fs.writeFileSync(initFile, templates.getShellInitTemplate({ family: 'posix', binDir, toolIds }));
  for (const id of toolIds) {
    fs.writeFileSync(path.join(binDir, id), `#!/usr/bin/env bash\necho "WRAPPER:${id}:$*"\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(realDir, id), `#!/usr/bin/env bash\necho "REAL:${id}:$*"\n`, { mode: 0o755 });
  }
  return { root, binDir, realDir, initFile };
}

function sourceInit(shell, staged, script, extraPath = '') {
  return execFileSync(shell, ['-c', `. '${staged.initFile}'\n${script}`], {
    env: {
      ...process.env,
      PATH: `${extraPath ? `${extraPath}:` : ''}${staged.realDir}:/usr/bin:/bin`
    },
    encoding: 'utf8',
    timeout: 10000
  });
}

for (const shell of ['bash', 'sh', 'zsh']) {
  test(`the init file parses and routes ${shell} through the wrapper`, { skip: !POSIX }, () => {
    const staged = stageInit(['claude']);
    const out = sourceInit(shell, staged, 'claude --resume x');
    assert.equal(out.trim(), 'WRAPPER:claude:--resume x', `${shell} did not resolve the function`);
  });

  test(`${shell} gets the bin directory first on PATH, even set up last`, { skip: !POSIX }, () => {
    // The nvm case: a directory holding a real `claude` was prepended by the
    // user's rc files, i.e. after Frame set the environment.
    const staged = stageInit(['claude']);
    const out = sourceInit(shell, staged, 'printf "%s\\n" "$PATH"', staged.realDir);
    const entries = out.trim().split(':');
    assert.equal(entries[0], staged.binDir, `${shell} PATH: ${out.trim()}`);
    assert.equal(entries.filter((e) => e === staged.binDir).length, 1, 'duplicated instead of moved');
  });

  test(`a subshell of ${shell} still reaches the wrapper through PATH`, { skip: !POSIX }, () => {
    // Functions do not survive a subshell; the exported PATH is what does.
    const staged = stageInit(['claude']);
    const out = sourceInit(shell, staged, `${shell} -c 'claude sub'`);
    assert.equal(out.trim(), 'WRAPPER:claude:sub', 'the base PATH layer did not reach the subshell');
  });

  test(`${shell} falls back to the real CLI when the wrapper is missing`, { skip: !POSIX }, () => {
    const staged = stageInit(['claude']);
    fs.rmSync(path.join(staged.binDir, 'claude'));
    const out = sourceInit(shell, staged, 'claude fallback');
    assert.equal(out.trim(), 'REAL:claude:fallback', 'a missing wrapper cost the user their CLI');
  });
}

// ─── managed hook block replacement ───────────────────────────
//
// `.git/hooks/` is not versioned and Frame writes it once, at init, so a
// project runs whatever generation initialized it until something rewrites
// the block. These cover the rewrite and — mostly — the cases where it must
// refuse, because the file it edits runs on every commit.

/** A pre-overlay hook, as Frame <=2.6.0 wrote it: stages the root map. */
const LEGACY_HOOK = `#!/bin/sh
# Frame pre-commit hook
# Auto-installed by Frame on project initialization. You can edit or delete
# this file freely — Frame will not overwrite it on subsequent inits.

${templates.FRAME_HOOK_MARKER_START}
# Keep STRUCTURE.json in sync with staged JS changes. Safe to remove if you
# don't want Frame to manage your STRUCTURE.json file.
if command -v node >/dev/null 2>&1; then
  FRAME_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
  if [ -n "$FRAME_ROOT" ] && [ -f "$FRAME_ROOT/.frame/bin/update-structure.js" ]; then
    FRAME_PROJECT_ROOT="$FRAME_ROOT" node "$FRAME_ROOT/.frame/bin/update-structure.js" --changed || true
    if [ -f "$FRAME_ROOT/STRUCTURE.json" ]; then
      git add "$FRAME_ROOT/STRUCTURE.json" || true
    fi
  fi
fi
${templates.FRAME_HOOK_MARKER_END}
exit 0
`;

test('the legacy block is swapped for the current one', () => {
  const out = templates.replaceManagedHookBlock(LEGACY_HOOK);
  assert.ok(out, 'a well-formed legacy hook was refused');
  assert.ok(out.includes('.frame/STRUCTURE.json'), 'still points at the root map');
  assert.ok(out.includes('git ls-files --error-unmatch'), 'lost the tracked-only guard');
  assert.equal(
    out.split(`git add "$FRAME_ROOT/STRUCTURE.json"`).length - 1,
    1,
    'the root path survives only as the pre-overlay fallback'
  );
});

test('everything outside the markers is preserved byte for byte', () => {
  const withUserLines = LEGACY_HOOK.replace('exit 0\n', 'npm run lint || exit 1\nexit 0\n');
  const out = templates.replaceManagedHookBlock(withUserLines);
  assert.ok(out.startsWith('#!/bin/sh\n# Frame pre-commit hook'), 'header was disturbed');
  assert.ok(out.includes('npm run lint || exit 1'), "the user's own line was dropped");
  assert.ok(out.endsWith('exit 0\n'), 'the tail was disturbed');
});

test('the rewritten hook parses as shell', { skip: process.platform === 'win32' }, () => {
  const out = templates.replaceManagedHookBlock(LEGACY_HOOK);
  const check = require('child_process').spawnSync('sh', ['-n'], { input: out, encoding: 'utf8' });
  assert.equal(check.status, 0, `sh -n rejected the result: ${check.stderr}`);
});

test('a hook with no managed block is left alone', () => {
  assert.equal(templates.replaceManagedHookBlock('#!/bin/sh\nnpm test\n'), null);
});

test('duplicated or reversed markers are refused rather than guessed at', () => {
  const twice = LEGACY_HOOK + LEGACY_HOOK;
  assert.equal(templates.replaceManagedHookBlock(twice), null, 'two blocks: which one?');

  const reversed = `#!/bin/sh\n${templates.FRAME_HOOK_MARKER_END}\nx=1\n${templates.FRAME_HOOK_MARKER_START}\n`;
  assert.equal(templates.replaceManagedHookBlock(reversed), null, 'end before start');
});

test('a hook already carrying the current block reports nothing to do', () => {
  const current = templates.getStructurePreCommitHookTemplate();
  assert.equal(templates.replaceManagedHookBlock(current), null);
});

test('replacement is idempotent — the second pass finds nothing left to change', () => {
  const once = templates.replaceManagedHookBlock(LEGACY_HOOK);
  assert.equal(templates.replaceManagedHookBlock(once), null);
});

test('non-string input is refused', () => {
  assert.equal(templates.replaceManagedHookBlock(null), null);
  assert.equal(templates.replaceManagedHookBlock(undefined), null);
});
