/**
 * serverInstall — installing and updating Frame Server (server-install-update spec, T01).
 * Pinned: platform → package, version order incl. dev builds, the
 * install/update/none decision, checksum files, the systemd unit, and the
 * check-up items with their fix commands.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const I = require('../src/shared/serverInstall');

test('assetFor maps uname to a package or explains why not', () => {
  assert.deepEqual(I.assetFor('Linux', 'x86_64', '2.10.0'), { platform: 'linux-x64', asset: 'frame-server-2.10.0-linux-x64.tar.gz', checksum: 'frame-server-2.10.0-linux-x64.tar.gz.sha256' });
  assert.equal(I.assetFor('Linux', 'aarch64', '2.10.0').platform, 'linux-arm64');
  assert.equal(I.assetFor('linux', 'arm64', '1.0.0').platform, 'linux-arm64');
  assert.match(I.assetFor('Darwin', 'arm64', '1.0.0').error, /manual install/);
  assert.match(I.assetFor('Linux', 'riscv64', '1.0.0').error, /riscv64/);
  assert.match(I.assetFor('FreeBSD', 'amd64', '1.0.0').error, /FreeBSD/);
  assert.equal(I.releaseUrl('2.10.0', 'a.tar.gz'), 'https://github.com/kaanozhan/Frame/releases/download/v2.10.0/a.tar.gz');
});

test('compareVersions orders releases, prereleases and dev builds', () => {
  assert.equal(I.compareVersions('2.9.0', '2.10.0'), -1);
  assert.equal(I.compareVersions('2.10.0', '2.9.9'), 1);
  assert.equal(I.compareVersions('v2.9.0', '2.9.0'), 0);
  assert.equal(I.compareVersions('2.9.0-dev+abc', '2.9.0'), -1, 'a dev build sorts before its release');
  assert.equal(I.compareVersions('2.9.0-dev+abc', '2.9.0-dev+def'), 0, 'build metadata does not order');
  assert.equal(I.compareVersions('junk', '1.0.0'), -1);
  assert.equal(I.parseVersion('2.9.0-dev+abc1234').build, 'abc1234');
});

test('installDecision: install, update, dev reinstall or nothing', () => {
  assert.equal(I.installDecision({ installed: null, desktopVersion: '2.10.0' }).action, 'install');
  assert.equal(I.installDecision({ installed: { current: null }, desktopVersion: '2.10.0' }).action, 'install');
  assert.equal(I.installDecision({ installed: { current: '2.9.0' }, desktopVersion: '2.10.0' }).action, 'update');
  assert.equal(I.installDecision({ installed: { current: '2.10.0' }, desktopVersion: '2.10.0' }).action, 'none');
  assert.equal(I.installDecision({ installed: { current: '2.11.0' }, desktopVersion: '2.10.0' }).action, 'none');
  assert.equal(I.installDecision({ installed: { current: '2.10.0' }, desktopVersion: '2.10.0', protocolOk: false }).action, 'update');
  const dev = I.installDecision({ installed: { current: '2.10.0' }, desktopVersion: '2.10.0-dev+abc', dev: true });
  assert.equal(dev.action, 'reinstall-dev');
  assert.match(dev.reason, /from source/);
  assert.equal(I.installDecision({ installed: { current: '2.10.0-dev+abc' }, desktopVersion: '2.10.0-dev+abc', dev: true }).action, 'none');
  assert.equal(I.installDecision({ installed: { current: '2.10.0', manual: true }, desktopVersion: '2.10.0' }).action, 'none');
  assert.equal(I.installDecision({ installed: { current: '2.8.0', manual: true }, desktopVersion: '2.10.0' }).action, 'update');
});

test('parseChecksum reads sha256sum output and bare digests', () => {
  const hex = 'a'.repeat(64);
  const other = 'b'.repeat(64);
  assert.equal(I.parseChecksum(`${hex}  frame-server-1.0.0-linux-x64.tar.gz\n`, 'frame-server-1.0.0-linux-x64.tar.gz'), hex);
  assert.equal(I.parseChecksum(`${other} *x.tar.gz\n${hex.toUpperCase()} *dist/y.tar.gz`, 'y.tar.gz'), hex);
  assert.equal(I.parseChecksum(`${hex}\n`, 'whatever'), hex);
  assert.equal(I.parseChecksum(`${other}  x.tar.gz`, 'y.tar.gz'), null);
  assert.equal(I.parseChecksum('not a checksum', 'y'), null);
});

test('systemdUnit runs the current version and restarts on failure', () => {
  const u = I.systemdUnit();
  assert.match(u, /ExecStart=%h\/\.frame-server\/current\/bin\/frame-server run/);
  assert.match(u, /Restart=on-failure/);
  assert.match(u, /WantedBy=default\.target/);
});

test('doctorItems: one ready agent is enough; missing items carry fixes', () => {
  const ready = I.doctorItems({
    claude: { installed: true, signedIn: true }, codex: { installed: false },
    gh: { installed: true, authed: true }, git: { installed: true }, service: { mode: 'systemd', linger: true }
  });
  assert.equal(ready.every((i) => i.ok || i.optional), true);
  assert.equal(ready.find((i) => i.id === 'codex').optional, true);
  const missing = I.doctorItems({ claude: { installed: true, signedIn: false }, gh: { installed: true }, git: {}, service: { mode: 'detached' } });
  const byId = Object.fromEntries(missing.map((i) => [i.id, i]));
  assert.equal(byId.claude.ok, false);
  assert.equal(byId.claude.optional, false, 'with no ready agent nothing is optional');
  assert.match(byId.claude.fix, /claude/);
  assert.match(byId.gh.fix, /gh auth login/);
  assert.match(byId.git.fix, /apt install -y git/);
  assert.match(byId.service.detail, /reboot/);
  assert.match(byId.service.fix, /enable-linger/);
});
