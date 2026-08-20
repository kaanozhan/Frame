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

// ─── cmd wrapper template ─────────────────────────────────────

// Nothing here executes: cmd.exe is not on this machine and the real
// verification is the Windows test protocol this spec ships. These are string
// assertions on the batch Frame generates, and they exist to pin the handful
// of details a later edit would quietly break.

const CMD_OPTS = {
  promptFileFlag: '--append-system-prompt-file',
  settingsFlag: '--settings',
  preambleFile: '.frame/runtime/preamble-claude.txt',
  settingsFile: '.frame/runtime/claude-settings.json'
};

function cmdWrapper(tool = 'claude', options = CMD_OPTS) {
  return templates.getCmdWrapperTemplate(tool, options);
}

test('a tool with no file flag gets no cmd wrapper at all', () => {
  // There is no batch spelling of --append-system-prompt with a 9-line,
  // backtick-bearing preamble, and a wrapper that cannot do its job still
  // shadows a working CLI.
  assert.equal(templates.getCmdWrapperTemplate('codex', {}), '');
  assert.equal(templates.getCmdWrapperTemplate('gemini', { settingsFlag: '--settings' }), '');
});

test('the cmd wrapper names its tool and disables echo', () => {
  const script = cmdWrapper();
  assert.ok(script.startsWith('@echo off\nsetlocal EnableExtensions\n'));
  assert.ok(script.includes('Frame AI Tool Wrapper for claude (Windows).'));
});

test('the where loop skips any hit living in the wrapper\'s own directory', () => {
  // .frame\bin leads PATH, so `where claude` reports this very file first.
  const script = cmdWrapper();
  assert.ok(script.includes(`for /f "delims=" %%I in ('where "claude" 2^>nul') do (`));
  assert.ok(script.includes('if not defined FRAME_REAL if /i not "%%~dpI"=="%FRAME_SELF%" set "FRAME_REAL=%%I"'));
  assert.ok(script.includes('set "FRAME_SELF=%~dp0"'));
});

test('a CLI that is not installed exits 127 and shadows nothing', () => {
  const script = cmdWrapper();
  assert.ok(script.includes('>&2 echo Frame: claude was not found on PATH.'));
  assert.ok(script.includes('exit /b 127'));
  // The message goes to stderr before the exit, and neither is inside a block.
  assert.ok(!/\(\s*[^)]*not found on PATH/.test(script));
});

test('FRAME_NO_WRAP reaches the same pass-through every other branch uses', () => {
  const script = cmdWrapper();
  assert.ok(script.includes('if defined FRAME_NO_WRAP goto :frame_run'));
});

test('a line that already carries Frame\'s flag is left alone', () => {
  // C1: one injection route. A launch Frame composed resolves through this
  // file too, so its flags are already there — the two must never stack.
  const script = cmdWrapper();
  assert.ok(script.includes('call :frame_scan_args %*'));
  assert.ok(script.includes('if defined FRAME_COMPOSED goto :frame_run'));
  assert.ok(script.includes('if /i "%~1"=="--append-system-prompt-file" set "FRAME_COMPOSED=1"'));
});

test('arguments are compared one at a time, not by searching the whole line', () => {
  // %~1 strips cmd's quotes, so `claude "a & b"` is compared as a value
  // instead of being re-parsed as syntax.
  const script = cmdWrapper();
  assert.ok(script.includes('if "%~1"=="" goto :eof'));
  assert.ok(script.includes('\nshift\ngoto :frame_scan_args'));
  assert.ok(!script.includes('%FRAME_ARGS:'), 'a whole-line substring search is quote-fragile');
});

test('the project root is found by walking up to the directory holding .frame', () => {
  const script = cmdWrapper();
  assert.ok(script.includes('call :frame_find_root "%CD%"'));
  assert.ok(script.includes('if exist "%FRAME_TRY%\\.frame\\" goto :frame_find_root_hit'));
  assert.ok(script.includes('for %%P in ("%FRAME_TRY%\\..") do set "FRAME_UP=%%~fP"'));
  // The walk has to stop at the filesystem root or it never returns.
  assert.ok(script.includes('if /i "%FRAME_UP%"=="%FRAME_TRY%" goto :eof'));
  assert.ok(script.includes('if not defined FRAME_ROOT goto :frame_run'));
});

test('the flags carry backslash paths, and every path is quoted', () => {
  const script = cmdWrapper();
  assert.ok(script.includes('set "FRAME_PREAMBLE=%FRAME_ROOT%\\.frame\\runtime\\preamble-claude.txt"'));
  assert.ok(script.includes('set FRAME_FLAGS=--append-system-prompt-file "%FRAME_PREAMBLE%"'));
  assert.ok(script.includes('set "FRAME_SETTINGS=%FRAME_ROOT%\\.frame\\runtime\\claude-settings.json"'));
  assert.ok(script.includes('set FRAME_FLAGS=%FRAME_FLAGS% --settings "%FRAME_SETTINGS%"'));
  // A project under Documents has a space in it as often as not.
  assert.ok(!/%FRAME_ROOT%\\[^\n"]*[^"]\n/.test(script), 'an unquoted root path would break on a space');
  assert.ok(!script.includes('.frame/runtime'), 'forward slashes leaked into the batch file');
});

test('the settings pair is dropped for a tool that declares no settings flag', () => {
  const script = cmdWrapper('claude', { ...CMD_OPTS, settingsFlag: '' });
  assert.ok(script.includes('--append-system-prompt-file'));
  assert.ok(!script.includes('FRAME_SETTINGS'));
});

test('the settings file is optional in a way the preamble is not', () => {
  const script = cmdWrapper();
  // A missing preamble means there is nothing to inject; a missing settings
  // file costs the hooks and keeps the preamble.
  const preambleGuard = script.indexOf('if not exist "%FRAME_PREAMBLE%" goto :frame_run');
  const settingsGuard = script.indexOf('if not exist "%FRAME_SETTINGS%" goto :frame_run');
  const flagsSet = script.indexOf('set FRAME_FLAGS=--append-system-prompt-file');
  assert.ok(preambleGuard > -1 && settingsGuard > -1 && flagsSet > -1);
  assert.ok(preambleGuard < flagsSet, 'the preamble guard must precede the flags it guards');
  assert.ok(flagsSet < settingsGuard, 'a missing settings file must not cost the preamble');
});

test('every branch reaches one call, and the tail is a bare exit /b', () => {
  // S5: the child's exit code must arrive unchanged.
  const script = cmdWrapper();
  const calls = script.split('\n').filter((line) => line.startsWith('call "%FRAME_REAL%"'));
  assert.equal(calls.length, 1, 'more than one call site means more than one place to lose the code');
  assert.equal(calls[0], 'call "%FRAME_REAL%" %FRAME_FLAGS% %*');
  assert.ok(script.includes('call "%FRAME_REAL%" %FRAME_FLAGS% %*\nexit /b\n'));
});

test('%ERRORLEVEL% appears nowhere, least of all inside a block', () => {
  // cmd.exe expands variables when it *parses* a parenthesised block, so an
  // `exit /b %ERRORLEVEL%` inside an `if (…)` reports the code from before
  // the call. The goto-shaped tail is what makes the variable unnecessary.
  const script = cmdWrapper();
  assert.ok(!/%ERRORLEVEL%/i.test(script));
  for (const line of script.split('\n')) {
    if (!/^\s*(if|for)\b.*\($/.test(line)) continue;
    assert.ok(!/%ERRORLEVEL%/i.test(line));
  }
});

test('every goto has a label to land on', () => {
  const script = cmdWrapper();
  const labels = new Set(
    script.split('\n')
      .filter((line) => /^:[a-z_]/i.test(line))
      .map((line) => line.trim().slice(1))
  );
  labels.add('eof');
  for (const match of script.matchAll(/goto :([a-z_]+)/gi)) {
    assert.ok(labels.has(match[1]), `goto :${match[1]} has no label`);
  }
  // And every label is reachable, so a rename cannot orphan a whole branch.
  for (const label of labels) {
    if (label === 'eof' || label === 'frame_scan_args' || label === 'frame_find_root') continue;
    assert.ok(script.includes(`goto :${label}`), `:${label} is never jumped to`);
  }
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

// ─── shell init template · PowerShell ─────────────────────────

const PS_BIN = 'C:\\Users\\dev\\my project\\.frame\\bin';

function psInit(toolIds = ['claude']) {
  return templates.getShellInitTemplate({ family: 'powershell', binDir: PS_BIN, toolIds });
}

test('the PowerShell file exports FRAME_BIN and puts it first on PATH', () => {
  const init = psInit();
  assert.ok(init.includes(`$env:FRAME_BIN = '${PS_BIN}'`));
  assert.ok(init.includes("$env:PATH = (@($env:FRAME_BIN) + $frameRest) -join ';'"));
  // Any later copy is dropped rather than left behind, or the rebuild would
  // duplicate the entry every time a lane opens.
  assert.ok(init.includes("Where-Object { $_ -and $_ -ne $env:FRAME_BIN }"));
  assert.ok(init.includes("-split ';'"), 'the POSIX separator would split nothing on Windows');
});

test('the PowerShell file defines one function per tool, routed to its .cmd', () => {
  const init = psInit(['claude', 'somecli']);
  for (const id of ['claude', 'somecli']) {
    assert.ok(init.includes(`function ${id} {`), `${id} has no function`);
    assert.ok(init.includes(`Join-Path $env:FRAME_BIN '${id}.cmd'`), `${id} is not routed to its wrapper`);
  }
  assert.ok(init.includes('& $frameWrapper @args'), 'arguments are not forwarded');
});

test('the PowerShell fallback resolves an application, so it cannot recurse', () => {
  // A function named `claude` looking up `claude` would find itself.
  // -CommandType Application excludes functions and aliases — the PowerShell
  // spelling of the POSIX file's `command <id>`.
  const init = psInit();
  assert.ok(init.includes("Get-Command 'claude' -CommandType Application -ErrorAction SilentlyContinue"));
  assert.ok(init.includes('& $frameReal.Source @args'));
  assert.ok(!/&\s*claude\b/.test(init), 'the fallback calls the tool by name, which is this function');
});

test('a tool that is missing entirely gets a message, not a stack trace', () => {
  assert.ok(psInit().includes("Write-Error 'Frame: claude was not found on PATH.'"));
});

test('the PowerShell file uses PowerShell syntax, not POSIX', () => {
  const init = psInit();
  assert.ok(!init.includes('"$@"'), 'POSIX argument syntax leaked into the PowerShell file');
  assert.ok(!init.includes('export '), 'POSIX export leaked into the PowerShell file');
  assert.ok(init.startsWith('# Frame shell setup'));
});

test('a project path with an apostrophe is escaped the PowerShell way', () => {
  const init = templates.getShellInitTemplate({
    family: 'powershell',
    binDir: "C:\\Users\\o'brien\\.frame\\bin",
    toolIds: ['claude']
  });
  assert.ok(init.includes("'C:\\Users\\o''brien\\.frame\\bin'"), init.split('\n')[4]);
  assert.ok(!init.includes("'\\''"), 'POSIX quoting leaked into the PowerShell file');
});

test('a family Frame has no file for still gets nothing', () => {
  assert.equal(templates.getShellInitTemplate({ family: 'cmd', binDir: PS_BIN, toolIds: ['claude'] }), '');
  assert.equal(templates.getShellInitTemplate({ family: 'powershell', binDir: '', toolIds: ['claude'] }), '');
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
