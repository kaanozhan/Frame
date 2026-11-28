/**
 * cloudBriefs tests — the pure core of reading Frame Cloud briefs.
 * Runs with Node's built-in runner: `npm test` (node --test test/).
 * No Electron, no network: fetch is a fake.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const core = require('../src/main/cloud/cloudBriefs');
const { classifyLinkError } = require('../src/main/cloud/cloudProjects');

const API = 'http://cloud.test';

// ─── Fakes ────────────────────────────────────────────────────

/** Scripted fetch, one answer per path. A GET's `?input=` is decoded into `input`. */
function fakeFetch(routes) {
  const calls = [];
  const fetchJson = async (url, opts = {}) => {
    const [path, query = ''] = url.slice(API.length).split('?');
    const input = query.startsWith('input=')
      ? JSON.parse(decodeURIComponent(query.slice('input='.length)))
      : undefined;
    calls.push({ url, path, input, ...opts });
    if (!routes[path]) throw new Error(`unexpected request ${path}`);
    return routes[path];
  };
  return { fetchJson, calls };
}

const ok = (data) => ({ status: 200, body: { result: { data } } });
const ctx = (fetchJson) => ({ api: API, token: 't0k', fetchJson });

const BRIEF = {
  id: 'b1', number: 3, projectId: 'p1', kind: 'work', title: 'Ship it', body: 'Line one\nLine two',
  source: 'desk', priority: 'high', milestoneId: 'm1', targetBranch: 'main', assigneeId: null,
  status: 'backlog', decidedAt: '2026-09-10T10:00:00.000Z', closedAt: null, closeReason: null,
  droppedAt: null, dropReason: null, recordedDecisionAt: null, shapedAt: null,
  createdAt: '2026-09-09T10:00:00.000Z', updatedAt: '2026-09-10T10:00:00.000Z', version: 2,
};

// ─── Calls ────────────────────────────────────────────────────

test('listBriefs sends a GET with the project slug and a bearer token', async () => {
  const { fetchJson, calls } = fakeFetch({ '/trpc/brief.list': ok([BRIEF]) });
  const briefs = await core.listBriefs({ ...ctx(fetchJson), projectSlug: 'my-app' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].token, 't0k');
  assert.deepEqual(calls[0].input, { projectSlug: 'my-app' });
  assert.equal(briefs.length, 1);
  assert.equal(briefs[0].number, 3);
  assert.equal(briefs[0].priority, 'high');
});

test('listBriefs asks for closed briefs only when told to', async () => {
  const { fetchJson, calls } = fakeFetch({ '/trpc/brief.list': ok([]) });
  await core.listBriefs({ ...ctx(fetchJson), projectSlug: 'my-app', includeClosed: true });
  assert.deepEqual(calls[0].input, { projectSlug: 'my-app', includeClosed: true });
});

test('listBriefs drops rows without an id or a number and survives a non-array', async () => {
  const { fetchJson } = fakeFetch({ '/trpc/brief.list': ok([BRIEF, { id: 'x' }, { number: 4 }, null]) });
  assert.equal((await core.listBriefs({ ...ctx(fetchJson), projectSlug: 'a-b' })).length, 1);
  const empty = fakeFetch({ '/trpc/brief.list': ok({ nope: true }) });
  assert.deepEqual(await core.listBriefs({ ...ctx(empty.fetchJson), projectSlug: 'a-b' }), []);
});

const MILESTONE = {
  id: 'm1', projectId: 'p1', name: 'Beta', goal: 'Ship the beta', targetDate: '2026-11-20',
  targetBranch: 'release/1.0', status: 'started', startedAt: '2026-11-01T09:00:00.000Z', closedAt: null,
  createdAt: '2026-10-30T09:00:00.000Z', updatedAt: '2026-11-01T09:00:00.000Z', version: 3,
  briefs: { backlog: 2, active: 1, done: 3, closed: 1 },
};

test('listMilestones sends the project slug and keeps the whole milestone Frame draws', async () => {
  const { fetchJson, calls } = fakeFetch({
    '/trpc/milestone.list': ok([MILESTONE, { name: 'no id' }]),
  });
  const milestones = await core.listMilestones({ ...ctx(fetchJson), projectSlug: 'my-app' });
  assert.deepEqual(calls[0].input, { projectSlug: 'my-app' });
  assert.deepEqual(milestones, [{
    id: 'm1', name: 'Beta', status: 'started', goal: 'Ship the beta', targetDate: '2026-11-20',
    targetBranch: 'release/1.0', startedAt: '2026-11-01T09:00:00.000Z', closedAt: null,
    briefs: { backlog: 2, active: 1, done: 3, closed: 1 },
  }]);
});

test('normalizeMilestone reads an older server\'s id, name and status with every new field null', () => {
  assert.deepEqual(core.normalizeMilestone({ id: 'm1', name: 'Beta', status: 'planned' }), {
    id: 'm1', name: 'Beta', status: 'planned', goal: null, targetDate: null,
    targetBranch: null, startedAt: null, closedAt: null, briefs: null,
  });
});

test('normalizeMilestone folds an unknown status to planned and empty strings to null', () => {
  const m = core.normalizeMilestone({ ...MILESTONE, status: 'archived', goal: '', targetBranch: '', closedAt: 7 });
  assert.equal(m.status, 'planned');
  assert.equal(m.goal, null);
  assert.equal(m.targetBranch, null);
  assert.equal(m.closedAt, null);
});

test('normalizeMilestone keeps briefs only when all four counts are non-negative integers', () => {
  const counts = MILESTONE.briefs;
  for (const bad of [
    { ...counts, done: -1 },
    { ...counts, active: 1.5 },
    { ...counts, backlog: '2' },
    { backlog: 2, active: 1, done: 3 },
    [2, 1, 3, 1],
    null,
    'many',
  ]) {
    assert.equal(core.normalizeMilestone({ ...MILESTONE, briefs: bad }).briefs, null, JSON.stringify(bad));
  }
  assert.deepEqual(core.normalizeMilestone({ ...MILESTONE, briefs: { ...counts, extra: 9 } }).briefs, counts);
  assert.deepEqual(
    core.normalizeMilestone({ ...MILESTONE, briefs: { backlog: 0, active: 0, done: 0, closed: 0 } }).briefs,
    { backlog: 0, active: 0, done: 0, closed: 0 },
  );
});

test('normalizeMilestone keeps targetDate only as a real YYYY-MM-DD day', () => {
  for (const bad of ['2026-11-20T00:00:00Z', '20.11.2026', '2026-13-01', '2026-02-30', '2026-1-5', 20261120, '']) {
    assert.equal(core.normalizeMilestone({ ...MILESTONE, targetDate: bad }).targetDate, null, String(bad));
  }
  assert.equal(core.normalizeMilestone({ ...MILESTONE, targetDate: '2028-02-29' }).targetDate, '2028-02-29');
});

test('getBrief asks by project slug and number, and orders parts by position', async () => {
  const { fetchJson, calls } = fakeFetch({
    '/trpc/brief.getByNumber': ok({
      ...BRIEF,
      parts: [
        { id: 'p2', position: 1, title: 'Second', shape: 'task', type: 'fix', definition: '## Why\nIt breaks' },
        { id: 'p1', position: 0, title: 'First', shape: 'spec', type: 'feature', definition: '## What\nA spec' },
      ],
      attachments: [{ id: 'a1', kind: 'url', title: 'Chat', url: 'https://claude.ai/chat/1' }],
      comments: [{ id: 'c1', authorId: 'u1', text: 'Looks right', createdAt: '2026-09-11T10:00:00.000Z' }],
    }),
  });
  const detail = await core.getBrief({ ...ctx(fetchJson), projectSlug: 'my-app', number: 3 });
  assert.deepEqual(calls[0].input, { projectSlug: 'my-app', number: 3 });
  assert.deepEqual(detail.parts.map((p) => p.id), ['p1', 'p2']);
  assert.deepEqual(detail.attachments, [{ id: 'a1', title: 'Chat', url: 'https://claude.ai/chat/1' }]);
  assert.equal(detail.comments[0].authorId, 'u1');
  assert.equal(detail.body, 'Line one\nLine two');
});

test('getBrief on a detail with no lists gives empty lists', async () => {
  const { fetchJson } = fakeFetch({ '/trpc/brief.getByNumber': ok(BRIEF) });
  const detail = await core.getBrief({ ...ctx(fetchJson), projectSlug: 'my-app', number: 3 });
  assert.deepEqual([detail.parts, detail.attachments, detail.comments], [[], [], []]);
});

test('a missing brief surfaces as notFound', async () => {
  const { fetchJson } = fakeFetch({
    '/trpc/brief.getByNumber': { status: 404, body: { error: { message: 'BRIEF_NOT_FOUND', data: { code: 'NOT_FOUND' } } } },
  });
  await assert.rejects(
    core.getBrief({ ...ctx(fetchJson), projectSlug: 'my-app', number: 9 }),
    (err) => classifyLinkError(err) === 'notFound'
  );
});

test('briefEvents asks by brief id and keeps each event\'s data', async () => {
  const { fetchJson, calls } = fakeFetch({
    '/trpc/brief.events': ok([
      { id: 'e1', briefId: 'b1', at: '2026-09-09T10:00:00.000Z', actorId: 'u1', event: 'created', data: { kind: 'work' } },
      { id: 'e2', at: '2026-09-10T10:00:00.000Z', actorId: 'u2', event: 'commented', data: null },
      { id: 'e3', actorId: 'u2' },
    ]),
  });
  const events = await core.briefEvents({ ...ctx(fetchJson), id: 'b1' });
  assert.deepEqual(calls[0].input, { id: 'b1' });
  assert.deepEqual(events.map((e) => e.id), ['e1', 'e2']);
  assert.deepEqual(events[0].data, { kind: 'work' });
  assert.deepEqual(events[1].data, {});
});

// ─── Normalizing ──────────────────────────────────────────────

test('normalizeBrief folds unknown enum values to safe defaults', () => {
  const b = core.normalizeBrief({ ...BRIEF, kind: 'epic', priority: 'urgent', status: 'archived' });
  assert.equal(b.kind, 'proposal');
  assert.equal(b.priority, null);
  assert.equal(b.status, 'backlog');
});

test('normalizeBrief turns empty or missing strings into null where the field is optional', () => {
  const b = core.normalizeBrief({ id: 'b', number: 1, body: '', milestoneId: undefined, closeReason: 7 });
  assert.equal(b.body, null);
  assert.equal(b.milestoneId, null);
  assert.equal(b.closeReason, null);
  assert.equal(b.title, '');
});

test('normalizeBrief never carries fields Frame does not draw', () => {
  const b = core.normalizeBrief({ ...BRIEF, assigneeId: 'u9', version: 4, secret: 'x' });
  assert.equal('assigneeId' in b, false);
  assert.equal('version' in b, false);
  assert.equal('secret' in b, false);
});

test('normalizeBriefDetail folds unknown part shapes and types', () => {
  const d = core.normalizeBriefDetail({ ...BRIEF, parts: [{ id: 'p', position: 0, shape: 'epic', type: 'chore' }] });
  assert.equal(d.parts[0].shape, 'task');
  assert.equal(d.parts[0].type, 'feature');
});

test('normalizeBrief carries shapedAt, null when unshaped', () => {
  assert.equal(core.normalizeBrief(BRIEF).shapedAt, null);
  assert.equal(core.normalizeBrief({ ...BRIEF, shapedAt: '2026-09-20T10:00:00.000Z' }).shapedAt, '2026-09-20T10:00:00.000Z');
  assert.equal(core.normalizeBrief({ ...BRIEF, shapedAt: 7 }).shapedAt, null);
});

test('normalizeBrief carries startedAt, null when unstarted', () => {
  assert.equal(core.normalizeBrief(BRIEF).startedAt, null);
  assert.equal(core.normalizeBrief({ ...BRIEF, startedAt: '2026-09-25T10:00:00.000Z' }).startedAt, '2026-09-25T10:00:00.000Z');
  assert.equal(core.normalizeBrief({ ...BRIEF, startedAt: 7 }).startedAt, null);
});

test('normalizeBriefDetail reads a part\'s key, null for a part without one', () => {
  const d = core.normalizeBriefDetail({
    ...BRIEF,
    parts: [
      { id: 'p1', position: 0, title: 'A', shape: 'spec', type: 'feature', key: 'llm-judge' },
      { id: 'p2', position: 1, title: 'B', shape: 'task', type: 'fix', key: '' },
      { id: 'p3', position: 2, title: 'C', shape: 'task', type: 'fix' },
    ],
  });
  assert.deepEqual(d.parts.map((p) => p.key), ['llm-judge', null, null]);
});

test('normalizeBriefDetail reads a part\'s recordRef, null for a part without one', () => {
  const d = core.normalizeBriefDetail({
    ...BRIEF,
    parts: [
      { id: 'p1', position: 0, title: 'A', shape: 'spec', type: 'feature', recordRef: 'login-flow' },
      { id: 'p2', position: 1, title: 'B', shape: 'task', type: 'fix', recordRef: '' },
      { id: 'p3', position: 2, title: 'C', shape: 'task', type: 'fix' },
    ],
  });
  assert.deepEqual(d.parts.map((p) => p.recordRef), ['login-flow', null, null]);
});

test('normalizeBriefDetail reads a part\'s definition and no longer its why', () => {
  const d = core.normalizeBriefDetail({
    ...BRIEF,
    parts: [
      { id: 'p1', position: 0, title: 'A', shape: 'spec', type: 'feature', definition: '## Why\nBecause', why: 'old' },
      { id: 'p2', position: 1, title: 'B', shape: 'task', type: 'fix' },
    ],
  });
  assert.equal(d.parts[0].definition, '## Why\nBecause');
  assert.equal('why' in d.parts[0], false);
  assert.equal(d.parts[1].definition, '');
});

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

test('normalizeBriefDetail reads a part\'s Done fields, null when absent or empty', () => {
  const d = core.normalizeBriefDetail({
    ...BRIEF,
    parts: [
      {
        id: 'p1', position: 0, title: 'A', shape: 'spec', type: 'feature', recordRef: 'login-flow',
        branch: 'feat/login', completionSha: SHA_A, mergedAt: '2026-11-01T10:00:00.000Z', mergedBase: 'main',
        mergeSha: SHA_B, mergeEvidence: 'compare', droppedAt: null, dropReason: null,
      },
      { id: 'p2', position: 1, title: 'B', shape: 'task', type: 'fix', droppedAt: '2026-11-02T10:00:00.000Z', dropReason: 'Not needed' },
      { id: 'p3', position: 2, title: 'C', shape: 'task', type: 'fix', branch: '', completionSha: 7 },
    ],
  });
  const [merged, dropped, bare] = d.parts;
  assert.equal(merged.branch, 'feat/login');
  assert.equal(merged.completionSha, SHA_A);
  assert.equal(merged.mergedAt, '2026-11-01T10:00:00.000Z');
  assert.equal(merged.mergedBase, 'main');
  assert.equal('mergeSha' in merged, false);
  assert.equal('mergeEvidence' in merged, false);
  assert.equal(dropped.droppedAt, '2026-11-02T10:00:00.000Z');
  assert.equal(dropped.dropReason, 'Not needed');
  assert.deepEqual(
    [bare.branch, bare.completionSha, bare.mergedAt, bare.mergedBase, bare.droppedAt, bare.dropReason],
    [null, null, null, null, null, null]
  );
});

test('normalizeBrief reads mergeTracking, ready unless the server says needs_github or off', () => {
  assert.equal(core.normalizeBrief(BRIEF).mergeTracking, 'ready');
  assert.equal(core.normalizeBrief({ ...BRIEF, mergeTracking: 'needs_github' }).mergeTracking, 'needs_github');
  assert.equal(core.normalizeBrief({ ...BRIEF, mergeTracking: 'off' }).mergeTracking, 'off');
  assert.equal(core.normalizeBrief({ ...BRIEF, mergeTracking: 'ready' }).mergeTracking, 'ready');
  assert.equal(core.normalizeBrief({ ...BRIEF, mergeTracking: 'maybe' }).mergeTracking, 'ready');
  assert.equal(core.normalizeBriefDetail({ ...BRIEF, mergeTracking: 'needs_github' }).mergeTracking, 'needs_github');
  assert.equal(core.normalizeBriefDetail({ ...BRIEF, mergeTracking: 'off' }).mergeTracking, 'off');
});

/** One part with the given PR fields, through normalizeBriefDetail. */
function prPart(fields) {
  return core.normalizeBriefDetail({
    ...BRIEF,
    parts: [{ id: 'p1', position: 0, title: 'A', shape: 'spec', type: 'feature', ...fields }],
  }).parts[0];
}

const PR_URL = 'https://github.com/lab/my-app/pull/7';

test('normalizeBriefDetail reads a part\'s pull request', () => {
  const p = prPart({ prNumber: 7, prState: 'open', prBase: 'main', prReview: 'approved', prUrl: PR_URL });
  assert.deepEqual(
    [p.prNumber, p.prState, p.prBase, p.prReview, p.prUrl],
    [7, 'open', 'main', 'approved', PR_URL]
  );
});

test('normalizeBriefDetail gives null PR fields to a part from an older server', () => {
  const p = prPart({});
  assert.deepEqual([p.prNumber, p.prState, p.prBase, p.prReview, p.prUrl], [null, null, null, null, null]);
});

test('normalizeBriefDetail keeps every PR state and review the server knows', () => {
  for (const state of ['open', 'closed', 'merged']) assert.equal(prPart({ prState: state }).prState, state);
  for (const review of ['requested', 'approved', 'changes_requested']) assert.equal(prPart({ prReview: review }).prReview, review);
});

test('normalizeBriefDetail folds an unknown PR state or review to null', () => {
  for (const bad of ['draft', 'OPEN', '', 7, null]) assert.equal(prPart({ prState: bad }).prState, null, String(bad));
  for (const bad of ['commented', 'APPROVED', '', 1, null]) assert.equal(prPart({ prReview: bad }).prReview, null, String(bad));
});

test('normalizeBriefDetail keeps only a positive whole PR number', () => {
  for (const bad of [0, -3, 1.5, '7', NaN, null]) assert.equal(prPart({ prNumber: bad }).prNumber, null, String(bad));
  assert.equal(prPart({ prNumber: 1 }).prNumber, 1);
});

test('normalizeBriefDetail reads an empty or non-string PR base as null', () => {
  assert.equal(prPart({ prBase: '' }).prBase, null);
  assert.equal(prPart({ prBase: 3 }).prBase, null);
  assert.equal(prPart({ prBase: 'release/1.0' }).prBase, 'release/1.0');
});

test('normalizeBriefDetail keeps a PR URL only when it is http(s)', () => {
  assert.equal(prPart({ prUrl: 'http://ghe.lab.test/lab/my-app/pull/7' }).prUrl, 'http://ghe.lab.test/lab/my-app/pull/7');
  for (const bad of ['javascript:alert(1)', 'ftp://github.com/x', 'file:///etc/passwd', 'not a url', '', 7, null]) {
    assert.equal(prPart({ prUrl: bad }).prUrl, null, String(bad));
  }
});

test('mergeTrackingOf: needs_github wins, then off, else ready', () => {
  assert.equal(core.mergeTrackingOf([]), 'ready');
  assert.equal(core.mergeTrackingOf(undefined), 'ready');
  assert.equal(core.mergeTrackingOf([{ mergeTracking: 'ready' }, { mergeTracking: 'ready' }]), 'ready');
  assert.equal(core.mergeTrackingOf([{ mergeTracking: 'ready' }, { mergeTracking: 'off' }]), 'off');
  assert.equal(core.mergeTrackingOf([{ mergeTracking: 'off' }, { mergeTracking: 'needs_github' }]), 'needs_github');
  assert.equal(core.mergeTrackingOf([{ mergeTracking: 'needs_github' }, { mergeTracking: 'off' }]), 'needs_github');
});

// Overturns frame-cloud-brief-done's "normalizeBrief does not carry doneAt":
// status still places the card, and doneAt now dates the Done line.
test('normalizeBrief carries doneAt, doneBy and doneReason, null when absent or empty', () => {
  const done = core.normalizeBrief({
    ...BRIEF, status: 'done', doneAt: '2026-11-03T10:00:00.000Z', doneBy: 'u1', doneReason: 'Shipped the rest by hand',
  });
  assert.equal(done.doneAt, '2026-11-03T10:00:00.000Z');
  assert.equal(done.doneBy, 'u1');
  assert.equal(done.doneReason, 'Shipped the rest by hand');
  const open = core.normalizeBrief(BRIEF);
  assert.deepEqual([open.doneAt, open.doneBy, open.doneReason], [null, null, null]);
  const odd = core.normalizeBrief({ ...BRIEF, doneAt: '', doneBy: 7, doneReason: {} });
  assert.deepEqual([odd.doneAt, odd.doneBy, odd.doneReason], [null, null, null]);
  // A brief moved Done before manual Done has a date but no person.
  const old = core.normalizeBrief({ ...BRIEF, status: 'done', doneAt: '2026-11-01T10:00:00.000Z', doneBy: null });
  assert.equal(old.doneAt, '2026-11-01T10:00:00.000Z');
  assert.equal(old.doneBy, null);
});

test('normalizeBrief reads readyForDone, true only when the server sends true', () => {
  assert.equal(core.normalizeBrief({ ...BRIEF, readyForDone: true }).readyForDone, true);
  for (const value of [false, undefined, null, 'true', 1]) {
    assert.equal(core.normalizeBrief({ ...BRIEF, readyForDone: value }).readyForDone, false, String(value));
  }
});

test('normalizeBriefDetail inherits the Done fields', () => {
  const d = core.normalizeBriefDetail({
    ...BRIEF, status: 'done', doneAt: '2026-11-03T10:00:00.000Z', doneBy: 'u1', doneReason: 'why', readyForDone: true,
  });
  assert.deepEqual(
    [d.doneAt, d.doneBy, d.doneReason, d.readyForDone],
    ['2026-11-03T10:00:00.000Z', 'u1', 'why', true]
  );
});

// ─── Done ─────────────────────────────────────────────────────

const DONE_DETAIL = {
  ...BRIEF,
  status: 'active',
  startedAt: '2026-09-25T10:00:00.000Z',
  parts: [{ id: 'p1', position: 0, title: 'A', shape: 'spec', type: 'feature', recordRef: 'login-flow', branch: 'feat/login' }],
};

test('recordBranch POSTs brief.recordBranch with id, partId, branch and baseSha, and returns the detail', async () => {
  const { fetchJson, calls } = fakeFetch({ '/trpc/brief.recordBranch': ok(DONE_DETAIL) });
  const detail = await core.recordBranch({ ...ctx(fetchJson), id: 'b1', partId: 'p1', branch: 'feat/login', baseSha: SHA_A });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${API}/trpc/brief.recordBranch`);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].token, 't0k');
  assert.deepEqual(calls[0].body, { id: 'b1', partId: 'p1', branch: 'feat/login', baseSha: SHA_A });
  assert.equal(detail.parts[0].branch, 'feat/login');
  assert.equal(detail.status, 'active');
});

test('recordCompletion POSTs brief.recordCompletion with id, partId and sha, and returns the detail', async () => {
  const { fetchJson, calls } = fakeFetch({
    '/trpc/brief.recordCompletion': ok({ ...DONE_DETAIL, parts: [{ ...DONE_DETAIL.parts[0], completionSha: SHA_B }] }),
  });
  const detail = await core.recordCompletion({ ...ctx(fetchJson), id: 'b1', partId: 'p1', sha: SHA_B });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${API}/trpc/brief.recordCompletion`);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].token, 't0k');
  assert.deepEqual(calls[0].body, { id: 'b1', partId: 'p1', sha: SHA_B });
  assert.equal(detail.parts[0].completionSha, SHA_B);
});

test('recordBranch and recordCompletion surface a final refusal as a CloudError', async () => {
  const refusal = (code) => ({ status: 400, body: { error: { message: code, data: { code: 'BAD_REQUEST' } } } });
  const branch = fakeFetch({ '/trpc/brief.recordBranch': refusal('PART_MERGED') });
  await assert.rejects(
    core.recordBranch({ ...ctx(branch.fetchJson), id: 'b1', partId: 'p1', branch: 'feat/x', baseSha: SHA_A }),
    (err) => err.name === 'CloudError' && err.message === 'PART_MERGED'
  );
  const completion = fakeFetch({ '/trpc/brief.recordCompletion': refusal('PART_DROPPED') });
  await assert.rejects(
    core.recordCompletion({ ...ctx(completion.fetchJson), id: 'b1', partId: 'p1', sha: SHA_A }),
    (err) => err.name === 'CloudError' && err.message === 'PART_DROPPED'
  );
});

// ─── Web links ────────────────────────────────────────────────

const WEB = { apiUrl: 'https://api.frame.test', webOrigin: 'https://app.frame.test', workspaceSlug: 'lab', projectSlug: 'my-app' };

test('buildBriefWebUrl points at the full brief page', () => {
  assert.equal(core.buildBriefWebUrl({ ...WEB, number: 12 }), 'https://app.frame.test/lab/my-app/briefs/12');
});

test('buildBriefWebUrl without a number is the project page', () => {
  assert.equal(core.buildBriefWebUrl(WEB), 'https://app.frame.test/lab/my-app');
});

test('buildBriefWebUrl refuses a number that is not a positive integer', () => {
  for (const bad of [0, -1, 1.5, '3', NaN]) {
    assert.equal(core.buildBriefWebUrl({ ...WEB, number: bad }), null, String(bad));
  }
});

test('buildBriefWebUrl keeps the project URL guards', () => {
  assert.equal(core.buildBriefWebUrl({ ...WEB, number: 1, webOrigin: 'javascript:alert(1)' }), null);
  assert.equal(core.buildBriefWebUrl({ ...WEB, number: 1, projectSlug: '../x' }), null);
});

test('buildSettingsWebUrl points at the project\'s Settings, GitHub section', () => {
  assert.equal(core.buildSettingsWebUrl(WEB), 'https://app.frame.test/lab/my-app/settings#github');
});

test('buildSettingsWebUrl keeps the project URL guards', () => {
  assert.equal(core.buildSettingsWebUrl({ ...WEB, webOrigin: 'javascript:alert(1)' }), null);
  assert.equal(core.buildSettingsWebUrl({ ...WEB, projectSlug: '../x' }), null);
  assert.equal(core.buildSettingsWebUrl({ ...WEB, workspaceSlug: '' }), null);
  assert.equal(core.buildSettingsWebUrl(), null);
});

test('buildMilestoneWebUrl points at the milestone\'s page', () => {
  assert.equal(
    core.buildMilestoneWebUrl({ ...WEB, milestoneId: 'm1' }),
    'https://app.frame.test/lab/my-app/milestones/m1',
  );
});

test('buildMilestoneWebUrl encodes the id', () => {
  assert.equal(
    core.buildMilestoneWebUrl({ ...WEB, milestoneId: 'a/b?c#d' }),
    'https://app.frame.test/lab/my-app/milestones/a%2Fb%3Fc%23d',
  );
});

test('buildMilestoneWebUrl is null for an empty id and under the project URL guards', () => {
  for (const bad of ['', undefined, null, 7]) {
    assert.equal(core.buildMilestoneWebUrl({ ...WEB, milestoneId: bad }), null, String(bad));
  }
  assert.equal(core.buildMilestoneWebUrl({ ...WEB, milestoneId: 'm1', webOrigin: 'javascript:alert(1)' }), null);
  assert.equal(core.buildMilestoneWebUrl({ ...WEB, milestoneId: 'm1', projectSlug: '../x' }), null);
  assert.equal(core.buildMilestoneWebUrl({ ...WEB, milestoneId: 'm1', workspaceSlug: '' }), null);
  assert.equal(core.buildMilestoneWebUrl(), null);
});

// ─── Creating ─────────────────────────────────────────────────

test('buildCreateInput shapes work with a trimmed title, desk source and medium priority', () => {
  const r = core.buildCreateInput({ kind: 'work', title: '  Ship it  ', body: '  Why  ' });
  assert.deepEqual(r, { ok: true, input: { kind: 'work', title: 'Ship it', source: 'desk', body: 'Why', priority: 'medium' } });
  assert.equal(core.buildCreateInput({ kind: 'work', title: 'x', priority: 'high' }).input.priority, 'high');
});

test('buildCreateInput sends no priority for a proposal, even when given one', () => {
  const r = core.buildCreateInput({ kind: 'proposal', title: 'Idea', priority: 'high' });
  assert.deepEqual(r.input, { kind: 'proposal', title: 'Idea', source: 'desk' });
});

test('buildCreateInput leaves out an empty or whitespace body', () => {
  assert.equal('body' in core.buildCreateInput({ kind: 'work', title: 'x', body: '   ' }).input, false);
  assert.equal('body' in core.buildCreateInput({ kind: 'work', title: 'x' }).input, false);
});

test('buildCreateInput keeps HTML in the body as-is', () => {
  const body = '<script>alert(1)</script>';
  assert.equal(core.buildCreateInput({ kind: 'work', title: 'x', body }).input.body, body);
});

test('buildCreateInput refuses bad fields with the field named', () => {
  const cases = [
    [{ kind: 'epic', title: 'x' }, 'kind'],
    [{ kind: 'work', title: '   ' }, 'title'],
    [{ kind: 'work' }, 'title'],
    [{ kind: 'work', title: 'x'.repeat(201) }, 'title'],
    [{ kind: 'work', title: 'x', body: 'y'.repeat(10001) }, 'body'],
    [{ kind: 'work', title: 'x', priority: 'urgent' }, 'priority'],
  ];
  for (const [request, field] of cases) {
    assert.deepEqual(core.buildCreateInput(request), { ok: false, reason: 'badRequest', field }, field);
  }
  assert.equal(core.buildCreateInput(null).ok, false);
  assert.equal(core.buildCreateInput({ kind: 'work', title: 'x'.repeat(200) }).ok, true);
  assert.equal(core.buildCreateInput({ kind: 'work', title: 'x', body: 'y'.repeat(10000) }).ok, true);
});

test('normalizeLinks keeps http(s) links in order with trimmed titles', () => {
  const r = core.normalizeLinks([
    { title: ' Chat ', url: 'https://claude.ai/chat/1' },
    { title: 'Doc', url: 'http://example.com/a', extra: true },
  ]);
  assert.deepEqual(r, { ok: true, links: [{ title: 'Chat', url: 'https://claude.ai/chat/1' }, { title: 'Doc', url: 'http://example.com/a' }] });
  assert.deepEqual(core.normalizeLinks(undefined), { ok: true, links: [] });
});

test('normalizeLinks refuses the whole list over one bad link', () => {
  const bad = [
    [{ title: 'x', url: 'javascript:alert(1)' }],
    [{ title: 'x', url: 'ftp://example.com' }],
    [{ title: 'x', url: 'not a url' }],
    [{ title: '   ', url: 'https://example.com' }],
    [{ title: 'x'.repeat(201), url: 'https://example.com' }],
    'https://example.com',
  ];
  for (const links of bad) {
    assert.deepEqual(core.normalizeLinks(links), { ok: false, reason: 'badRequest', field: 'links' });
  }
});

test('createBrief POSTs brief.create with the input and normalizes the answer', async () => {
  const { fetchJson, calls } = fakeFetch({ '/trpc/brief.create': ok(BRIEF) });
  const input = { projectSlug: 'my-app', kind: 'work', title: 'Ship it', source: 'desk', priority: 'medium' };
  const brief = await core.createBrief({ ...ctx(fetchJson), input });
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].token, 't0k');
  assert.deepEqual(calls[0].body, input);
  assert.equal(brief.number, 3);
  assert.equal(brief.id, 'b1');
});

test('addAttachment POSTs brief.addAttachment with id, title and url', async () => {
  const { fetchJson, calls } = fakeFetch({ '/trpc/brief.addAttachment': ok({ id: 'a1', title: 'Chat', url: 'https://x.test' }) });
  const a = await core.addAttachment({ ...ctx(fetchJson), id: 'b1', title: 'Chat', url: 'https://x.test' });
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].body, { id: 'b1', title: 'Chat', url: 'https://x.test' });
  assert.deepEqual(a, { id: 'a1', title: 'Chat', url: 'https://x.test' });
});

/** A `call()` stand-in: runs each fn against a fake fetch, failing where told. */
function fakeCall({ createFails, failAttachmentAt } = {}) {
  const sent = [];
  let attachments = 0;
  const fetchJson = async (url, opts) => {
    const name = url.slice(`${API}/trpc/`.length);
    sent.push({ name, body: opts.body });
    if (name === 'brief.create') {
      return createFails ? { status: 404, body: { error: { message: 'PROJECT_NOT_FOUND', data: { code: 'NOT_FOUND' } } } } : ok(BRIEF);
    }
    attachments += 1;
    if (attachments === failAttachmentAt) return { status: 400, body: { error: { message: 'bad', data: { code: 'BAD_REQUEST' } } } };
    return ok({ id: `a${attachments}`, title: opts.body.title, url: opts.body.url });
  };
  const call = async (fn) => {
    try {
      return { ok: true, value: await fn(ctx(fetchJson)) };
    } catch (err) {
      return { ok: false, reason: classifyLinkError(err) };
    }
  };
  return { call, sent };
}

const INPUT = { projectSlug: 'my-app', kind: 'work', title: 'Ship it', source: 'desk', priority: 'medium' };
const LINKS = [
  { title: 'One', url: 'https://one.test' },
  { title: 'Two', url: 'https://two.test' },
  { title: 'Three', url: 'https://three.test' },
];

test('createWithLinks creates, then attaches every link in order', async () => {
  const { call, sent } = fakeCall();
  const r = await core.createWithLinks(call, { input: INPUT, links: LINKS });
  assert.deepEqual(r, { ok: true, number: 3, attachmentError: null });
  assert.deepEqual(sent.map((s) => s.name), ['brief.create', 'brief.addAttachment', 'brief.addAttachment', 'brief.addAttachment']);
  assert.deepEqual(sent.slice(1).map((s) => s.body), LINKS.map((l) => ({ id: 'b1', ...l })));
});

test('createWithLinks sends no link after a failed create', async () => {
  const { call, sent } = fakeCall({ createFails: true });
  const r = await core.createWithLinks(call, { input: INPUT, links: LINKS });
  assert.deepEqual(r, { ok: false, reason: 'notFound' });
  assert.deepEqual(sent.map((s) => s.name), ['brief.create']);
});

test('createWithLinks stops at the first failed link and keeps the number', async () => {
  const { call, sent } = fakeCall({ failAttachmentAt: 2 });
  const r = await core.createWithLinks(call, { input: INPUT, links: LINKS });
  assert.deepEqual(r, { ok: true, number: 3, attachmentError: 'badRequest' });
  assert.equal(sent.length, 3);
});

test('createWithLinks without links is one request and never returns the id', async () => {
  const { call, sent } = fakeCall();
  const r = await core.createWithLinks(call, { input: INPUT });
  assert.deepEqual(r, { ok: true, number: 3, attachmentError: null });
  assert.equal(sent.length, 1);
});

// ─── Discussions ──────────────────────────────────────────────

test('recordDiscussion POSTs brief.recordDiscussion with id, summary, url and provider', async () => {
  const { fetchJson, calls } = fakeFetch({ '/trpc/brief.recordDiscussion': ok({ ...BRIEF, kind: 'proposal' }) });
  const brief = await core.recordDiscussion({
    ...ctx(fetchJson), id: 'b1', summary: 'Chose Postgres', url: 'https://claude.ai/artifact/x', provider: 'Claude Code',
  });
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].token, 't0k');
  assert.deepEqual(calls[0].body, { id: 'b1', summary: 'Chose Postgres', url: 'https://claude.ai/artifact/x', provider: 'Claude Code' });
  assert.equal(brief.kind, 'proposal');
});

test('recordDiscussion leaves out an absent url and provider', async () => {
  const { fetchJson, calls } = fakeFetch({ '/trpc/brief.recordDiscussion': ok(BRIEF) });
  await core.recordDiscussion({ ...ctx(fetchJson), id: 'b1', summary: 'Second round' });
  assert.deepEqual(calls[0].body, { id: 'b1', summary: 'Second round' });
});

test('recordDiscussion surfaces a server refusal as a CloudError', async () => {
  const { fetchJson } = fakeFetch({
    '/trpc/brief.recordDiscussion': { status: 400, body: { error: { message: 'ALREADY_CLOSED', data: { code: 'BAD_REQUEST' } } } },
  });
  await assert.rejects(core.recordDiscussion({ ...ctx(fetchJson), id: 'b1', summary: 'x' }), (err) => err.name === 'CloudError' && err.message === 'ALREADY_CLOSED');
});

test('LIMITS carries the server\'s provider limit', () => {
  assert.equal(core.LIMITS.provider, 40);
});

test('addDiscussionCounts counts records on open proposals only, and survives a failed events call', async () => {
  const briefs = [
    { id: 'p1', number: 1, kind: 'proposal', status: 'backlog' },
    { id: 'p2', number: 2, kind: 'proposal', status: 'backlog' },
    { id: 'p3', number: 3, kind: 'proposal', status: 'closed' },
    { id: 'w4', number: 4, kind: 'work', status: 'active' },
  ];
  const asked = [];
  const events = {
    p1: [
      { id: 'e1', event: 'created' },
      { id: 'e2', event: 'discussion-recorded', data: { summary: 'a' } },
      { id: 'e3', event: 'discussion-recorded', data: { summary: 'b' } },
    ],
  };
  const call = async (fn) => {
    const fetchJson = async (url) => {
      const id = JSON.parse(decodeURIComponent(url.split('?input=')[1])).id;
      asked.push(id);
      if (!events[id]) return { status: 500, body: {} };
      return ok(events[id]);
    };
    try {
      return { ok: true, value: await fn(ctx(fetchJson)) };
    } catch (err) {
      return { ok: false, reason: classifyLinkError(err) };
    }
  };
  const counted = await core.addDiscussionCounts(call, briefs);
  assert.deepEqual(counted.map((b) => b.discussionCount), [2, null, null, null]);
  assert.deepEqual(counted.map((b) => b.newCommentCount), [0, null, null, null]);
  assert.deepEqual(asked.sort(), ['p1', 'p2']);
  assert.equal(briefs[0].discussionCount, undefined);
});

// ─── Shaping ──────────────────────────────────────────────────

test('shapeBrief POSTs brief.shape with the id and the parts in order, and returns the detail', async () => {
  const parts = [
    { title: 'First', shape: 'spec', type: 'feature', definition: 'One' },
    { title: 'Second', shape: 'task', type: 'fix', definition: 'Two' },
  ];
  const { fetchJson, calls } = fakeFetch({
    '/trpc/brief.shape': ok({
      ...BRIEF,
      shapedAt: '2026-09-20T10:00:00.000Z',
      parts: parts.map((p, i) => ({ ...p, id: `p${i}`, position: i })),
    }),
  });
  const detail = await core.shapeBrief({ ...ctx(fetchJson), id: 'b1', parts });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].token, 't0k');
  assert.deepEqual(calls[0].body, { id: 'b1', parts });
  assert.equal(detail.shapedAt, '2026-09-20T10:00:00.000Z');
  assert.deepEqual(detail.parts.map((p) => p.definition), ['One', 'Two']);
});

test('shapeBrief surfaces a server refusal as a CloudError', async () => {
  const { fetchJson } = fakeFetch({
    '/trpc/brief.shape': { status: 400, body: { error: { message: 'ALREADY_SHAPED', data: { code: 'BAD_REQUEST' } } } },
  });
  await assert.rejects(core.shapeBrief({ ...ctx(fetchJson), id: 'b1', parts: [] }), (err) => err.name === 'CloudError' && err.message === 'ALREADY_SHAPED');
});

test('partSummary counts parts by shape and ignores anything else', () => {
  assert.deepEqual(core.partSummary([{ shape: 'spec' }, { shape: 'task' }, { shape: 'spec' }, { shape: 'epic' }, null]), { spec: 2, task: 1 });
  assert.deepEqual(core.partSummary(undefined), { spec: 0, task: 0 });
});

test('addPartCounts reads open shaped work only, keeps its part rows, and survives a failed read', async () => {
  const SHAPED = '2026-09-20T10:00:00.000Z';
  const briefs = [
    { id: 'w1', number: 1, kind: 'work', status: 'backlog', shapedAt: SHAPED },
    { id: 'w2', number: 2, kind: 'work', status: 'active', shapedAt: SHAPED },
    { id: 'w3', number: 3, kind: 'work', status: 'backlog', shapedAt: null },
    { id: 'w4', number: 4, kind: 'work', status: 'closed', shapedAt: SHAPED },
    { id: 'p5', number: 5, kind: 'proposal', status: 'backlog', shapedAt: null },
  ];
  const details = {
    1: {
      ...BRIEF,
      number: 1,
      parts: [
        { id: 'a', position: 0, shape: 'spec', definition: 'secret' },
        { id: 'b', position: 1, shape: 'task', recordRef: 'task-b' },
        {
          id: 'c', position: 2, shape: 'spec',
          prNumber: 9, prState: 'open', prBase: 'main', prReview: 'changes_requested', prUrl: 'https://github.com/lab/my-app/pull/9',
        },
      ],
    },
  };
  const asked = [];
  const call = async (fn) => {
    const fetchJson = async (url) => {
      const input = JSON.parse(decodeURIComponent(url.split('?input=')[1]));
      asked.push(input);
      if (!details[input.number]) return { status: 500, body: {} };
      return ok(details[input.number]);
    };
    try {
      return { ok: true, value: await fn(ctx(fetchJson)) };
    } catch (err) {
      return { ok: false, reason: classifyLinkError(err) };
    }
  };
  const counted = await core.addPartCounts(call, briefs, 'my-app');
  assert.deepEqual(counted.map((b) => b.partCounts), [{ spec: 2, task: 1 }, null, null, null, null]);
  const done = { branch: null, completionSha: null, mergedAt: null, mergedBase: null, droppedAt: null, dropReason: null };
  const noPr = { prNumber: null, prState: null, prBase: null, prReview: null, prUrl: null };
  assert.deepEqual(counted[0].parts, [
    { id: 'a', title: '', shape: 'spec', type: 'feature', key: null, recordRef: null, ...done, ...noPr },
    { id: 'b', title: '', shape: 'task', type: 'feature', key: null, recordRef: 'task-b', ...done, ...noPr },
    {
      id: 'c', title: '', shape: 'spec', type: 'feature', key: null, recordRef: null, ...done,
      prNumber: 9, prState: 'open', prBase: 'main', prReview: 'changes_requested', prUrl: 'https://github.com/lab/my-app/pull/9',
    },
  ]);
  assert.deepEqual(counted.slice(1).map((b) => b.parts), [null, null, null, null]);
  assert.deepEqual(asked.map((i) => i.number).sort(), [1, 2]);
  assert.deepEqual(asked[0].projectSlug, 'my-app');
  assert.equal(briefs[0].partCounts, undefined);
});

// ─── Deciding ─────────────────────────────────────────────────

/** A `call()` over a fake fetch that answers brief.decide with `answer`. */
function decideCall(answer) {
  const sent = [];
  const fetchJson = async (url, opts) => {
    sent.push({ name: url.slice(`${API}/trpc/`.length), body: opts.body });
    return answer;
  };
  const call = async (fn) => {
    try {
      return { ok: true, value: await fn(ctx(fetchJson)) };
    } catch (err) {
      return { ok: false, reason: classifyLinkError(err) };
    }
  };
  return { call, sent };
}

test('decideThrough POSTs brief.decide once with the id and priority', async () => {
  const { call, sent } = decideCall(ok({ ...BRIEF, kind: 'work' }));
  assert.deepEqual(await core.decideThrough(call, { id: 'b1', priority: 'high' }), { ok: true });
  assert.deepEqual(sent, [{ name: 'brief.decide', body: { id: 'b1', priority: 'high' } }]);
});

test('decideThrough sends nothing for a priority the server does not know', async () => {
  const { call, sent } = decideCall(ok(BRIEF));
  for (const priority of [undefined, 'urgent', '']) {
    assert.deepEqual(await core.decideThrough(call, { id: 'b1', priority }), { ok: false, reason: 'badRequest' });
  }
  assert.equal(sent.length, 0);
});

test('decideThrough keeps the server\'s refusal reason', async () => {
  const refusal = (code) => ({ status: 400, body: { error: { message: code, data: { code: 'BAD_REQUEST' } } } });
  const cases = [['NOT_A_PROPOSAL', 'notAProposal'], ['ALREADY_WORK', 'alreadyWork'], ['ALREADY_CLOSED', 'alreadyClosed']];
  for (const [code, reason] of cases) {
    const { call } = decideCall(refusal(code));
    assert.deepEqual(await core.decideThrough(call, { id: 'b1', priority: 'medium' }), { ok: false, reason }, code);
  }
  const { call } = decideCall({ status: 401, body: {} });
  assert.deepEqual(await core.decideThrough(call, { id: 'b1', priority: 'medium' }), { ok: false, reason: 'unauthorized' });
});

// ─── Starting ─────────────────────────────────────────────────

const START_PARTS = [{ partId: 'p1', recordRef: 'login-flow' }, { partId: 'p2', recordRef: 'task-fix-typo' }];

test('startBrief POSTs brief.start with the id and every part\'s ref, and returns the detail', async () => {
  const { fetchJson, calls } = fakeFetch({
    '/trpc/brief.start': ok({
      ...BRIEF,
      status: 'active',
      shapedAt: '2026-09-20T10:00:00.000Z',
      startedAt: '2026-09-25T10:00:00.000Z',
      parts: [
        { id: 'p1', position: 0, title: 'A', shape: 'spec', type: 'feature', recordRef: 'login-flow' },
        { id: 'p2', position: 1, title: 'B', shape: 'task', type: 'fix', recordRef: 'task-fix-typo' },
      ],
    }),
  });
  const detail = await core.startBrief({ ...ctx(fetchJson), id: 'b1', parts: START_PARTS });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${API}/trpc/brief.start`);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].token, 't0k');
  assert.deepEqual(calls[0].body, { id: 'b1', parts: START_PARTS });
  assert.equal(detail.startedAt, '2026-09-25T10:00:00.000Z');
  assert.equal(detail.status, 'active');
  assert.deepEqual(detail.parts.map((p) => p.recordRef), ['login-flow', 'task-fix-typo']);
});

test('startThrough POSTs brief.start once and returns the detail', async () => {
  const { call, sent } = decideCall(ok({ ...BRIEF, startedAt: '2026-09-25T10:00:00.000Z' }));
  const result = await core.startThrough(call, { id: 'b1', parts: START_PARTS });
  assert.equal(result.ok, true);
  assert.equal(result.detail.startedAt, '2026-09-25T10:00:00.000Z');
  assert.deepEqual(sent, [{ name: 'brief.start', body: { id: 'b1', parts: START_PARTS } }]);
});

test('startThrough keeps every server refusal as a reason', async () => {
  const refusal = (code) => ({ status: 400, body: { error: { message: code, data: { code: 'BAD_REQUEST' } } } });
  for (const [code, reason] of Object.entries(core.START_REFUSALS)) {
    const { call } = decideCall(refusal(code));
    assert.deepEqual(await core.startThrough(call, { id: 'b1', parts: START_PARTS }), { ok: false, reason }, code);
  }
  assert.deepEqual(Object.keys(core.START_REFUSALS).sort(), [
    'ALREADY_CLOSED', 'ALREADY_STARTED', 'BRIEF_NOT_FOUND', 'NOT_SHAPED', 'NOT_WORK', 'PARTS_MISMATCH', 'RECORD_REF_TAKEN',
  ]);
  const { call } = decideCall({ status: 401, body: {} });
  assert.deepEqual(await core.startThrough(call, { id: 'b1', parts: START_PARTS }), { ok: false, reason: 'unauthorized' });
});

// ─── Moving to Done and back ──────────────────────────────────

const MOVED = { ...BRIEF, status: 'done', startedAt: '2026-09-25T10:00:00.000Z', doneAt: '2026-11-08T10:00:00.000Z', doneBy: 'u1' };

test('moveToDone POSTs brief.moveToDone with the id and a trimmed reason, and returns the detail', async () => {
  const { fetchJson, calls } = fakeFetch({ '/trpc/brief.moveToDone': ok({ ...MOVED, doneReason: 'Docs later' }) });
  const detail = await core.moveToDone({ ...ctx(fetchJson), id: 'b1', reason: '  Docs later \n' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${API}/trpc/brief.moveToDone`);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].token, 't0k');
  assert.deepEqual(calls[0].body, { id: 'b1', reason: 'Docs later' });
  assert.equal(detail.status, 'done');
  assert.equal(detail.doneReason, 'Docs later');
  assert.deepEqual(detail.parts, []);
});

test('moveToDone leaves out an absent or blank reason', async () => {
  for (const reason of [undefined, null, '', '   \n\t']) {
    const { fetchJson, calls } = fakeFetch({ '/trpc/brief.moveToDone': ok(MOVED) });
    await core.moveToDone({ ...ctx(fetchJson), id: 'b1', reason });
    assert.deepEqual(calls[0].body, { id: 'b1' }, JSON.stringify(reason));
  }
});

test('moveBackToActive POSTs brief.moveBackToActive with the id and a trimmed reason, and returns the detail', async () => {
  const { fetchJson, calls } = fakeFetch({
    '/trpc/brief.moveBackToActive': ok({ ...MOVED, status: 'active', doneAt: null, doneBy: null }),
  });
  const detail = await core.moveBackToActive({ ...ctx(fetchJson), id: 'b1', reason: ' The docs part is not done ' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${API}/trpc/brief.moveBackToActive`);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].token, 't0k');
  assert.deepEqual(calls[0].body, { id: 'b1', reason: 'The docs part is not done' });
  assert.equal(detail.status, 'active');
  assert.equal(detail.doneAt, null);
});

test('moveThrough sends a move to Done with or without a reason', async () => {
  const bare = decideCall(ok(MOVED));
  assert.deepEqual(await core.moveThrough(bare.call, { id: 'b1', to: 'done' }), { ok: true });
  assert.deepEqual(bare.sent, [{ name: 'brief.moveToDone', body: { id: 'b1' } }]);
  const blank = decideCall(ok(MOVED));
  assert.deepEqual(await core.moveThrough(blank.call, { id: 'b1', to: 'done', reason: '  ' }), { ok: true });
  assert.deepEqual(blank.sent, [{ name: 'brief.moveToDone', body: { id: 'b1' } }]);
  const reasoned = decideCall(ok(MOVED));
  assert.deepEqual(await core.moveThrough(reasoned.call, { id: 'b1', to: 'done', reason: ' Docs later ' }), { ok: true });
  assert.deepEqual(reasoned.sent, [{ name: 'brief.moveToDone', body: { id: 'b1', reason: 'Docs later' } }]);
});

test('moveThrough sends a move back to Active with its trimmed reason', async () => {
  const { call, sent } = decideCall(ok({ ...MOVED, status: 'active' }));
  assert.deepEqual(await core.moveThrough(call, { id: 'b1', to: 'active', reason: ' Not finished ' }), { ok: true });
  assert.deepEqual(sent, [{ name: 'brief.moveBackToActive', body: { id: 'b1', reason: 'Not finished' } }]);
});

test('moveThrough sends nothing for an unknown direction', async () => {
  const { call, sent } = decideCall(ok(MOVED));
  for (const to of [undefined, '', 'closed', 'backlog', 'Done']) {
    assert.deepEqual(await core.moveThrough(call, { id: 'b1', to, reason: 'x' }), { ok: false, reason: 'badRequest' }, String(to));
  }
  assert.equal(sent.length, 0);
});

test('moveThrough refuses a move back with a blank reason before sending', async () => {
  const { call, sent } = decideCall(ok(MOVED));
  for (const reason of [undefined, null, '', '  \n']) {
    assert.deepEqual(
      await core.moveThrough(call, { id: 'b1', to: 'active', reason }),
      { ok: false, reason: 'reasonRequired' },
      JSON.stringify(reason)
    );
  }
  assert.equal(sent.length, 0);
});

test('moveThrough keeps every server refusal as a reason, in both directions', async () => {
  const refusal = (code) => ({ status: 400, body: { error: { message: code, data: { code: 'BAD_REQUEST' } } } });
  for (const [code, reason] of Object.entries(core.MOVE_REFUSALS)) {
    const done = decideCall(refusal(code));
    assert.deepEqual(await core.moveThrough(done.call, { id: 'b1', to: 'done' }), { ok: false, reason }, `done ${code}`);
    assert.equal(done.sent.length, 1);
    const back = decideCall(refusal(code));
    assert.deepEqual(await core.moveThrough(back.call, { id: 'b1', to: 'active', reason: 'r' }), { ok: false, reason }, `active ${code}`);
    assert.equal(back.sent.length, 1);
  }
  assert.deepEqual(core.MOVE_REFUSALS, {
    REASON_REQUIRED: 'reasonRequired',
    NOT_STARTED: 'notStarted',
    ALREADY_DONE: 'alreadyDone',
    NOT_DONE: 'notDone',
    ALREADY_CLOSED: 'alreadyClosed',
    NOT_WORK: 'notWork',
    BRIEF_NOT_FOUND: 'notFound',
  });
  const { call } = decideCall({ status: 401, body: {} });
  assert.deepEqual(await core.moveThrough(call, { id: 'b1', to: 'done' }), { ok: false, reason: 'unauthorized' });
});

test('discussionFacts counts records, and others\' comments after the latest one as new', () => {
  const e = (event, actorId = 'u2') => ({ id: event, event, actorId, data: {} });
  assert.deepEqual(core.discussionFacts([e('created'), e('comment-added')], 'u1'), { discussionCount: 0, newCommentCount: 0 });
  assert.deepEqual(core.discussionFacts([
    e('discussion-recorded', 'u1'), e('comment-added'), e('comment-added', 'u1'), e('comment-added'),
  ], 'u1'), { discussionCount: 1, newCommentCount: 2 });
  assert.deepEqual(core.discussionFacts([
    e('discussion-recorded', 'u1'), e('comment-added'), e('discussion-recorded', 'u1'),
  ], 'u1'), { discussionCount: 2, newCommentCount: 0 });
});
