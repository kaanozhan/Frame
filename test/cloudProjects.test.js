/**
 * cloudProjects tests — the pure core of Frame Cloud projects.
 * Runs with Node's built-in runner: `npm test` (node --test test/).
 * No Electron, no network: fetch is a fake.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const core = require('../src/main/cloud/cloudProjects');
const { CloudError } = require('../src/main/cloud/deviceFlow');

const API = 'http://cloud.test';

// ─── Fakes ────────────────────────────────────────────────────

/**
 * Scripted fetch: `routes[path]` is an array of answers consumed in order
 * (the last one repeats). An answer is `{ status, body }`, an Error to throw,
 * or a function `(call) => answer`. A GET's `?input=` is decoded into `input`.
 */
function fakeFetch(routes) {
  const calls = [];
  const fetchJson = async (url, opts = {}) => {
    const [path, query = ''] = url.slice(API.length).split('?');
    const input = query.startsWith('input=')
      ? JSON.parse(decodeURIComponent(query.slice('input='.length)))
      : opts.body;
    calls.push({ url, path, query, input, ...opts });
    const queue = routes[path];
    if (!queue) throw new Error(`unexpected request ${path}`);
    let answer = queue.length > 1 ? queue.shift() : queue[0];
    if (typeof answer === 'function') answer = answer(calls[calls.length - 1]);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { fetchJson, calls };
}

const ok = (data) => ({ status: 200, body: { result: { data } } });
const trpcErr = (status, message, code) => ({
  status,
  body: { error: { message, data: { code: code || message, httpStatus: status } } },
});
const LINKED = { projectId: 'p1', projectSlug: 'my-app', workspaceSlug: 'lab' };

function project(id, overrides = {}) {
  return {
    id,
    slug: `${id}-slug`,
    name: `Project ${id}`,
    status: { source: 'scratch', link: 'unlinked', frame: null, github: null },
    frameProjectId: null,
    createdAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

// ─── Reading ──────────────────────────────────────────────────

test('listProjects is a GET with the bearer token and normalizes each entry', async () => {
  const { fetchJson, calls } = fakeFetch({
    '/trpc/project.list': [ok([
      project('p1', { status: { source: 'github' }, frameProjectId: 'f1' }),
      project('p2'),
      { slug: 'no-id' },
    ])],
  });
  const list = await core.listProjects({ api: API, token: 'tk', fetchJson });
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].token, 'tk');
  assert.equal(calls[0].query, '');
  assert.deepEqual(list.map((p) => [p.id, p.source, p.frameProjectId]), [
    ['p1', 'github', 'f1'],
    ['p2', 'scratch', null],
  ]);
});

test('listProjects answers [] for a body that is not a list', async () => {
  const { fetchJson } = fakeFetch({ '/trpc/project.list': [ok({ nope: true })] });
  assert.deepEqual(await core.listProjects({ api: API, token: 'tk', fetchJson }), []);
});

// ─── Matching ─────────────────────────────────────────────────

const norm = (list) => list.map(core.normalizeProject);

test('matchFolders: a cloud-only project is listed with no folder (S1)', () => {
  const { projectRows, folderRows } = core.matchFolders(norm([project('p1')]), []);
  assert.deepEqual(folderRows, []);
  assert.deepEqual(projectRows, [{
    id: 'p1', slug: 'p1-slug', name: 'Project p1', source: 'scratch',
    state: 'notClaimed', folderNames: [], openPath: null,
  }]);
});

test('normalizeProject: thisDevice is true only for connection.thisDevice === true', () => {
  assert.equal(core.normalizeProject(project('p1', { connection: { thisDevice: true, devices: ['Studio'] } })).thisDevice, true);
  assert.equal(core.normalizeProject(project('p1', { connection: { thisDevice: false, devices: [] } })).thisDevice, false);
  assert.equal(core.normalizeProject(project('p1', { connection: { thisDevice: null, devices: [] } })).thisDevice, false);
  assert.equal(core.normalizeProject(project('p1', { connection: { thisDevice: 'yes' } })).thisDevice, false);
  assert.equal(core.normalizeProject(project('p1')).thisDevice, false, 'a server without connections');
});

test('matchFolders: a folder this device has connected is connected on both sides (S5)', () => {
  const { projectRows, folderRows } = core.matchFolders(
    norm([project('p1', { frameProjectId: 'f1', connection: { thisDevice: true } }), project('p2')]),
    [{ path: '/code/app', name: 'app', projectId: 'f1' }]
  );
  assert.deepEqual(folderRows, [{
    path: '/code/app', name: 'app', connected: true, ready: false,
    project: { id: 'p1', slug: 'p1-slug', name: 'Project p1' },
  }]);
  assert.equal(projectRows[0].state, 'connected');
  assert.deepEqual(projectRows[0].folderNames, ['app']);
  assert.equal(projectRows[0].openPath, '/code/app');
  assert.equal(projectRows[1].state, 'notClaimed');
});

test("matchFolders: a teammate's clone of a claimed project is ready, not connected", () => {
  const { projectRows, folderRows } = core.matchFolders(
    norm([project('p1', { frameProjectId: 'f1', connection: { thisDevice: false, devices: [] } })]),
    [{ path: '/code/app', name: 'app', projectId: 'f1' }]
  );
  assert.deepEqual(folderRows, [{
    path: '/code/app', name: 'app', connected: false, ready: true,
    project: { id: 'p1', slug: 'p1-slug', name: 'Project p1' },
  }]);
  assert.equal(projectRows[0].state, 'ready');
  assert.deepEqual(projectRows[0].folderNames, ['app']);
});

test('matchFolders: a claimed project with no folder here reads notConnected', () => {
  const { projectRows } = core.matchFolders(
    norm([project('p1', { frameProjectId: 'f1', connection: { thisDevice: false } })]),
    [{ path: '/code/other', name: 'other', projectId: 'f9' }]
  );
  assert.equal(projectRows[0].state, 'notConnected');
  assert.deepEqual(projectRows[0].folderNames, []);
  assert.equal(projectRows[0].openPath, null);
});

test('matchFolders: a connected device with no folder here still reads connected', () => {
  const { projectRows } = core.matchFolders(
    norm([project('p1', { frameProjectId: 'f1', connection: { thisDevice: true } })]),
    []
  );
  assert.equal(projectRows[0].state, 'connected');
  assert.deepEqual(projectRows[0].folderNames, []);
  assert.equal(projectRows[0].openPath, null);
});

test('matchFolders: never matches by name or path', () => {
  const { projectRows, folderRows } = core.matchFolders(
    norm([project('p1', { name: 'app', slug: 'app' })]),
    [{ path: '/code/app', name: 'app', projectId: 'f9' }]
  );
  assert.equal(folderRows[0].connected, false);
  assert.equal(folderRows[0].project, null);
  assert.deepEqual(projectRows[0].folderNames, []);
});

test('matchFolders: two folders sharing an id follow the one device connection', () => {
  const connected = core.matchFolders(
    norm([project('p1', { frameProjectId: 'f1', connection: { thisDevice: true } })]),
    [
      { path: '/a/app', name: 'app', projectId: 'f1' },
      { path: '/b/app-clone', name: 'app-clone', projectId: 'f1' },
    ]
  );
  assert.deepEqual(connected.folderRows.map((f) => [f.connected, f.ready]), [[true, false], [true, false]]);
  const ready = core.matchFolders(
    norm([project('p1', { frameProjectId: 'f1' })]),
    [
      { path: '/a/app', name: 'app', projectId: 'f1' },
      { path: '/b/app-clone', name: 'app-clone', projectId: 'f1' },
    ]
  );
  assert.deepEqual(ready.folderRows.map((f) => [f.connected, f.ready]), [[false, true], [false, true]]);
  assert.equal(ready.projectRows[0].state, 'ready');
});

test('matchFolders: two folders sharing an id are both named, the first opens', () => {
  const { projectRows, folderRows } = core.matchFolders(
    norm([project('p1', { frameProjectId: 'f1', connection: { thisDevice: true } })]),
    [
      { path: '/a/app', name: 'app', projectId: 'f1' },
      { path: '/b/app-clone', name: 'app-clone', projectId: 'f1' },
    ]
  );
  assert.deepEqual(folderRows.map((f) => f.connected), [true, true]);
  assert.deepEqual(projectRows[0].folderNames, ['app', 'app-clone']);
  assert.equal(projectRows[0].openPath, '/a/app');
});

test('matchFolders: an id no longer listed falls back to not connected (S8)', () => {
  const { folderRows } = core.matchFolders(
    norm([project('p2', { frameProjectId: 'f2' })]),
    [{ path: '/code/app', name: 'app', projectId: 'f1' }]
  );
  assert.equal(folderRows[0].connected, false);
  assert.equal(folderRows[0].ready, false);
  assert.equal(folderRows[0].project, null);
});

test('matchFolders: a folder with no id is not connected, even to an unlinked project', () => {
  const { projectRows, folderRows } = core.matchFolders(
    norm([project('p1')]),
    [{ path: '/code/app', name: 'app', projectId: null }]
  );
  assert.equal(folderRows[0].connected, false);
  assert.deepEqual(projectRows[0].folderNames, []);
});

test('matchFolders: an identity alone no longer reads connected — only this device connecting does', () => {
  const { projectRows } = core.matchFolders(norm([project('p1', { frameProjectId: 'f1' })]), [
    { path: '/code/other', name: 'other', projectId: 'f2' },
  ]);
  assert.equal(projectRows[0].state, 'notConnected');
  assert.equal('connected' in projectRows[0], false);
});

// ─── Linking calls ────────────────────────────────────────────

test('checkSlug sends the slug as query input and answers availability', async () => {
  const { fetchJson, calls } = fakeFetch({ '/trpc/project.checkSlug': [ok({ available: false }), ok({ available: true })] });
  assert.equal(await core.checkSlug({ api: API, token: 'tk', fetchJson, slug: 'my-app' }), false);
  assert.equal(await core.checkSlug({ api: API, token: 'tk', fetchJson, slug: 'my-app-2' }), true);
  assert.equal(calls[0].method, 'GET');
  assert.deepEqual(calls[0].input, { slug: 'my-app' });
});

test('getCandidates sends only the fields it has and keeps server order', async () => {
  const { fetchJson, calls } = fakeFetch({
    '/trpc/link.candidates': [ok([
      { id: 'p1', slug: 'app', name: 'App', match: 'id', frameProjectId: null },
      { id: 'p2', slug: 'app-web', name: 'App web', match: 'remote', frameProjectId: 'f9' },
      { id: 'p3', slug: 'app-3', name: 'app', match: 'name', frameProjectId: null },
      { id: 'p4', slug: 'other', name: 'Other', match: null, frameProjectId: null },
      { id: 'p5', slug: 'odd', name: 'Odd', match: 'guess' },
    ])],
  });
  const list = await core.getCandidates({ api: API, token: 'tk', fetchJson, folderName: 'app', remote: undefined, frameProjectId: null });
  assert.equal(calls[0].method, 'GET');
  assert.deepEqual(calls[0].input, { folderName: 'app' });
  assert.deepEqual(list.map((c) => [c.id, c.match]), [['p1', 'id'], ['p2', 'remote'], ['p3', 'name'], ['p4', null], ['p5', null]]);

  await core.getCandidates({ api: API, token: 'tk', fetchJson, folderName: 'app', remote: 'git@x:a/b.git', frameProjectId: 'f1' });
  assert.deepEqual(calls[1].input, { folderName: 'app', remote: 'git@x:a/b.git', frameProjectId: 'f1' });
});

test('claim → FRAME_PROJECT_MISMATCH → confirmed retry sends takeOver', async () => {
  const { fetchJson, calls } = fakeFetch({
    '/trpc/link.claim': [trpcErr(409, 'FRAME_PROJECT_MISMATCH', 'CONFLICT'), ok(LINKED)],
  });
  const args = { api: API, token: 'tk', fetchJson, projectId: 'p1', frameProjectId: 'f1' };
  await assert.rejects(core.claim(args), (err) => core.classifyLinkError(err) === 'mismatch');
  assert.deepEqual(calls[0].body, { projectId: 'p1', frameProjectId: 'f1' });
  assert.deepEqual(await core.claim({ ...args, takeOver: true }), LINKED);
  assert.deepEqual(calls[1].body, { projectId: 'p1', frameProjectId: 'f1', takeOver: true });
});

test('claim → REMOTE_MISMATCH → confirmed retry sends acceptRemoteMismatch', async () => {
  const { fetchJson, calls } = fakeFetch({
    '/trpc/link.claim': [trpcErr(409, 'REMOTE_MISMATCH', 'CONFLICT'), ok(LINKED)],
  });
  const args = { api: API, token: 'tk', fetchJson, projectId: 'p1', frameProjectId: 'f1', remote: 'git@x:a/b.git' };
  await assert.rejects(core.claim(args), (err) => core.classifyLinkError(err) === 'remoteMismatch');
  await core.claim({ ...args, acceptRemoteMismatch: true });
  assert.deepEqual(calls[1].body, { projectId: 'p1', frameProjectId: 'f1', remote: 'git@x:a/b.git', acceptRemoteMismatch: true });
});

test('claim on a stale list answers taken', async () => {
  const { fetchJson } = fakeFetch({ '/trpc/link.claim': [trpcErr(409, 'FRAME_PROJECT_TAKEN', 'CONFLICT')] });
  await assert.rejects(
    core.claim({ api: API, token: 'tk', fetchJson, projectId: 'p1', frameProjectId: 'f1' }),
    (err) => core.classifyLinkError(err) === 'taken'
  );
});

test('create posts name, slug and identity, and a taken slug classifies as slugTaken', async () => {
  const { fetchJson, calls } = fakeFetch({ '/trpc/link.create': [trpcErr(409, 'SLUG_TAKEN', 'CONFLICT'), ok(LINKED)] });
  const args = { api: API, token: 'tk', fetchJson, name: 'My App', slug: 'my-app', frameProjectId: 'f1' };
  await assert.rejects(core.create(args), (err) => core.classifyLinkError(err) === 'slugTaken');
  assert.deepEqual(await core.create({ ...args, slug: core.nextSlug('my-app') }), LINKED);
  assert.deepEqual(calls[1].body, { name: 'My App', slug: 'my-app-2', frameProjectId: 'f1' });
});

test('connect posts the project and the folder identity, and unwraps the answer', async () => {
  const { fetchJson, calls } = fakeFetch({ '/trpc/link.connect': [ok(LINKED)] });
  assert.deepEqual(await core.connect({ api: API, token: 'tk', fetchJson, projectId: 'p1', frameProjectId: 'f1' }), LINKED);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].token, 'tk');
  assert.deepEqual(calls[0].body, { projectId: 'p1', frameProjectId: 'f1' });
});

test('connect on a stale list: an unclaimed project reads unlinked, a taken-over one mismatch', async () => {
  const { fetchJson } = fakeFetch({
    '/trpc/link.connect': [trpcErr(409, 'PROJECT_UNLINKED', 'CONFLICT'), trpcErr(409, 'FRAME_PROJECT_MISMATCH', 'CONFLICT')],
  });
  const args = { api: API, token: 'tk', fetchJson, projectId: 'p1', frameProjectId: 'f1' };
  await assert.rejects(core.connect(args), (err) => core.classifyLinkError(err) === 'unlinked');
  await assert.rejects(core.connect(args), (err) => core.classifyLinkError(err) === 'mismatch');
});

test('disconnect posts the project id only', async () => {
  const { fetchJson, calls } = fakeFetch({ '/trpc/link.disconnect': [ok({ ok: true })] });
  assert.deepEqual(await core.disconnect({ api: API, token: 'tk', fetchJson, projectId: 'p1' }), { ok: true });
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].body, { projectId: 'p1' });
});

test('disconnect throws on a refusal, a missing project reading notFound', async () => {
  const { fetchJson } = fakeFetch({ '/trpc/link.disconnect': [trpcErr(404, 'PROJECT_NOT_FOUND', 'NOT_FOUND')] });
  await assert.rejects(
    core.disconnect({ api: API, token: 'tk', fetchJson, projectId: 'p1' }),
    (err) => core.classifyLinkError(err) === 'notFound'
  );
});

test('release is gone: FrameCloud removed link.release', () => {
  assert.equal(core.release, undefined);
});

test('classifyLinkError maps server codes and transport kinds', async () => {
  const cases = [
    [trpcErr(409, 'REMOTE_MISMATCH', 'CONFLICT'), 'remoteMismatch'],
    [trpcErr(409, 'FRAME_PROJECT_MISMATCH', 'CONFLICT'), 'mismatch'],
    [trpcErr(409, 'FRAME_PROJECT_TAKEN', 'CONFLICT'), 'taken'],
    [trpcErr(409, 'PROJECT_UNLINKED', 'CONFLICT'), 'unlinked'],
    [trpcErr(409, 'SLUG_TAKEN', 'CONFLICT'), 'slugTaken'],
    [trpcErr(400, 'Invalid input', 'BAD_REQUEST'), 'badRequest'],
    [trpcErr(404, 'PROJECT_NOT_FOUND', 'NOT_FOUND'), 'notFound'],
    [trpcErr(401, 'UNAUTHORIZED'), 'unauthorized'],
    [trpcErr(412, 'Device not registered', 'DEVICE_NOT_REGISTERED'), 'notRegistered'],
    [trpcErr(412, 'NO_WORKSPACE'), 'noWorkspace'],
    [trpcErr(429, 'slow', 'TOO_MANY_REQUESTS'), 'network'],
    [trpcErr(503, 'down', 'INTERNAL_SERVER_ERROR'), 'network'],
    [new Error('offline'), 'network'],
    [trpcErr(409, 'SOMETHING_NEW', 'CONFLICT'), 'other'],
  ];
  for (const [answer, kind] of cases) {
    const { fetchJson } = fakeFetch({ '/trpc/link.claim': [answer] });
    await assert.rejects(
      core.claim({ api: API, token: 'tk', fetchJson, projectId: 'p1', frameProjectId: 'f1' }),
      (err) => {
        assert.equal(core.classifyLinkError(err), kind, JSON.stringify(answer.body || answer.message));
        return true;
      }
    );
  }
  assert.equal(core.classifyLinkError(null), 'other');
  assert.equal(core.classifyLinkError(new CloudError('other', { status: 401 })), 'unauthorized');
});

// ─── Slugs ────────────────────────────────────────────────────

test('suggestSlug lowercases, transliterates and hyphenates', () => {
  assert.equal(core.suggestSlug('My App'), 'my-app');
  assert.equal(core.suggestSlug('  Frame -- Cloud!! '), 'frame-cloud');
  assert.equal(core.suggestSlug('İstanbul Şehir Çiçekleri'), 'istanbul-sehir-cicekleri');
  assert.equal(core.suggestSlug('Işık Ğüzel Ödev'), 'isik-guzel-odev');
  assert.equal(core.suggestSlug('Café Straße'), 'cafe-strasse');
  assert.equal(core.suggestSlug('app_v2.final'), 'app-v2-final');
});

test('suggestSlug cuts to 32 characters without a trailing hyphen', () => {
  const slug = core.suggestSlug('abcdefghij abcdefghij abcdefghi xyz');
  assert.equal(slug, 'abcdefghij-abcdefghij-abcdefghi');
  assert.ok(slug.length <= 32);
  assert.equal(core.suggestSlug('a'.repeat(40)).length, 32);
});

test('suggestSlug leaves the field empty when nothing valid comes out', () => {
  for (const name of ['', 'ab', '日本語', '!!!', 'Settings', 'new', 'Projects', null, undefined]) {
    assert.equal(core.suggestSlug(name), '', String(name));
  }
});

test('validateSlug names what is wrong', () => {
  assert.equal(core.validateSlug('my-app'), null);
  assert.equal(core.validateSlug('abc'), null);
  assert.equal(core.validateSlug('a'.repeat(32)), null);
  assert.equal(core.validateSlug(''), 'empty');
  assert.equal(core.validateSlug(undefined), 'empty');
  assert.equal(core.validateSlug('ab'), 'length');
  assert.equal(core.validateSlug('a'.repeat(33)), 'length');
  for (const bad of ['My-app', 'my--app', '-app', 'app-', 'my_app', 'my app', 'çay']) {
    assert.equal(core.validateSlug(bad), 'format', bad);
  }
  for (const word of core.RESERVED_SLUGS) assert.equal(core.validateSlug(word), 'reserved', word);
});

test('nextSlug counts up and stays within 32 characters', () => {
  assert.equal(core.nextSlug('app'), 'app-2');
  assert.equal(core.nextSlug('app-2'), 'app-3');
  assert.equal(core.nextSlug('app-9'), 'app-10');
  assert.equal(core.nextSlug('v-2-app'), 'v-2-app-2');
  const long = core.nextSlug('a'.repeat(32));
  assert.equal(long.length, 32);
  assert.ok(long.endsWith('-2'));
  assert.equal(core.validateSlug(long), null);
  assert.equal(core.validateSlug(core.nextSlug('abcdefghijklmnopqrstuvwxyz-abcde')), null);
});

// ─── Row planning ─────────────────────────────────────────────

const FOLDER = { path: '/code/my-app', name: 'My App', connected: false, project: null };
const cand = (id, match, frameProjectId = null) => ({ id, slug: `${id}-slug`, name: `Project ${id}`, match, frameProjectId });

test('planFolderRow: an id match is a checked connect row labelled "Your repository"', () => {
  const plan = core.planFolderRow(FOLDER, [cand('p1', 'id'), cand('p2', null)]);
  assert.equal(plan.group, 'connect');
  assert.equal(plan.candidate.id, 'p1');
  assert.equal(plan.matchLabel, 'Your repository');
  assert.equal(plan.alreadyConnected, false);
  assert.equal(plan.checked, true);
  assert.deepEqual(plan.options.map((o) => o.id), ['p1', 'p2']);
});

test('planFolderRow: a remote match is checked and labelled "Same remote"', () => {
  const plan = core.planFolderRow(FOLDER, [cand('p1', 'remote')]);
  assert.equal(plan.matchLabel, 'Same remote');
  assert.equal(plan.checked, true);
});

test('planFolderRow: a name match starts unchecked', () => {
  const plan = core.planFolderRow(FOLDER, [cand('p1', 'name')]);
  assert.equal(plan.group, 'connect');
  assert.equal(plan.matchLabel, 'Same name');
  assert.equal(plan.checked, false);
});

test('planFolderRow: a candidate carrying another identity is noted and unchecked (S4)', () => {
  const plan = core.planFolderRow(FOLDER, [cand('p1', 'remote', 'f-other')], 'f-mine');
  assert.equal(plan.alreadyConnected, true);
  assert.equal(plan.checked, false);
  const noId = core.planFolderRow(FOLDER, [cand('p1', 'id', 'f-other')]);
  assert.equal(noId.alreadyConnected, true, 'a folder with no id differs from any identity (S6)');
  assert.equal(noId.checked, false);
});

test('planFolderRow: a candidate carrying this folder\'s own id is not "already connected"', () => {
  const plan = core.planFolderRow(FOLDER, [cand('p1', 'id', 'f-mine')], 'f-mine');
  assert.equal(plan.alreadyConnected, false);
  assert.equal(plan.checked, true);
});

test('planFolderRow: the first matching candidate wins, whatever sits before it', () => {
  const plan = core.planFolderRow(FOLDER, [cand('p0', null), cand('p1', 'name'), cand('p2', 'id')]);
  assert.equal(plan.candidate.id, 'p1');
  assert.equal(plan.checked, false);
});

test('planFolderRow: no match makes an unchecked create row with name and slug prefilled (S2)', () => {
  for (const candidates of [[], [cand('p1', null)], undefined]) {
    const plan = core.planFolderRow(FOLDER, candidates);
    assert.equal(plan.group, 'create');
    assert.equal(plan.candidate, null);
    assert.equal(plan.checked, false);
    assert.equal(plan.name, 'My App');
    assert.equal(plan.slug, 'my-app');
  }
});

test('planFolderRow: every option carries its label and taken state for the picker', () => {
  const plan = core.planFolderRow(FOLDER, [cand('p1', 'name'), cand('p2', null, 'f9')]);
  assert.deepEqual(plan.options, [
    { id: 'p1', slug: 'p1-slug', name: 'Project p1', match: 'name', matchLabel: 'Same name', alreadyConnected: false },
    { id: 'p2', slug: 'p2-slug', name: 'Project p2', match: null, matchLabel: '', alreadyConnected: true },
  ]);
});

test('shouldAutoShowDevices: only after a user-started sign-in, not dismissed, with work to do', () => {
  const rows = [
    [true, false, 2, true],
    [true, false, 0, false],
    [true, true, 2, false],
    [false, false, 2, false],
    [false, true, 0, false],
  ];
  for (const [userStartedSignIn, dismissed, unconnectedCount, expected] of rows) {
    assert.equal(
      core.shouldAutoShowDevices({ userStartedSignIn, dismissed, unconnectedCount }),
      expected,
      JSON.stringify({ userStartedSignIn, dismissed, unconnectedCount })
    );
  }
  assert.equal(core.shouldAutoShowDevices(), false);
});

test('shouldAutoShowDevices: never for a role that cannot connect a folder', () => {
  const ready = { userStartedSignIn: true, dismissed: false, unconnectedCount: 2 };
  assert.equal(core.shouldAutoShowDevices({ ...ready, canWork: false }), false);
  assert.equal(core.shouldAutoShowDevices({ ...ready, canWork: true }), true);
  // A caller that does not know the role keeps today's behaviour.
  assert.equal(core.shouldAutoShowDevices(ready), true);
});

// ─── Roles ────────────────────────────────────────────────────

test('can: the protocol map — admin works and manages, developer works, viewer neither', () => {
  const rows = [
    ['admin', 'work', true],
    ['admin', 'manage', true],
    ['developer', 'work', true],
    ['developer', 'manage', false],
    ['viewer', 'work', false],
    ['viewer', 'manage', false],
  ];
  for (const [role, permission, expected] of rows) {
    assert.equal(core.can(role, permission), expected, `${role} ${permission}`);
  }
});

test('can: an unknown role, a missing role or an unknown permission holds nothing', () => {
  for (const role of ['pm', 'owner', '', null, undefined, 42]) {
    assert.equal(core.can(role, 'work'), false, String(role));
    assert.equal(core.can(role, 'manage'), false, String(role));
  }
  assert.equal(core.can('admin', 'read'), false);
  assert.equal(core.can('admin', 'toString'), false);
});

test('permissionsOf answers the two booleans the renderer gets', () => {
  assert.deepEqual(core.permissionsOf('admin'), { work: true, manage: true });
  assert.deepEqual(core.permissionsOf('developer'), { work: true, manage: false });
  assert.deepEqual(core.permissionsOf('viewer'), { work: false, manage: false });
  assert.deepEqual(core.permissionsOf(undefined), { work: false, manage: false });
});

test('the permission map cannot be changed at run time', () => {
  assert.throws(() => { core.WORKSPACE_PERMISSIONS.work.push('viewer'); });
  assert.equal(core.can('viewer', 'work'), false);
});

test('classifyLinkError: FORBIDDEN ROLE_FORBIDDEN is its own reason', async () => {
  const { fetchJson } = fakeFetch({
    '/trpc/link.create': [trpcErr(403, 'ROLE_FORBIDDEN', 'FORBIDDEN')],
    '/trpc/link.claim': [trpcErr(403, 'ROLE_FORBIDDEN', 'FORBIDDEN')],
  });
  await assert.rejects(
    core.create({ api: API, token: 'tk', fetchJson, name: 'My App', slug: 'my-app', frameProjectId: 'f1' }),
    (err) => core.classifyLinkError(err) === 'roleForbidden'
  );
  await assert.rejects(
    core.claim({ api: API, token: 'tk', fetchJson, projectId: 'p1', frameProjectId: 'f1' }),
    (err) => core.classifyLinkError(err) === 'roleForbidden'
  );
  // A 403 the server did not name stays generic.
  assert.equal(core.classifyLinkError(new CloudError('other', { status: 403 })), 'other');
});

// ─── Web links ────────────────────────────────────────────────

const WEB = { apiUrl: 'https://api.frame.test', webOrigin: 'https://app.frame.test', workspaceSlug: 'lab', projectSlug: 'my-app' };

test('buildWebUrl joins origin, workspace and project', () => {
  assert.equal(core.buildWebUrl(WEB), 'https://app.frame.test/lab/my-app');
});

test('buildWorkspaceWebUrl stops at the workspace, under the same guards', () => {
  assert.equal(core.buildWorkspaceWebUrl(WEB), 'https://app.frame.test/lab');
  assert.equal(core.buildWorkspaceWebUrl({ ...WEB, workspaceSlug: '../x' }), null);
  assert.equal(core.buildWorkspaceWebUrl({ ...WEB, webOrigin: 'http://app.frame.test' }), null);
});

test('buildWebUrl uses only the origin of what it is given', () => {
  assert.equal(
    core.buildWebUrl({ ...WEB, webOrigin: 'https://user:pw@app.frame.test/device?code=X#y' }),
    'https://app.frame.test/lab/my-app'
  );
});

test('buildWebUrl refuses a slug that is not a slug', () => {
  for (const bad of ['', 'ab', 'a'.repeat(33), 'My-App', 'a--b', '-ab', 'ab-', '../x', 'a/b', 'a b', null, 42]) {
    assert.equal(core.buildWebUrl({ ...WEB, projectSlug: bad }), null, `project ${bad}`);
    assert.equal(core.buildWebUrl({ ...WEB, workspaceSlug: bad }), null, `workspace ${bad}`);
  }
});

test('buildWebUrl refuses a non-http origin', () => {
  for (const origin of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://app.frame.test', 'not a url', '', undefined]) {
    assert.equal(core.buildWebUrl({ ...WEB, webOrigin: origin }), null, String(origin));
  }
});

test('buildWebUrl refuses an http origin for an https API', () => {
  assert.equal(core.buildWebUrl({ ...WEB, webOrigin: 'http://app.frame.test' }), null);
});

test('buildWebUrl lets localhost and 127.0.0.1 serve the web over http', () => {
  assert.equal(core.buildWebUrl({ ...WEB, webOrigin: 'http://localhost:5173' }), 'http://localhost:5173/lab/my-app');
  assert.equal(core.buildWebUrl({ ...WEB, webOrigin: 'http://127.0.0.1:5173' }), 'http://127.0.0.1:5173/lab/my-app');
});

test('buildWebUrl allows http everywhere for an http API', () => {
  assert.equal(
    core.buildWebUrl({ ...WEB, apiUrl: 'http://localhost:3777', webOrigin: 'http://web.lan:5173' }),
    'http://web.lan:5173/lab/my-app'
  );
});

test('buildWebUrl answers null without an origin or an API address', () => {
  assert.equal(core.buildWebUrl({ ...WEB, webOrigin: null }), null);
  assert.equal(core.buildWebUrl({ ...WEB, apiUrl: '' }), null);
  assert.equal(core.buildWebUrl(), null);
});

test('buildNewWorkspaceWebUrl points at /new on the web origin', () => {
  const { apiUrl, webOrigin } = WEB;
  assert.equal(core.buildNewWorkspaceWebUrl({ apiUrl, webOrigin }), 'https://app.frame.test/new');
  assert.equal(
    core.buildNewWorkspaceWebUrl({ apiUrl, webOrigin: 'https://app.frame.test/device?code=X' }),
    'https://app.frame.test/new'
  );
});

test('buildNewWorkspaceWebUrl lets loopback serve the web over http', () => {
  const { apiUrl } = WEB;
  assert.equal(core.buildNewWorkspaceWebUrl({ apiUrl, webOrigin: 'http://localhost:5173' }), 'http://localhost:5173/new');
  assert.equal(core.buildNewWorkspaceWebUrl({ apiUrl, webOrigin: 'http://127.0.0.1:5173' }), 'http://127.0.0.1:5173/new');
});

test('buildNewWorkspaceWebUrl refuses an http origin for an https API', () => {
  assert.equal(core.buildNewWorkspaceWebUrl({ apiUrl: WEB.apiUrl, webOrigin: 'http://app.frame.test' }), null);
});

test('buildNewWorkspaceWebUrl refuses a non-http origin and a missing one', () => {
  for (const origin of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://app.frame.test', 'not a url', '', null, undefined]) {
    assert.equal(core.buildNewWorkspaceWebUrl({ apiUrl: WEB.apiUrl, webOrigin: origin }), null, String(origin));
  }
  assert.equal(core.buildNewWorkspaceWebUrl(), null);
});
