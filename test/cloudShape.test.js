/**
 * cloudShape tests — the pure core of shaping a Frame Cloud work brief.
 * Runs with Node's built-in runner: `npm test` (node --test test/).
 * No Electron, no files, no network: `call` runs against a fake fetch.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const core = require('../src/main/cloud/cloudShape');
const { classifyLinkError } = require('../src/main/cloud/cloudProjects');

const API = 'http://cloud.test';
const ID = 'a'.repeat(24);
const NOW = Date.parse('2026-09-24T12:00:00.000Z');
const ENTRY = { folderPath: '/work/app', number: 7, toolId: 'claude', createdAt: '2026-09-23T12:00:00.000Z' };

const PART = { title: 'Offline store', shape: 'spec', type: 'feature', definition: '## Why\nPlanes.' };

// ─── Ids and the store ────────────────────────────────────────

test('newShapeId is 24 hex characters and differs each time', () => {
  const a = core.newShapeId();
  assert.match(a, /^[0-9a-f]{24}$/);
  assert.notEqual(a, core.newShapeId());
  assert.equal(core.isShapeId(a), true);
  assert.equal(core.isShapeId('__proto__'), false);
});

test('addShape returns a new store and getShape reads the entry back', () => {
  const empty = core.emptyStore();
  const store = core.addShape(empty, { id: ID, ...ENTRY });
  assert.deepEqual(empty.shapes, {});
  assert.deepEqual(core.getShape(store, ID), ENTRY);
  assert.equal(core.getShape(store, 'b'.repeat(24)), null);
});

test('addShape refuses a bad id or a malformed entry', () => {
  assert.deepEqual(core.addShape(core.emptyStore(), { id: 'nope', ...ENTRY }).shapes, {});
  assert.deepEqual(core.addShape(core.emptyStore(), { id: ID, ...ENTRY, number: 0 }).shapes, {});
  assert.deepEqual(core.addShape(core.emptyStore(), { id: ID, ...ENTRY, toolId: '' }).shapes, {});
  assert.deepEqual(core.addShape(core.emptyStore(), { id: ID, ...ENTRY, createdAt: 'later' }).shapes, {});
});

test('getShape does not reach through the prototype', () => {
  assert.equal(core.getShape({ shapes: {} }, 'constructor'), null);
  assert.equal(core.getShape(null, ID), null);
});

test('pruneShapes drops entries older than 90 days and malformed ones', () => {
  const old = new Date(NOW - core.MAX_AGE_MS - 1000).toISOString();
  const store = {
    version: 1,
    shapes: {
      [ID]: ENTRY,
      ['b'.repeat(24)]: { ...ENTRY, createdAt: old },
      ['c'.repeat(24)]: { folderPath: '/x' },
      notAnId: ENTRY,
    },
  };
  assert.deepEqual(Object.keys(core.pruneShapes(store, NOW).shapes), [ID]);
  assert.deepEqual(core.pruneShapes('garbage', NOW), core.emptyStore());
});

// ─── The prompt file ──────────────────────────────────────────

test('promptInstruction is one short line naming the quoted file and the brief', () => {
  const line = core.promptInstruction('/data/cloud-shapes/prompts/x.md', 7);
  assert.equal(line.includes('\n'), false);
  assert.match(line, /^Read '\/data\/cloud-shapes\/prompts\/x\.md' and follow it exactly\./);
  assert.match(line, /#7/);
  assert.equal(core.promptFileName(ID), `${ID}.md`);
});

test('stalePromptFiles picks prompt files without a shape, and leaves other names', () => {
  const store = core.addShape(core.emptyStore(), { id: ID, ...ENTRY });
  const names = [`${ID}.md`, `${'b'.repeat(24)}.md`, 'notes.txt', `${ID}.md.tmp`];
  assert.deepEqual(core.stalePromptFiles(names, store), [`${'b'.repeat(24)}.md`]);
  assert.deepEqual(core.stalePromptFiles(null, store), []);
});

// ─── Validating the parts ─────────────────────────────────────

test('validateShapeInput trims titles and definitions and keeps the order', () => {
  const r = core.validateShapeInput([
    { ...PART, title: '  A  ', definition: '  one  ', extra: 'dropped' },
    { title: 'B', shape: 'task', type: 'fix', definition: 'two' },
  ]);
  assert.deepEqual(r, {
    ok: true,
    input: [
      { title: 'A', shape: 'spec', type: 'feature', definition: 'one' },
      { title: 'B', shape: 'task', type: 'fix', definition: 'two' },
    ],
  });
});

test('validateShapeInput accepts every type and a definition at the limit', () => {
  for (const type of ['feature', 'fix', 'refactor', 'docs', 'test']) {
    assert.equal(core.validateShapeInput([{ ...PART, type }]).ok, true, type);
  }
  assert.equal(core.validateShapeInput([{ ...PART, title: 'x'.repeat(200), definition: 'x'.repeat(10000) }]).ok, true);
});

test('validateShapeInput carries a trimmed key, leaves out an empty one, and takes one at 40 characters', () => {
  const r = core.validateShapeInput([{ ...PART, key: ' llm-judge ' }, { ...PART, key: '' }, { ...PART, key: 'a'.repeat(40) }]);
  assert.equal(r.ok, true);
  assert.equal(r.input[0].key, 'llm-judge');
  assert.equal('key' in r.input[1], false);
  assert.equal(r.input[2].key, 'a'.repeat(40));
});

test('validateShapeInput refuses no parts and each bad field, naming the part', () => {
  const cases = [
    [undefined, { field: 'parts' }],
    [[], { field: 'parts' }],
    [{ 0: PART }, { field: 'parts' }],
    [[PART, { ...PART, title: '   ' }], { field: 'title', index: 1 }],
    [[{ ...PART, title: 'x'.repeat(201) }], { field: 'title', index: 0 }],
    [[{ ...PART, shape: 'epic' }], { field: 'shape', index: 0 }],
    [[{ ...PART, type: 'chore' }], { field: 'type', index: 0 }],
    [[{ ...PART, definition: '' }], { field: 'definition', index: 0 }],
    [[{ ...PART, definition: 'x'.repeat(10001) }], { field: 'definition', index: 0 }],
    [[{ ...PART, key: 'Not_Kebab' }], { field: 'key', index: 0 }],
    [[{ ...PART, key: 'a'.repeat(41) }], { field: 'key', index: 0 }],
    [[null], { field: 'title', index: 0 }],
  ];
  for (const [parts, expected] of cases) {
    assert.deepEqual(core.validateShapeInput(parts), { ok: false, reason: 'badRequest', ...expected }, JSON.stringify(parts));
  }
});

// ─── The prompt ───────────────────────────────────────────────

const BRIEF = {
  number: 7, title: 'Offline mode', body: 'Let people work on a plane.',
  attachments: [{ id: 'a1', title: 'Notes', url: 'https://notes.test/1' }],
  comments: [{ id: 'c1', authorId: 'u-other', text: 'Sync first', createdAt: '2026-09-06T10:00:00.000Z' }],
};
const EVENTS = [
  { id: 'e1', at: '2026-09-01T10:00:00.000Z', event: 'created', data: {} },
  { id: 'e2', at: '2026-09-02T10:00:00.000Z', event: 'discussion-recorded', data: { summary: 'Settled on SQLite', provider: 'Codex CLI' } },
];
const COMMAND = '/Users/me/Library/Application Support/Frame/cloud-shapes/shape-brief.js';
const PROMPT = { brief: BRIEF, events: EVENTS, commandPath: COMMAND, shapeId: ID, meId: 'u-me' };

test('buildShapePrompt carries the brief, its links, its discussion records and its comments', () => {
  const prompt = core.buildShapePrompt(PROMPT);
  for (const text of ['Brief #7: Offline mode', 'Let people work on a plane.', 'https://notes.test/1', 'Settled on SQLite', 'with Codex CLI', 'Sync first']) {
    assert.ok(prompt.includes(text), text);
  }
});

test('buildShapePrompt steers the steps: read, one part by default, propose without questioning, write on approval', () => {
  const prompt = core.buildShapePrompt(PROMPT);
  assert.match(prompt, /\.frame\/specs\//);
  assert.match(prompt, /digest\.md/);
  assert.match(prompt, /Most briefs are one part: small, discrete work is one task, and anything bigger is one spec/);
  assert.match(prompt, /Split into several parts only when the work is too broad for one spec/);
  assert.match(prompt, /Propose it straight away; do not question the user first/);
  assert.doesNotMatch(prompt, /ask the user what the split depends on/);
  assert.match(prompt, /only after the user approves the whole set/);
});

test('buildShapePrompt has a spec part written as spec.md sections, in order', () => {
  const prompt = core.buildShapePrompt(PROMPT);
  assert.ok(prompt.includes('## Problem, ## Goal, ## Constraints, ## Success Criteria, ## Out of Scope, then ## Open Questions only when'));
  assert.match(prompt, /Problem, Goal and Success Criteria \(each "When X, then Y"\) always have content/);
});

test('buildShapePrompt has a task part written as task fields', () => {
  const prompt = core.buildShapePrompt(PROMPT);
  assert.ok(prompt.includes('## Description, ## Acceptance Criteria, then ## Notes only when'));
});

test('buildShapePrompt asks for a short title and a short kebab-case key per part, and types by the work', () => {
  const prompt = core.buildShapePrompt(PROMPT);
  assert.match(prompt, /a title: a short noun phrase for people, at most 60 characters — not a sentence/);
  assert.match(prompt, /a key: a short English name in kebab-case .* at most 32 characters/);
  assert.match(prompt, /its type, by the work the part does, not by its subject: feature \(new capability, including tooling/);
  assert.match(prompt, /test \(adds or changes tests only\)/);
  assert.ok(prompt.includes('{ "title": "…", "key": "…", "shape": "spec"'));
});

test('buildShapePrompt sends detail gaps to Open Questions or Notes instead of asking', () => {
  const prompt = core.buildShapePrompt(PROMPT);
  assert.match(prompt, /Do not ask the user to fill gaps in the details/);
  assert.match(prompt, /under ## Open Questions \(a spec\) or ## Notes \(a task\)/);
  assert.doesNotMatch(prompt, /## Why|## Done when/);
});

test('buildShapePrompt gives the exact command with a quoted path, the id and a quoted heredoc', () => {
  const prompt = core.buildShapePrompt(PROMPT);
  assert.ok(prompt.includes(`ELECTRON_RUN_AS_NODE=1 "$FRAME_NODE" '${COMMAND}' \\\n  --shape ${ID} <<'FRAME_PARTS'\n<parts JSON>\nFRAME_PARTS`));
  assert.match(prompt, /Tell the user exactly what it printed/);
});

test('buildShapePrompt ends a shaped session on "ready to run", never on opening a spec or task', () => {
  const prompt = core.buildShapePrompt(PROMPT);
  assert.match(prompt, /When it says the brief was shaped, this session is done/);
  assert.match(prompt, /its parts are ready to run, and stop there/);
  assert.match(prompt, /Do not offer to open, create or start a spec or a task for a part/);
});

test('buildShapePrompt offers no local file and no published write-up', () => {
  const prompt = core.buildShapePrompt(PROMPT);
  assert.match(prompt, /Do not write the parts to a file in the repository/);
  assert.doesNotMatch(prompt, /artifact/i);
  assert.doesNotMatch(prompt, /--url/);
});

test('buildShapePrompt fences brief content so it cannot close the fence', () => {
  const prompt = core.buildShapePrompt({ ...PROMPT, brief: { ...BRIEF, body: 'a ```` b' } });
  assert.match(prompt, /`````text\n/);
});

test('buildShapePrompt reads a brief with no description, links, records or comments', () => {
  const prompt = core.buildShapePrompt({ ...PROMPT, brief: { number: 2, title: 'Bare' }, events: [] });
  assert.match(prompt, /Brief #2: Bare\n\nDescription:\n\(none\)/);
});

// ─── Handling a shape request ─────────────────────────────────

const ok = (data) => ({ status: 200, body: { result: { data } } });
const refusal = (code, status = 400) => ({ status, body: { error: { message: code, data: { code: 'BAD_REQUEST' } } } });

/** deps with a fake server: `shape` answers brief.shape, `get` answers brief.getByNumber. */
function fakeDeps({ get = ok({ id: 'b7', number: 7, kind: 'work', title: 'Offline mode', status: 'backlog' }), shape = ok({ id: 'b7', number: 7 }), connected = true } = {}) {
  const sent = [];
  const fetchJson = async (url, opts) => {
    const [path, query = ''] = url.slice(`${API}/trpc/`.length).split('?');
    const input = opts.body || JSON.parse(decodeURIComponent(query.slice('input='.length)));
    sent.push({ name: path, input });
    return path === 'brief.getByNumber' ? get : shape;
  };
  const call = async (fn) => {
    try {
      return { ok: true, value: await fn({ api: API, token: 't0k', fetchJson }) };
    } catch (err) {
      return { ok: false, reason: classifyLinkError(err) };
    }
  };
  const store = core.addShape(core.emptyStore(), { id: ID, ...ENTRY });
  const connectedProject = (folderPath) => (connected && folderPath === ENTRY.folderPath ? { slug: 'my-app' } : null);
  return { deps: { store, connectedProject, call }, sent };
}

test('handleShapeRequest sends exactly one brief.shape with every part, in order', async () => {
  const { deps, sent } = fakeDeps();
  const parts = [
    { ...PART, title: ' First ' },
    { title: 'Second', shape: 'task', type: 'docs', definition: 'Two' },
    { title: 'Third', shape: 'task', type: 'test', definition: 'Three' },
  ];
  const r = await core.handleShapeRequest({ shapeId: ID, parts }, deps);
  assert.deepEqual(r, { ok: true, folderPath: '/work/app', number: 7, count: 3 });
  assert.deepEqual(sent, [
    { name: 'brief.getByNumber', input: { projectSlug: 'my-app', number: 7 } },
    {
      name: 'brief.shape',
      input: {
        id: 'b7',
        parts: [
          { title: 'First', shape: 'spec', type: 'feature', definition: PART.definition },
          { title: 'Second', shape: 'task', type: 'docs', definition: 'Two' },
          { title: 'Third', shape: 'task', type: 'test', definition: 'Three' },
        ],
      },
    },
  ]);
});

test('handleShapeRequest sends nothing for an unknown id, a bad part or a disconnected folder', async () => {
  const cases = [
    [{ shapeId: 'b'.repeat(24), parts: [PART] }, {}, { ok: false, reason: 'unknownShape' }],
    [{ parts: [PART] }, {}, { ok: false, reason: 'unknownShape' }],
    [{ shapeId: ID, parts: [] }, {}, { ok: false, reason: 'badRequest', field: 'parts' }],
    [{ shapeId: ID, parts: [PART, { ...PART, shape: 'epic' }] }, {}, { ok: false, reason: 'badRequest', field: 'shape', index: 1 }],
    [{ shapeId: ID, parts: [PART] }, { connected: false }, { ok: false, reason: 'notConnected' }],
  ];
  for (const [request, opts, expected] of cases) {
    const { deps, sent } = fakeDeps(opts);
    assert.deepEqual(await core.handleShapeRequest(request, deps), expected, JSON.stringify(request));
    assert.equal(sent.length, 0);
  }
  const { deps } = fakeDeps();
  assert.deepEqual(await core.handleShapeRequest(null, deps), { ok: false, reason: 'unknownShape' });
});

test('handleShapeRequest keeps the server\'s refusal reason', async () => {
  const cases = [
    ['NOT_WORK', 'notWork'],
    ['ALREADY_CLOSED', 'alreadyClosed'],
    ['ALREADY_SHAPED', 'alreadyShaped'],
    ['BRIEF_NOT_FOUND', 'notFound'],
  ];
  for (const [code, reason] of cases) {
    const { deps, sent } = fakeDeps({ shape: refusal(code) });
    assert.deepEqual(await core.handleShapeRequest({ shapeId: ID, parts: [PART] }, deps), { ok: false, reason }, code);
    assert.equal(sent.filter((s) => s.name === 'brief.shape').length, 1);
  }
});

test('handleShapeRequest reports a missing brief, a network failure and a sign-out', async () => {
  const cases = [
    [{ get: refusal('BRIEF_NOT_FOUND', 404) }, 'notFound', 1],
    [{ get: { status: 401, body: {} } }, 'unauthorized', 1],
    [{ shape: { status: 401, body: {} } }, 'unauthorized', 2],
  ];
  for (const [opts, reason, requests] of cases) {
    const { deps, sent } = fakeDeps(opts);
    assert.deepEqual(await core.handleShapeRequest({ shapeId: ID, parts: [PART] }, deps), { ok: false, reason });
    assert.equal(sent.length, requests);
  }
  const { deps } = fakeDeps();
  deps.call = async () => ({ ok: false, reason: 'network' });
  assert.deepEqual(await core.handleShapeRequest({ shapeId: ID, parts: [PART] }, deps), { ok: false, reason: 'network' });
});

test('replyMessage turns every outcome into a sentence', () => {
  assert.equal(core.replyMessage({ ok: true, number: 7, count: 3 }), 'Shaped brief #7 into 3 parts.');
  assert.equal(core.replyMessage({ ok: true, number: 7, count: 1 }), 'Shaped brief #7 into 1 part.');
  const reasons = ['unknownShape', 'notConnected', 'notWork', 'alreadyClosed', 'alreadyShaped', 'notFound', 'unauthorized', 'network', 'other'];
  for (const reason of reasons) {
    assert.match(core.replyMessage({ ok: false, reason }), /^Not shaped: /, reason);
  }
  assert.match(core.replyMessage({ ok: false, reason: 'alreadyShaped' }), /already shaped/);
  assert.match(core.replyMessage({ ok: false, reason: 'badRequest', field: 'parts' }), /at least one part/);
  assert.match(core.replyMessage({ ok: false, reason: 'badRequest', field: 'type', index: 1 }), /part 2 needs a type/);
  assert.match(core.replyMessage({ ok: false, reason: 'badRequest', field: 'definition', index: 0 }), /part 1 needs a definition/);
});

test('replyMessage names the role when the workspace role cannot shape', () => {
  const message = core.replyMessage({ ok: false, reason: 'roleForbidden' });
  assert.match(message, /^Not shaped: your role /);
  assert.match(message, /An admin can change your role\.$/);
});
