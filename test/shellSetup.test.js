/**
 * shellSetup tests (T01): the delivery table for terminal session setup.
 *
 * Two assertions here are load-bearing and the rest are guard rails. The first
 * is that the delivered line never contains the literal marker — the tty echoes
 * a typed command before running it, so a marker present in the line itself
 * would be matched in the echo and setup would be declared installed before the
 * shell had done anything. The second is that markers differ across attempts:
 * a retry reusing the first token would be resolved by output still in flight
 * from the first attempt.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const shellSetup = require('../src/main/shellSetup');

const PROJECT = '/tmp/some project';
const INIT_SH = path.join(PROJECT, '.frame', 'runtime', 'shell', 'init.sh');
const INIT_FISH = path.join(PROJECT, '.frame', 'runtime', 'shell', 'init.fish');

const deliver = (shellPath, overrides = {}) =>
  shellSetup.deliveryFor(shellPath, overrides.platform || 'darwin', 'projectPath' in overrides ? overrides.projectPath : PROJECT, {
    marker: 'marker' in overrides ? overrides.marker : '__frame_ready_t1_1_a',
    ...('isFrameProject' in overrides ? { isFrameProject: overrides.isFrameProject } : {})
  });

// ─── shellFamily ──────────────────────────────────────────────

test('the POSIX shells resolve to one family', () => {
  assert.equal(shellSetup.shellFamily('/bin/zsh'), 'posix');
  assert.equal(shellSetup.shellFamily('/bin/bash'), 'posix');
  assert.equal(shellSetup.shellFamily('/bin/sh'), 'posix');
  assert.equal(shellSetup.shellFamily('/usr/bin/dash'), 'posix');
});

test('fish is its own family, wherever it was installed', () => {
  assert.equal(shellSetup.shellFamily('/opt/homebrew/bin/fish'), 'fish');
  assert.equal(shellSetup.shellFamily('/usr/local/bin/fish'), 'fish');
});

test('a login-shell argv0 is still the same shell', () => {
  assert.equal(shellSetup.shellFamily('-zsh'), 'posix');
});

test('shells Frame has no init file for get no family', () => {
  // Not a failure: nushell's function and PATH model matches no generated
  // file, and cmd has no functions at all — doskey macros are too fragile to
  // build on, so cmd gets the PATH entry and PATHEXT resolution and no more.
  assert.equal(shellSetup.shellFamily('/usr/local/bin/nu'), '');
  assert.equal(shellSetup.shellFamily('C:\\Windows\\System32\\cmd.exe'), '');
  assert.equal(shellSetup.shellFamily(''), '');
  assert.equal(shellSetup.shellFamily(null), '');
});

// ─── shellInitPath ────────────────────────────────────────────

test('init files live inside the project overlay', () => {
  assert.equal(shellSetup.shellInitPath(PROJECT, 'posix'), INIT_SH);
  assert.equal(shellSetup.shellInitPath(PROJECT, 'fish'), INIT_FISH);
  assert.ok(shellSetup.shellInitPath(PROJECT, 'posix').startsWith(path.join(PROJECT, '.frame')));
});

test('no project or no family means no path', () => {
  assert.equal(shellSetup.shellInitPath('', 'posix'), '');
  assert.equal(shellSetup.shellInitPath(PROJECT, 'nushell'), '');
});

// ─── mintMarker ───────────────────────────────────────────────

test('markers differ across attempts on the same terminal', () => {
  const first = shellSetup.mintMarker('term-1', 1);
  const second = shellSetup.mintMarker('term-1', 2);
  assert.notEqual(first, second, 'a retry would be resolved by the first attempt\'s output');
});

test('markers differ across terminals and across repeated mints', () => {
  const a = shellSetup.mintMarker('term-1', 1);
  const b = shellSetup.mintMarker('term-2', 1);
  const c = shellSetup.mintMarker('term-1', 1);
  assert.equal(new Set([a, b, c]).size, 3);
});

test('a marker carries the shared prefix and nothing that needs quoting', () => {
  const marker = shellSetup.mintMarker('lane/with spaces:1', 1);
  assert.ok(marker.startsWith(shellSetup.MARKER_PREFIX));
  assert.match(marker, /^[A-Za-z0-9_]+$/);
});

// ─── deliveryFor · gates ──────────────────────────────────────

test('a folder that is not a Frame project gets nothing sent', () => {
  const delivery = deliver('/bin/zsh', { isFrameProject: false });
  assert.equal(delivery.mode, 'none');
  assert.equal(delivery.reason, 'not-a-frame-project');
  assert.ok(!('line' in delivery) && !('args' in delivery), 'nothing to send, nothing to define');
});

test('a lane with no project gets nothing sent', () => {
  assert.equal(deliver('/bin/zsh', { projectPath: '' }).mode, 'none');
});

test('an unsupported shell gets nothing sent', () => {
  const delivery = deliver('/usr/local/bin/nu');
  assert.equal(delivery.mode, 'none');
  assert.equal(delivery.reason, 'unsupported-shell');
});

test('no marker means no delivery', () => {
  assert.equal(deliver('/bin/zsh', { marker: '' }).mode, 'none');
});

// ─── deliveryFor · POSIX ──────────────────────────────────────

test('zsh and bash are set up by a typed line that sources the init file', () => {
  const delivery = deliver('/bin/zsh');
  assert.equal(delivery.mode, 'type');
  assert.ok(delivery.line.includes(`. '${INIT_SH}'`), delivery.line);
  assert.equal(delivery.line, deliver('/bin/bash').line, 'one file serves the family');
});

test('the typed line starts with a space so the shell can keep it out of history', () => {
  assert.ok(deliver('/bin/zsh').line.startsWith(' '));
});

test('the typed line never contains the literal marker', () => {
  // The invariant: the tty echoes this line before running it, and a scan that
  // matched the echo would report setup installed before the shell had run.
  const marker = shellSetup.mintMarker('term-9', 1);
  const delivery = shellSetup.deliveryFor('/bin/zsh', 'darwin', PROJECT, { marker });
  assert.equal(delivery.marker, marker);
  assert.ok(!delivery.line.includes(marker), `echo would match: ${delivery.line}`);
  // …while still carrying both halves, adjacent and separately quoted, so the
  // shell concatenates them back into the marker at run time.
  assert.ok(delivery.line.includes(`'${shellSetup.MARKER_PREFIX}''${marker.slice(shellSetup.MARKER_PREFIX.length)}'`));
});

test('a project path with a quote in it is escaped rather than breaking the line', () => {
  const delivery = shellSetup.deliveryFor('/bin/zsh', 'darwin', "/tmp/o'brien", { marker: '__frame_ready_x' });
  assert.ok(delivery.line.includes("'\\''"), delivery.line);
});

// ─── deliveryFor · fish ───────────────────────────────────────

test('fish is set up through -C, with nothing typed into the terminal', () => {
  const delivery = deliver('/opt/homebrew/bin/fish');
  assert.equal(delivery.mode, 'flag');
  assert.equal(delivery.args[0], '-C');
  assert.ok(delivery.args[1].includes(`source '${INIT_FISH}'`), delivery.args[1]);
  assert.ok(!('line' in delivery));
});

test('the fish command carries the split marker too', () => {
  const marker = shellSetup.mintMarker('term-fish', 1);
  const delivery = shellSetup.deliveryFor('/usr/local/bin/fish', 'darwin', PROJECT, { marker });
  assert.ok(!delivery.args[1].includes(marker));
});

// ─── initFamilies ─────────────────────────────────────────────

test('each platform delivers only the families it can actually serve', () => {
  assert.deepEqual(shellSetup.initFamilies('darwin'), ['posix', 'fish']);
  assert.deepEqual(shellSetup.initFamilies('linux'), ['posix', 'fish']);
  assert.deepEqual(shellSetup.initFamilies('win32'), ['powershell']);
});

// ─── deliveryFor · PowerShell ─────────────────────────────────

const PS_PROJECT = 'C:\\Users\\dev\\my project';
const INIT_PS1 = path.join(PS_PROJECT, '.frame', 'runtime', 'shell', 'init.ps1');

const deliverPs = (shellPath, overrides = {}) =>
  shellSetup.deliveryFor(shellPath, 'win32', 'projectPath' in overrides ? overrides.projectPath : PS_PROJECT, {
    marker: 'marker' in overrides ? overrides.marker : '__frame_ready_t1_1_a',
    ...('isFrameProject' in overrides ? { isFrameProject: overrides.isFrameProject } : {})
  });

test('powershell and pwsh are one family', () => {
  assert.equal(shellSetup.shellFamily('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'), 'powershell');
  assert.equal(shellSetup.shellFamily('C:\\Program Files\\PowerShell\\7\\pwsh.exe'), 'powershell');
  assert.equal(shellSetup.shellFamily('pwsh'), 'powershell');
});

test('a PowerShell lane is set up at spawn, with nothing typed', () => {
  const delivery = deliverPs('powershell.exe');
  assert.equal(delivery.mode, 'flag');
  assert.ok(!('line' in delivery), 'a typed line would be echoed into the user\'s terminal');
  assert.deepEqual(delivery.args.slice(0, 4), ['-ExecutionPolicy', 'Bypass', '-NoExit', '-Command']);
  assert.equal(delivery.args.length, 5);
});

test('the execution policy is lifted for this process and nothing else', () => {
  // A Windows client machine defaults to Restricted, which blocks
  // dot-sourcing an unsigned local .ps1 — the same bargain launchEnv makes
  // for PATH, scoped to a process Frame spawned.
  const args = deliverPs('pwsh.exe').args;
  assert.equal(args[0], '-ExecutionPolicy');
  assert.equal(args[1], 'Bypass');
  assert.ok(!args.includes('-Scope'), 'nothing machine-wide is touched');
});

test('the PowerShell command dot-sources the init file it was given', () => {
  const command = deliverPs('powershell.exe').args[4];
  assert.ok(command.startsWith(`. '${INIT_PS1}'; `), command);
});

test('a project path with an apostrophe is quoted the PowerShell way', () => {
  // PowerShell escapes a quote inside a literal string by doubling it, not by
  // the POSIX close-escape-reopen dance.
  const weird = "C:\\Users\\o'brien\\proj";
  const command = shellSetup.deliveryFor('pwsh.exe', 'win32', weird, { marker: '__frame_ready_x' }).args[4];
  assert.ok(command.includes("o''brien"), command);
  assert.ok(!command.includes("'\\''"), 'POSIX quoting leaked into the PowerShell line');
});

test('the literal marker never appears in what is delivered', () => {
  // The invariant that predates PowerShell: the two halves are concatenated
  // at run time, so a match can only come from real output.
  const marker = '__frame_ready_t1_1_a';
  const delivery = deliverPs('powershell.exe');
  assert.equal(delivery.marker, marker);
  for (const arg of delivery.args) {
    assert.ok(!arg.includes(marker), `the marker is spelled out in: ${arg}`);
  }
  assert.ok(delivery.args[4].includes("Write-Output ('__frame_ready_' + 't1_1_a')"), delivery.args[4]);
});

test('a PowerShell lane outside a Frame project still gets nothing', () => {
  assert.equal(deliverPs('powershell.exe', { isFrameProject: false }).reason, 'not-a-frame-project');
  assert.equal(deliverPs('powershell.exe', { projectPath: '' }).reason, 'no-project');
  assert.equal(deliverPs('powershell.exe', { marker: '' }).reason, 'no-marker');
});

// ─── deliveryFor · the Windows shells Frame leaves alone ──────

test('cmd, Git Bash and WSL are unsupported on Windows, not failures', () => {
  // The gate decision: `unsupported` stays silent — the lane works, it simply
  // has no Frame context, exactly as `nu` behaves on macOS.
  for (const shell of ['cmd.exe', 'C:\\Program Files\\Git\\bin\\bash.exe', 'wsl.exe']) {
    const delivery = deliverPs(shell);
    assert.equal(delivery.mode, 'none', shell);
    assert.equal(delivery.reason, 'unsupported-shell', shell);
    assert.ok(!('line' in delivery) && !('args' in delivery), `${shell} was sent something`);
  }
});

test('Git Bash is refused for its family, not for its name', () => {
  // bash.exe resolves to `posix`, whose init file defines functions pointing
  // at extensionless wrappers Windows never writes. Delivering it would set
  // the lane up to fail rather than leave it alone.
  assert.equal(shellSetup.shellFamily('C:\\Program Files\\Git\\bin\\bash.exe'), 'posix');
  assert.ok(!shellSetup.initFamilies('win32').includes('posix'));
});

test('init.ps1 is never offered to a Mac', () => {
  for (const shell of ['pwsh', 'powershell.exe']) {
    const delivery = shellSetup.deliveryFor(shell, 'darwin', PROJECT, { marker: '__frame_ready_x' });
    assert.equal(delivery.mode, 'none', shell);
    assert.equal(delivery.reason, 'unsupported-shell', shell);
  }
});

test('the POSIX families keep working now that the win32 short-circuit is gone', () => {
  assert.equal(deliver('/bin/zsh').mode, 'type');
  assert.equal(deliver('/opt/homebrew/bin/fish').mode, 'flag');
});

// ─── manualCommand ────────────────────────────────────────────

test('the manual command is project-relative and per family', () => {
  // It is offered on a failed lane card for the user to paste into that lane,
  // whose cwd is the project — an absolute path would be unreadable.
  assert.equal(shellSetup.manualCommand('/bin/zsh'), '. .frame/runtime/shell/init.sh');
  assert.equal(shellSetup.manualCommand('/opt/homebrew/bin/fish'), 'source .frame/runtime/shell/init.fish');
});

test('a shell Frame cannot set up has no command to suggest', () => {
  assert.equal(shellSetup.manualCommand('/usr/local/bin/nu'), '');
  assert.equal(shellSetup.manualCommand(''), '');
});

// ─── splitOnMarker ────────────────────────────────────────────

test('output before and including the marker line is dropped, the rest survives', () => {
  const marker = '__frame_ready_t1_1_a';
  const chunk = `some setup noise\n${marker}\nuser@host ~ $ `;
  const { found, rest } = shellSetup.splitOnMarker(chunk, marker);
  assert.equal(found, true);
  assert.equal(rest, 'user@host ~ $ ', 'the first prompt is what the user should see');
});

test('a marker with no terminated line yet drops the whole chunk', () => {
  const marker = '__frame_ready_t1_1_a';
  const { found, rest } = shellSetup.splitOnMarker(`noise\n${marker}`, marker);
  assert.equal(found, true);
  assert.equal(rest, '');
});

test('a chunk without the marker resolves nothing', () => {
  const { found, rest } = shellSetup.splitOnMarker('just a prompt $ ', '__frame_ready_t1_1_a');
  assert.equal(found, false);
  assert.equal(rest, '');
});

test('splitting without a marker is never a match', () => {
  assert.deepEqual(shellSetup.splitOnMarker('anything', ''), { found: false, rest: '' });
  assert.deepEqual(shellSetup.splitOnMarker(null, '__frame_ready_x'), { found: false, rest: '' });
});

// ─── purity ───────────────────────────────────────────────────

test('the module touches neither the filesystem nor Electron', () => {
  const source = require('fs').readFileSync(require.resolve('../src/main/shellSetup'), 'utf8');
  for (const forbidden of ['electron', 'fs', 'node:fs', 'child_process']) {
    assert.ok(!source.includes(`require('${forbidden}')`), `shellSetup requires ${forbidden}`);
  }

  const realLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'fs' || request === 'node:fs' || request === 'electron') {
      throw new Error(`shellSetup must not require ${request}`);
    }
    return realLoad(request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve('../src/main/shellSetup')];
    const fresh = require('../src/main/shellSetup');
    assert.equal(fresh.shellFamily('/bin/zsh'), 'posix');
  } finally {
    Module._load = realLoad;
    delete require.cache[require.resolve('../src/main/shellSetup')];
  }
});
