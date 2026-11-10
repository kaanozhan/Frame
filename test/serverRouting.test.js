/**
 * serverRouting — naming across desktop and server (server-workspaces spec, T01).
 * Pinned: srv- ids, remote URL normalization across scp/https/ssh forms,
 * clone folder names unique by owner, and ~/.ssh/config Host parsing.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/shared/serverRouting');

test('server terminal ids', () => {
  assert.equal(R.serverTerminalId(3), 'srv-3');
  assert.equal(R.isServerTerminalId('srv-3'), true);
  assert.equal(R.isServerTerminalId('term-3'), false);
  assert.equal(R.isServerTerminalId(null), false);
});

test('normalizeRemoteUrl folds the common remote forms', () => {
  const want = 'github.com/kaanozhan/frame';
  for (const u of [
    'git@github.com:kaanozhan/Frame.git',
    'https://github.com/kaanozhan/Frame',
    'https://github.com/kaanozhan/Frame.git/',
    'ssh://git@github.com:22/kaanozhan/Frame.git',
    'https://user@github.com/KaanOzhan/frame'
  ]) assert.equal(R.normalizeRemoteUrl(u), want, u);
  assert.equal(R.normalizeRemoteUrl('git@gitlab.example.com:group/sub/proj.git'), 'gitlab.example.com/group/sub/proj');
  assert.equal(R.normalizeRemoteUrl('/srv/Repos/x.git'), 'file:/srv/Repos/x', 'a path remote is kept as file:');
  assert.equal(R.normalizeRemoteUrl('file:///srv/Repos/x.git/'), 'file:/srv/Repos/x');
  assert.equal(R.normalizeRemoteUrl('not a url'), null);
  assert.equal(R.normalizeRemoteUrl(''), null);
  assert.equal(R.sameRemote('git@github.com:a/b.git', 'https://github.com/A/B'), true);
  assert.equal(R.sameRemote('git@github.com:a/b.git', 'https://github.com/a/c'), false);
});

test('projectDirName reuses the same remote and disambiguates by owner', () => {
  assert.equal(R.projectDirName('git@github.com:kaan/frame.git'), 'frame');
  assert.equal(R.projectDirName('git@github.com:kaan/frame.git', { frame: 'github.com/kaan/frame' }), 'frame');
  assert.equal(R.projectDirName('git@github.com:other/frame.git', { frame: 'github.com/kaan/frame' }), 'frame-other');
  assert.equal(R.projectDirName('git@github.com:other/frame.git', { frame: 'x', 'frame-other': 'y' }), 'frame-other-2');
  assert.equal(R.projectDirName('nope'), null);
  assert.equal(R.projectDirName('/srv/git/tool.git'), 'tool');
});

test('parseSshConfigHosts lists aliases without patterns', () => {
  const cfg = [
    '# servers',
    'Host hetzner box2  # two names',
    '  HostName 1.2.3.4',
    'Host *',
    '  ServerAliveInterval 30',
    'host=mini',
    'Host *.internal !bad',
    'Match host foo',
    'Host hetzner'
  ].join('\n');
  assert.deepEqual(R.parseSshConfigHosts(cfg), ['hetzner', 'box2', 'mini']);
  assert.deepEqual(R.parseSshConfigHosts(''), []);
});
