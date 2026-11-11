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

test('serverRootFor matches a root or a path under it, separator-safe, longest first', () => {
  const roots = ['/home/u/frame/workspaces/app/teal', '/home/u/frame/workspaces/app/te', '/srv/x/'];
  assert.equal(R.serverRootFor('/home/u/frame/workspaces/app/teal', roots), '/home/u/frame/workspaces/app/teal');
  assert.equal(R.serverRootFor('/home/u/frame/workspaces/app/teal/src/a.js', roots), '/home/u/frame/workspaces/app/teal');
  assert.equal(R.serverRootFor('/home/u/frame/workspaces/app/teal/', roots), '/home/u/frame/workspaces/app/teal');
  assert.equal(R.serverRootFor('/home/u/frame/workspaces/app/tealx/a.js', roots), null, '/teal is not a prefix of /tealx');
  assert.equal(R.serverRootFor('/home/u/frame/workspaces/app/te/a', roots), '/home/u/frame/workspaces/app/te');
  assert.equal(R.serverRootFor('/srv/x/y', roots), '/srv/x');
  assert.equal(R.serverRootFor('/Users/me/app', roots), null);
  assert.equal(R.serverRootFor('', roots), null);
  assert.equal(R.serverRootFor('/a', null), null);
});

test('mergeGitStatePayloads joins rows and keeps the server gh apart', () => {
  const local = { projectPath: '/Users/me/app', access: { gh: true, authed: true, repoName: 'me/app' }, workspaces: { a1: { dirty: 1 } } };
  const server = { projectPath: '/home/u/frame/projects/app', access: { gh: true, authed: false, repoName: 'me/app' }, workspaces: { s1: { dirty: 0, unpushed: 2 } } };
  const m = R.mergeGitStatePayloads(local, server, '/Users/me/app');
  assert.equal(m.projectPath, '/Users/me/app');
  assert.deepEqual(m.access, local.access);
  assert.deepEqual(m.serverAccess, server.access);
  assert.deepEqual(Object.keys(m.workspaces).sort(), ['a1', 's1']);
  assert.equal(R.mergeGitStatePayloads(local, null, '/Users/me/app').serverAccess, null, 'no server, no serverAccess');
  assert.deepEqual(R.mergeGitStatePayloads(null, server, '/p').access, { gh: false, authed: false, repoName: null });
});

// ─── server-hardening T3: per-boot ids and adopt pruning ─────

test('serverTerminalId carries a per-boot nonce and parses back', () => {
  assert.equal(R.serverTerminalId(3, 'a1b2c3'), 'srv-a1b2c3-3');
  assert.deepEqual(R.parseServerTerminalId('srv-a1b2c3-3'), { boot: 'a1b2c3', n: 3 });
  assert.deepEqual(R.parseServerTerminalId('srv-3'), { boot: null, n: 3 }, 'old ids still parse');
  assert.equal(R.parseServerTerminalId('term-3'), null);
  assert.equal(R.isServerTerminalId('srv-a1b2c3-3'), true, 'the prefix rule is unchanged');
});

test('adoptPlan: lanes the server no longer has are disposed; a lane whose workspace changed is recreated', () => {
  const known = [
    { terminalId: 'srv-b1-1', workspaceId: 'w1' },
    { terminalId: 'srv-b1-2', workspaceId: 'w1' },
    { terminalId: 'srv-b2-1', workspaceId: 'w1' }
  ];
  const live = [
    { terminalId: 'srv-b2-1', workspaceId: 'w2' },
    { terminalId: 'srv-b2-2', workspaceId: 'w1' }
  ];
  const plan = R.adoptPlan(known, live);
  assert.deepEqual(plan.dispose.sort(), ['srv-b1-1', 'srv-b1-2']);
  assert.deepEqual(plan.recreate, ['srv-b2-1']);
  assert.deepEqual(plan.add, ['srv-b2-2']);
});

// ─── server-hardening T6: route by workspace id ──────────────

test('routeOf: the workspace id decides; the path only without one', () => {
  const roots = [{ root: '/Users/me/frame/workspaces/app/sage', id: 'srv-ws', host: 'box' }];
  const locations = { 'srv-ws': { path: '/Users/me/frame/workspaces/app/sage', host: 'box' } };
  const samePath = '/Users/me/frame/workspaces/app/sage/src/a.js';
  // A local workspace whose folder has the same absolute path as the server one.
  assert.deepEqual(R.routeOf(samePath, { workspaceId: 'local-ws' }, roots, locations), { local: true }, 'a local id never routes remote');
  assert.deepEqual(R.routeOf(samePath, { workspaceId: 'main' }, roots, locations), { local: true });
  assert.equal(R.routeOf(samePath, { workspaceId: 'srv-ws' }, roots, locations).remote.id, 'srv-ws');
  assert.deepEqual(R.routeOf('/elsewhere/x.js', { workspaceId: 'srv-ws' }, roots, locations), { local: true }, 'a server id with a path outside its folder is not that workspace');
  assert.equal(R.routeOf(samePath, null, roots, locations).remote.id, 'srv-ws', 'no context: the old path rule');
  assert.deepEqual(R.routeOf('/other', null, roots, locations), { local: true });
});

// ─── server-onboarding: project identity and folder names ────

test('projectKey: the normalized remote, else root:<sha>, else null', () => {
  assert.equal(R.projectKey({ originUrl: 'git@github.com:Me/App.git' }), 'github.com/me/app');
  const sha = 'a'.repeat(40);
  assert.equal(R.projectKey({ originUrl: null, root: sha }), `root:${sha}`);
  assert.equal(R.projectKey({ originUrl: 'not a url', root: 'nothex' }), null);
  assert.equal(R.projectKey({}), null);
});

test('projectDirNameFor: remote names as before; a remote-less project uses its folder name, kept unique', () => {
  const sha = 'b'.repeat(40);
  assert.equal(R.projectDirNameFor({ originUrl: 'https://github.com/me/app' }, {}), 'app');
  assert.equal(R.projectDirNameFor({ root: sha, name: 'My Notes!' }, {}), 'my-notes');
  assert.equal(R.projectDirNameFor({ root: sha, name: 'notes' }, { notes: `root:${sha}` }), 'notes', 'the same project reuses its folder');
  assert.equal(R.projectDirNameFor({ root: sha, name: 'notes' }, { notes: 'github.com/x/notes' }), 'notes-2');
  assert.equal(R.projectDirNameFor({ root: sha, name: '...' }, {}), 'project');
});
