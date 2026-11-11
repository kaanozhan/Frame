/**
 * install-frame-server.sh scenarios (server-hardening C1).
 *
 * Runs the real installer against a temporary HOME with test packages built
 * here: the real `src/server/bin/frame-server` plus a stand-in server
 * (test/fixtures/fake-frame-server) that writes connection.json and stays
 * up, or one that exits at once. `systemctl` / `loginctl` are logging stubs
 * on PATH, so the systemd branch runs too (FRAME_TEST_SYSTEMD=1 swaps them
 * for the real ones on a Linux runner — see ci.yml).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'install-frame-server.sh');
const FIX = path.join(__dirname, 'fixtures', 'fake-frame-server');
const REAL_SYSTEMD = process.env.FRAME_TEST_SYSTEMD === '1';

const cleanups = [];
test.after(() => { for (const fn of cleanups.reverse()) { try { fn(); } catch (_) { /* best effort */ } } });

/** A fresh sandbox: HOME, stub bin dir, stub state, log. */
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-inst-'));
  const home = path.join(dir, 'home');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(home); fs.mkdirSync(bin);
  if (!REAL_SYSTEMD) {
    for (const f of fs.readdirSync(path.join(FIX, 'stubs'))) fs.copyFileSync(path.join(FIX, 'stubs', f), path.join(bin, f));
    for (const f of fs.readdirSync(bin)) fs.chmodSync(path.join(bin, f), 0o755);
  }
  const box = {
    dir, home, bin,
    log: path.join(dir, 'stub.log'),
    systemd: path.join(dir, 'systemd'),
    pkgs: path.join(dir, 'pkgs'),
    env(extra = {}) {
      return {
        ...process.env,
        HOME: home,
        USER: process.env.USER || 'tester',
        PATH: `${bin}:${process.env.PATH}`,
        FAKE_STUB_LOG: this.log,
        FAKE_SYSTEMD_DIR: this.systemd,
        FRAME_INSTALL_HEALTH_SECONDS: '6',
        FRAME_SERVER_HOME: '',
        ...extra
      };
    },
    stubLog() { try { return fs.readFileSync(this.log, 'utf8'); } catch (_) { return ''; } }
  };
  fs.mkdirSync(box.pkgs);
  cleanups.push(() => stopEverything(box));
  return box;
}

/** A package tarball for `version`; `good` decides whether its server starts. */
function makePackage(box, version, { good = true } = {}) {
  const top = path.join(box.pkgs, `build-${version}-${good ? 'good' : 'bad'}`, `frame-server-${version}`);
  fs.mkdirSync(path.join(top, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(top, 'app', 'src', 'server'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'src', 'server', 'bin', 'frame-server'), path.join(top, 'bin', 'frame-server'));
  fs.chmodSync(path.join(top, 'bin', 'frame-server'), 0o755);
  fs.copyFileSync(path.join(FIX, good ? 'index-good.js' : 'index-bad.js'), path.join(top, 'app', 'src', 'server', 'index.js'));
  fs.writeFileSync(path.join(top, 'VERSION'), `${version}\n`);
  // The package's own Node, as in a real package (a systemd unit has no
  // setup-node PATH): a link to the Node running the tests.
  fs.mkdirSync(path.join(top, 'node', 'bin'), { recursive: true });
  fs.rmSync(path.join(top, 'node', 'bin', 'node'), { force: true });
  fs.symlinkSync(process.execPath, path.join(top, 'node', 'bin', 'node'));
  const tarball = path.join(box.pkgs, `frame-server-${version}-${good ? 'good' : 'bad'}.tar.gz`);
  const r = spawnSync('tar', ['-czf', tarball, '-C', path.dirname(top), path.basename(top)]);
  assert.equal(r.status, 0, String(r.stderr));
  return tarball;
}

/** Run the installer; returns { code, lines, result, out }. */
function install(box, args, extraEnv) {
  const r = spawnSync('bash', [SCRIPT, ...args], { env: box.env(extraEnv), encoding: 'utf8', timeout: 60000 });
  const out = `${r.stdout || ''}`;
  const lines = out.split('\n').filter(Boolean);
  const last = lines[lines.length - 1] || '';
  let result = null;
  if (last.startsWith('FRAME_INSTALL_RESULT ')) {
    try { result = JSON.parse(last.slice('FRAME_INSTALL_RESULT '.length)); } catch (_) { result = 'unparseable'; }
  }
  return { code: r.status, lines, result, out, err: r.stderr };
}

function frameServer(box, home, args) {
  const r = spawnSync(path.join(home, 'bin', 'frame-server'), args, { env: box.env({ FRAME_SERVER_HOME: home }), encoding: 'utf8' });
  return r.stdout;
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

function serverPid(home) {
  try { return JSON.parse(fs.readFileSync(path.join(home, 'connection.json'), 'utf8')).pid; } catch (_) { return null; }
}

function stopEverything(box) {
  for (const h of [path.join(box.home, '.frame-server'), path.join(box.dir, 'other-home')]) {
    const pid = serverPid(h);
    if (pid && alive(pid)) { try { process.kill(pid, 'SIGTERM'); } catch (_) { /* gone */ } }
    try { const p = Number(fs.readFileSync(path.join(h, 'server.pid'), 'utf8')); if (p && alive(p)) process.kill(p, 'SIGTERM'); } catch (_) { /* none */ }
  }
  try { const p = Number(fs.readFileSync(path.join(box.systemd, 'pid'), 'utf8')); if (p && alive(p)) process.kill(p, 'SIGTERM'); } catch (_) { /* none */ }
  fs.rmSync(box.dir, { recursive: true, force: true });
}

// ─── S1: the result line on a systemd host ───────────────────

test('S1: on a systemd host where linger cannot be enabled, the result line is valid and says systemd', { skip: REAL_SYSTEMD }, () => {
  const box = sandbox();
  const pkg = makePackage(box, '9.0.0');
  const r = install(box, ['--package-file', pkg]);
  assert.notEqual(r.result, null, `no result line:\n${r.out}\n${r.err}`);
  assert.notEqual(r.result, 'unparseable', `last line is not JSON:\n${r.lines[r.lines.length - 1]}`);
  assert.equal(r.result.ok, true, r.out);
  assert.equal(r.result.service, 'systemd');
  assert.equal(r.code, 0);
  assert.ok(r.lines.some((l) => l.startsWith('frame-install:') && /linger/.test(l)), 'the linger advice is a progress line');
});

test('S1: a message with quotes, backslashes and a newline still gives a valid result line', () => {
  const box = sandbox();
  const r = install(box, ['--package-file', path.join(box.dir, 'we"ird\\pa\nth.tar.gz'), '--service', 'detached']);
  assert.notEqual(r.result, null, r.out);
  assert.notEqual(r.result, 'unparseable', `last line is not JSON:\n${r.lines[r.lines.length - 1]}`);
  assert.equal(r.result.ok, false);
  assert.match(r.result.message, /we"ird\\pa\nth/);
});

// ─── S6: --home touches only its own home ────────────────────

test('S6: an install for another --home leaves the default home\'s service alone', { skip: REAL_SYSTEMD }, () => {
  const box = sandbox();
  const first = install(box, ['--package-file', makePackage(box, '9.0.0')]);
  assert.equal(first.result && first.result.ok, true, first.out);
  const defaultHome = path.join(box.home, '.frame-server');
  const pid = serverPid(defaultHome);
  assert.ok(pid && alive(pid), 'the default home\'s server runs');
  fs.writeFileSync(box.log, '');

  const other = path.join(box.dir, 'other-home');
  const r = install(box, ['--home', other, '--package-file', makePackage(box, '9.0.1')]);
  assert.equal(r.result && r.result.ok, true, r.out);
  assert.equal(r.result.service, 'detached', 'another home never uses the user unit');
  assert.ok(alive(pid), 'the default home\'s server was not stopped');
  assert.doesNotMatch(box.stubLog(), /systemctl --user (stop|restart|start|disable)/, 'no unit command ran for another home');
});

// ─── S7: a stale pid is never signalled ──────────────────────

test('S7: a pid file naming an unrelated process is not signalled and reads as not running', () => {
  const box = sandbox();
  const home = path.join(box.dir, 'other-home');
  const r = install(box, ['--home', home, '--service', 'detached', '--package-file', makePackage(box, '9.0.0')]);
  assert.equal(r.result && r.result.ok, true, r.out);
  const real = serverPid(home);
  process.kill(real, 'SIGTERM');
  // The pid is now taken by something else.
  const stranger = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
  cleanups.push(() => { try { process.kill(stranger.pid, 'SIGTERM'); } catch (_) { /* gone */ } });
  fs.writeFileSync(path.join(home, 'connection.json'), JSON.stringify({ port: 1, token: 't', protocol: 1, frameVersion: '9.0.0', pid: stranger.pid }));
  fs.writeFileSync(path.join(home, 'server.pid'), String(stranger.pid));

  const status = JSON.parse(frameServer(box, home, ['status', '--json']));
  assert.equal(status.running, false, 'status does not report the stranger as Frame Server');

  const again = install(box, ['--home', home, '--service', 'detached', '--package-file', makePackage(box, '9.0.1')]);
  assert.equal(again.result && again.result.ok, true, again.out);
  assert.ok(alive(stranger.pid), 'the unrelated process was not killed');
});

// ─── S3: a failure with nothing to fall back to leaves nothing running ──

const FAST_FAIL = { FRAME_INSTALL_HEALTH_SECONDS: '2' };
const link = (home, name) => { try { return path.basename(fs.readlinkSync(path.join(home, name))); } catch (_) { return null; } };
function breakVersion(home, version) {
  fs.copyFileSync(path.join(FIX, 'index-bad.js'), path.join(home, 'versions', version, 'app', 'src', 'server', 'index.js'));
}

test('S3: a failed first install on a systemd host disables the unit and leaves no dangling links', { skip: REAL_SYSTEMD }, () => {
  const box = sandbox();
  const home = path.join(box.home, '.frame-server');
  const r = install(box, ['--package-file', makePackage(box, '9.0.0', { good: false })], FAST_FAIL);
  assert.equal(r.result && r.result.ok, false, r.out);
  assert.equal(r.code, 13);
  assert.equal(fs.existsSync(path.join(box.systemd, 'enabled')), false, 'the unit is not left enabled');
  assert.equal(fs.existsSync(path.join(box.home, '.config', 'systemd', 'user', 'frame-server.service')), false, 'the unit file is removed');
  assert.match(box.stubLog(), /systemctl --user disable/);
  assert.equal(link(home, 'current'), null, 'no current link to a deleted version');
  assert.equal(link(home, 'bin/frame-server'), null, 'no bin link');
});

test('S3: a failed first detached install leaves no current link and no process', () => {
  const box = sandbox();
  const home = path.join(box.dir, 'other-home');
  const r = install(box, ['--home', home, '--service', 'detached', '--package-file', makePackage(box, '9.0.0', { good: false })], FAST_FAIL);
  assert.equal(r.code, 13, r.out);
  assert.equal(link(home, 'current'), null);
  assert.equal(fs.existsSync(path.join(home, 'server.pid')), false);
});

test('S3: a failed --service-only stops and disables the unit', { skip: REAL_SYSTEMD }, () => {
  const box = sandbox();
  const home = path.join(box.home, '.frame-server');
  assert.equal(install(box, ['--package-file', makePackage(box, '9.0.0')]).code, 0);
  breakVersion(home, '9.0.0');
  const r = install(box, ['--service-only'], FAST_FAIL);
  assert.equal(r.code, 13, r.out);
  assert.equal(fs.existsSync(path.join(box.systemd, 'enabled')), false, 'not left restarting');
  assert.equal(link(home, 'current'), '9.0.0', 'the installed version stays installed');
});

// ─── S5: rollback keeps its target ───────────────────────────

test('S5: a failed rollback leaves current and previous as they were', () => {
  const box = sandbox();
  const home = path.join(box.dir, 'other-home');
  const args = ['--home', home, '--service', 'detached'];
  assert.equal(install(box, [...args, '--package-file', makePackage(box, '9.0.0')]).code, 0);
  assert.equal(install(box, [...args, '--package-file', makePackage(box, '9.0.1')]).code, 0);
  breakVersion(home, '9.0.0');
  const r = install(box, [...args, '--rollback'], FAST_FAIL);
  assert.equal(r.code, 13, r.out);
  assert.equal(link(home, 'current'), '9.0.1');
  assert.equal(link(home, 'previous'), '9.0.0', 'previous still names the rollback target');
  assert.equal(JSON.parse(frameServer(box, home, ['status', '--json'])).runningVersion, '9.0.1');
});

test('S5: a failed reinstall of the previous version keeps the installed copy', () => {
  const box = sandbox();
  const home = path.join(box.dir, 'other-home');
  const args = ['--home', home, '--service', 'detached'];
  assert.equal(install(box, [...args, '--package-file', makePackage(box, '9.0.0')]).code, 0);
  assert.equal(install(box, [...args, '--package-file', makePackage(box, '9.0.1')]).code, 0);
  const r = install(box, [...args, '--package-file', makePackage(box, '9.0.0', { good: false })], FAST_FAIL);
  assert.equal(r.code, 13, r.out);
  assert.equal(link(home, 'current'), '9.0.1');
  assert.equal(link(home, 'previous'), '9.0.0');
  const index = fs.readFileSync(path.join(home, 'versions', '9.0.0', 'app', 'src', 'server', 'index.js'), 'utf8');
  assert.match(index, /writeFileSync/, 'the good 9.0.0 copy is back');
});

// ─── S10: one installer at a time ────────────────────────────

test('S10: a second installer exits with code 16 while one runs; a stale lock is taken over', () => {
  const box = sandbox();
  const home = path.join(box.dir, 'other-home');
  const args = ['--home', home, '--service', 'detached'];
  fs.mkdirSync(path.join(home, 'install.lock'), { recursive: true });
  fs.writeFileSync(path.join(home, 'install.lock', 'pid'), String(process.pid)); // alive
  const busy = install(box, [...args, '--package-file', makePackage(box, '9.0.0')]);
  assert.equal(busy.code, 16, busy.out);
  assert.equal(busy.result.code, 16);
  assert.equal(link(home, 'current'), null, 'nothing was installed');

  fs.writeFileSync(path.join(home, 'install.lock', 'pid'), '999999'); // dead
  const ok = install(box, [...args, '--package-file', makePackage(box, '9.0.0')]);
  assert.equal(ok.code, 0, ok.out);
  assert.equal(fs.existsSync(path.join(home, 'install.lock')), false, 'the lock is released');
});

// ─── S2: the glibc floor ─────────────────────────────────────

/** A Linux host whose C library says `libc` (getconf) / `ldd` text. */
function fakeLinux(box, { getconf, ldd }) {
  fs.writeFileSync(path.join(box.bin, 'uname'), '#!/bin/sh\ncase "$1" in -s) echo Linux;; -m) echo x86_64;; *) echo Linux x86_64;; esac\n', { mode: 0o755 });
  fs.writeFileSync(path.join(box.bin, 'getconf'), getconf ? `#!/bin/sh\n[ "$1" = GNU_LIBC_VERSION ] && echo "${getconf}" && exit 0\nexit 1\n` : '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  fs.writeFileSync(path.join(box.bin, 'ldd'), `#!/bin/sh\necho "${ldd || ''}" >&2\nexit 1\n`, { mode: 0o755 });
}

test('S2: glibc older than 2.28 is refused, naming the requirement', { skip: REAL_SYSTEMD }, () => {
  const box = sandbox();
  fakeLinux(box, { getconf: 'glibc 2.26' });
  const home = path.join(box.dir, 'other-home');
  const r = install(box, ['--home', home, '--service', 'detached', '--package-file', makePackage(box, '9.0.0')]);
  assert.equal(r.code, 14, r.out);
  assert.match(r.result.message, /glibc 2\.28 or newer/);
  assert.match(r.result.message, /2\.26/);
  assert.equal(link(home, 'current'), null, 'nothing installed');
});

test('S2: musl is refused, naming the requirement', { skip: REAL_SYSTEMD }, () => {
  const box = sandbox();
  fakeLinux(box, { getconf: null, ldd: 'musl libc (x86_64) Version 1.2.4' });
  const r = install(box, ['--home', path.join(box.dir, 'other-home'), '--service', 'detached', '--package-file', makePackage(box, '9.0.0')]);
  assert.equal(r.code, 14, r.out);
  assert.match(r.result.message, /musl/);
  assert.match(r.result.message, /glibc 2\.28/);
});

test('S2: glibc 2.28 and newer install', { skip: REAL_SYSTEMD }, () => {
  const box = sandbox();
  fakeLinux(box, { getconf: 'glibc 2.28' });
  const r = install(box, ['--home', path.join(box.dir, 'other-home'), '--service', 'detached', '--package-file', makePackage(box, '9.0.0')]);
  assert.equal(r.code, 0, r.out);
});

// ─── C1: the real systemd path (CI job with FRAME_TEST_SYSTEMD=1) ──

test('C1: real systemd — install runs as a user unit, a broken update rolls back, the unit is removed after', { skip: !REAL_SYSTEMD }, () => {
  const box = sandbox();
  // The unit's ExecStart is %h/.frame-server: this run uses the real home.
  const realHome = os.homedir();
  const env = { HOME: realHome, FRAME_INSTALL_HEALTH_SECONDS: '15' };
  const home = path.join(realHome, '.frame-server');
  const sys = (...a) => spawnSync('systemctl', ['--user', ...a], { encoding: 'utf8' });
  try {
    const first = install(box, ['--package-file', makePackage(box, '9.0.0')], env);
    assert.equal(first.code, 0, first.out + first.err);
    assert.equal(first.result.service, 'systemd');
    assert.equal(sys('is-active', 'frame-server').status, 0, 'the unit runs');
    const bad = install(box, ['--package-file', makePackage(box, '9.0.1', { good: false })], env);
    assert.equal(bad.code, 13, bad.out);
    assert.equal(link(home, 'current'), '9.0.0');
    assert.equal(sys('is-active', 'frame-server').status, 0, 'the old version runs again');
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'connection.json'), 'utf8')).frameVersion, '9.0.0');
  } finally {
    sys('disable', '--now', 'frame-server');
    fs.rmSync(path.join(realHome, '.config', 'systemd', 'user', 'frame-server.service'), { force: true });
    sys('daemon-reload');
    fs.rmSync(home, { recursive: true, force: true });
  }
});
