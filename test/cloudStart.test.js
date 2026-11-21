/**
 * cloudStart — slug and branch suggestion, the definition parsers, ref
 * allocation and the file and row builders of Start Work.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const start = require('../src/main/cloud/cloudStart');

const NOW = '2026-09-25T10:00:00.000Z';

// ─── Names ────────────────────────────────────────────────────

test('slugify follows spec.new: lowercase, [a-z0-9-], runs collapsed and trimmed', () => {
  assert.equal(start.slugify('Login flow'), 'login-flow');
  assert.equal(start.slugify('  Fix: the   "404" page!  '), 'fix-the-404-page');
  assert.equal(start.slugify('--a__b--'), 'a-b');
});

test('slugify folds accented and Turkish letters instead of dropping them', () => {
  assert.equal(start.slugify('Giriş akışı'), 'giris-akisi');
  assert.equal(start.slugify('Straße Œuvre Café'), 'strasse-oeuvre-cafe');
});

test('slugify cuts at 48 characters and trims the cut again', () => {
  const slug = start.slugify(`${'a'.repeat(47)} b c`);
  assert.equal(slug, 'a'.repeat(47));
  assert.equal(start.slugify('word '.repeat(20)).length <= 48, true);
  assert.equal(start.slugify('word '.repeat(20)).endsWith('-'), false);
});

test('slugify falls back when nothing is left', () => {
  assert.equal(start.slugify('!!!'), '');
  assert.equal(start.slugify('日本語', 'brief-3-part-1'), 'brief-3-part-1');
  assert.equal(start.slugify(undefined, 'x'), 'x');
});

test('slugify cuts a long title at the last word that fits, and a single long word hard', () => {
  assert.equal(start.slugify('Measure the spec flow\'s cost per successful outcome of an agent'), 'measure-the-spec-flow-s-cost-per-successful');
  assert.equal(start.slugify('Blind, multi-provider LLM judge for spec-sized work', '', 32), 'blind-multi-provider-llm-judge');
  assert.equal(start.slugify('x'.repeat(60), '', 32), 'x'.repeat(32));
  assert.equal(start.slugify('short title', '', 32), 'short-title');
});

const titled = (title, key) => (key === undefined ? { title } : { title, key });

test('suggestBranchName prefixes every type and names from the key, else the title within 32', () => {
  assert.equal(start.suggestBranchName('feature', titled('Login flow')), 'feat/login-flow');
  assert.equal(start.suggestBranchName('fix', titled('Login flow')), 'fix/login-flow');
  assert.equal(start.suggestBranchName('refactor', titled('Login flow')), 'refactor/login-flow');
  assert.equal(start.suggestBranchName('docs', titled('Login flow')), 'docs/login-flow');
  assert.equal(start.suggestBranchName('test', titled('Login flow')), 'test/login-flow');
  assert.equal(start.suggestBranchName('chore', titled('Login flow')), 'feat/login-flow');
  assert.equal(start.suggestBranchName('fix', titled('!!!'), 'brief-3'), 'fix/brief-3');
  assert.equal(start.suggestBranchName('test', titled('Blind, multi-provider LLM judge for spec-sized work: request coverage')),
    'test/blind-multi-provider-llm-judge');
  assert.equal(start.suggestBranchName('feature', titled('Blind, multi-provider LLM judge', 'llm-judge')), 'feat/llm-judge');
  assert.equal(start.suggestBranchName('feature', titled('Login flow', null)), 'feat/login-flow');
});

// ─── Definitions ──────────────────────────────────────────────

const SPEC_DEF = '## Problem\nIt breaks.\n\n## Goal\nIt works.\n\n## Open Questions\n- Which one?';

test('parseSpecDefinition keeps the definition as written', () => {
  assert.deepEqual(start.parseSpecDefinition(`\n${SPEC_DEF}\n`), { ok: true, body: SPEC_DEF });
});

test('parseSpecDefinition needs Problem and Goal, each with content', () => {
  assert.deepEqual(start.parseSpecDefinition(''), { ok: false, reason: 'empty' });
  assert.deepEqual(start.parseSpecDefinition('## Goal\nIt works.'), { ok: false, reason: 'noProblem' });
  assert.deepEqual(start.parseSpecDefinition('## Problem\nIt breaks.'), { ok: false, reason: 'noGoal' });
  assert.deepEqual(start.parseSpecDefinition('## Problem\n\n## Goal\nIt works.'), { ok: false, reason: 'noProblem' });
  assert.deepEqual(start.parseSpecDefinition('## Problem\nx\n### Goal\ny'), { ok: false, reason: 'noGoal' });
});

test('parseTaskDefinition takes all three fields', () => {
  const r = start.parseTaskDefinition('## Description\nFix it.\n\n## Acceptance Criteria\n- It works.\n\n## Notes\nSmall.');
  assert.deepEqual(r, { ok: true, fields: { description: 'Fix it.', acceptanceCriteria: '- It works.', notes: 'Small.' } });
});

test('parseTaskDefinition leaves out absent optional fields', () => {
  assert.deepEqual(start.parseTaskDefinition('## Description\nFix it.'), { ok: true, fields: { description: 'Fix it.' } });
});

test('parseTaskDefinition refuses no Description, an empty one, and text before the first heading', () => {
  assert.deepEqual(start.parseTaskDefinition('  '), { ok: false, reason: 'empty' });
  assert.deepEqual(start.parseTaskDefinition('## Notes\nx'), { ok: false, reason: 'noDescription' });
  assert.deepEqual(start.parseTaskDefinition('## Description\n\n## Notes\nx'), { ok: false, reason: 'noDescription' });
  assert.deepEqual(start.parseTaskDefinition('Fix it.\n## Description\nx'), { ok: false, reason: 'textBeforeHeading' });
});

test('parseTaskDefinition keeps an unknown heading in notes, under its heading', () => {
  const r = start.parseTaskDefinition('## Description\nFix it.\n## Risks\nNone.\n## Notes\nSmall.');
  assert.equal(r.fields.notes, 'Small.\n\n## Risks\n\nNone.');
  const alone = start.parseTaskDefinition('## Description\nFix it.\n## Risks\nNone.');
  assert.equal(alone.fields.notes, '## Risks\n\nNone.');
});

test('parseTaskDefinition does not split on a heading inside a code fence', () => {
  const r = start.parseTaskDefinition('## Description\nRun:\n```md\n## Notes\n```\ndone');
  assert.deepEqual(r, { ok: true, fields: { description: 'Run:\n```md\n## Notes\n```\ndone' } });
});

// ─── Refs ─────────────────────────────────────────────────────

const part = (id, title, shape) => ({ id, title, shape, type: 'feature' });

test('allocateRefs names specs by slug and tasks by task-<slug>, in part order', () => {
  const refs = start.allocateRefs([part('p1', 'Login flow', 'spec'), part('p2', 'Fix typo', 'task')], {}, 3);
  assert.deepEqual(refs, [
    { partId: 'p1', shape: 'spec', ref: 'login-flow' },
    { partId: 'p2', shape: 'task', ref: 'task-fix-typo' },
  ]);
});

test('allocateRefs adds -2 and -3 against the folder', () => {
  const refs = start.allocateRefs(
    [part('p1', 'Login flow', 'spec'), part('p2', 'Fix typo', 'task')],
    { specSlugs: ['login-flow', 'login-flow-2'], taskIds: ['task-fix-typo'] },
    3,
  );
  assert.deepEqual(refs.map((r) => r.ref), ['login-flow-3', 'task-fix-typo-2']);
});

test('allocateRefs counts refs picked earlier in the same start, per shape', () => {
  const refs = start.allocateRefs([
    part('p1', 'Login', 'spec'), part('p2', 'Login', 'spec'), part('p3', 'Login', 'task'), part('p4', 'Login', 'task'),
  ], {}, 3);
  assert.deepEqual(refs.map((r) => r.ref), ['login', 'login-2', 'task-login', 'task-login-2']);
});

test('allocateRefs names a part by its key when it has one, with the same -2 rule', () => {
  const refs = start.allocateRefs(
    [{ ...part('p1', 'A long spec title', 'spec'), key: 'llm-judge' }, { ...part('p2', 'A long task title', 'task'), key: 'fix-typo' }],
    { specSlugs: ['llm-judge'] },
    3,
  );
  assert.deepEqual(refs.map((r) => r.ref), ['llm-judge-2', 'task-fix-typo']);
});

test('allocateRefs falls back to brief-<N>-part-<P> and keeps a suffixed spec slug within 48', () => {
  const refs = start.allocateRefs([part('p1', '!!!', 'spec'), part('p2', '???', 'task')], {}, 7);
  assert.deepEqual(refs.map((r) => r.ref), ['brief-7-part-1', 'task-brief-7-part-2']);
  const long = 'a'.repeat(48);
  const [r] = start.allocateRefs([part('p1', long, 'spec')], { specSlugs: [long] }, 1);
  assert.equal(r.ref, `${'a'.repeat(46)}-2`);
});

// ─── Files ────────────────────────────────────────────────────

test('specFiles writes the title over the definition, and spec.new\'s status.json in phase specified', () => {
  const files = start.specFiles({ slug: 'login-flow', title: 'Login flow', definition: `${SPEC_DEF}\n\n`, now: NOW });
  assert.equal(files['spec.md'], `# Login flow\n\n${SPEC_DEF}\n`);
  assert.deepEqual(JSON.parse(files['status.json']), {
    slug: 'login-flow',
    title: 'Login flow',
    phase: 'specified',
    generated_task_ids: [],
    created_at: NOW,
    updated_at: NOW,
    last_phase_at: NOW,
  });
  assert.equal('ai_tool' in JSON.parse(files['status.json']), false);
});

test('taskTitle keeps 60 characters, cutting at the last space or hard', () => {
  assert.equal(start.taskTitle('Short title'), 'Short title');
  const sixty = 'x'.repeat(60);
  assert.equal(start.taskTitle(sixty), sixty);
  assert.equal(start.taskTitle(`${'word '.repeat(13)}end`), 'word word word word word word word word word word word word');
  assert.equal(start.taskTitle('y'.repeat(70)), 'y'.repeat(60));
});

test('taskRow is a pending row with the fields, the brief\'s priority and the part\'s type', () => {
  const row = start.taskRow({
    part: { id: 'p2', title: 'Fix typo', shape: 'task', type: 'fix' },
    fields: { description: 'Fix it.', acceptanceCriteria: '- Works', notes: 'Small.' },
    id: 'task-fix-typo',
    brief: { number: 3, priority: 'high' },
    now: NOW,
  });
  assert.deepEqual(row, {
    id: 'task-fix-typo',
    title: 'Fix typo',
    description: 'Fix it.',
    acceptanceCriteria: '- Works',
    notes: 'Small.',
    status: 'pending',
    priority: 'high',
    category: 'fix',
    context: 'Frame Cloud brief #3',
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
  });
});

test('taskRow defaults to medium and leaves out absent optional fields', () => {
  const row = start.taskRow({
    part: { title: 'x'.repeat(80), type: 'docs' },
    fields: { description: 'd' },
    id: 'task-x',
    brief: { number: 1, priority: null },
    now: NOW,
  });
  assert.equal(row.priority, 'medium');
  assert.equal(row.title.length, 60);
  assert.equal('acceptanceCriteria' in row, false);
  assert.equal('notes' in row, false);
});

test('startable is open, shaped, unstarted work only', () => {
  const SHAPED = '2026-09-20T10:00:00.000Z';
  const base = { kind: 'work', status: 'backlog', shapedAt: SHAPED, startedAt: null };
  assert.equal(start.startable(base), true);
  assert.equal(start.startable({ ...base, shapedAt: null }), false);
  assert.equal(start.startable({ ...base, startedAt: NOW, status: 'active' }), false);
  assert.equal(start.startable({ ...base, status: 'closed' }), false);
  assert.equal(start.startable({ ...base, kind: 'proposal' }), false);
  assert.equal(start.startable(null), false);
});

// ─── The dialog and the start ─────────────────────────────────

const { classifyLinkError } = require('../src/main/cloud/cloudProjects');

const API = 'http://cloud.test';
const SHAPED_AT = '2026-09-20T10:00:00.000Z';
const TASK_DEF = '## Description\nFix the typo.\n\n## Acceptance Criteria\n- Spelled right.';

const DETAIL = {
  id: 'b1', number: 3, kind: 'work', title: 'Better login', priority: 'high', targetBranch: 'main',
  status: 'backlog', shapedAt: SHAPED_AT, startedAt: null,
  parts: [
    { id: 'p1', position: 0, title: 'Login flow', shape: 'spec', type: 'feature', definition: SPEC_DEF },
    { id: 'p2', position: 1, title: 'Fix typo', shape: 'task', type: 'fix', definition: TASK_DEF },
  ],
};

const ok = (data) => ({ status: 200, body: { result: { data } } });
const refusal = (code) => ({ status: 400, body: { error: { message: code, data: { code: 'BAD_REQUEST' } } } });

/**
 * Fakes for every dep, recording each effect in `log`. `answers` overrides
 * the cloud (`get`, `start`), the folder (`specSlugs`, `taskIds`, `local`,
 * `remote`, `tip`: the new branch's commit) and failures
 * (`fail: 'branch' | 'workspace' | 'spec' | 'tasks'`).
 */
const HEAD = 'c'.repeat(40);
const TASKS_PATH = '/repo/.frame/tasks.json';
const WS_PATH = '/repo/.frame-workspaces/login-flow';
const workspaceOf = (branch, base) => ({ id: 'ws1', name: branch.split('/').pop(), path: WS_PATH, branch, base });

function fakes(answers = {}) {
  const log = [];
  const sent = [];
  const branches = [];
  const fetches = [];
  const fetchJson = async (url, opts = {}) => {
    const name = url.slice(`${API}/trpc/`.length).split('?')[0];
    sent.push({ name, body: opts.body });
    if (name === 'brief.getByNumber') return answers.get || ok(DETAIL);
    if (name === 'brief.start') return answers.start || ok({ ...DETAIL, startedAt: '2026-09-25T10:00:00.000Z' });
    throw new Error(`unexpected ${name}`);
  };
  const call = async (fn) => {
    try {
      return { ok: true, value: await fn({ api: API, token: 't0k', fetchJson }) };
    } catch (err) {
      return { ok: false, reason: classifyLinkError(err) };
    }
  };
  const local = new Set(answers.local || ['main']);
  const failing = (step) => {
    if (answers.fail === step) throw new Error(`${step} broke`);
  };
  const deps = {
    call,
    projectSlug: 'my-app',
    specSlugs: async () => answers.specSlugs || [],
    taskIds: async () => answers.taskIds || [],
    isValidBranchName: (name) => /^[a-z0-9/_-]+$/.test(name),
    localBranchExists: async (name) => local.has(name),
    remoteBranchExists: async (name) => (answers.remote || []).includes(name),
    fetchBase: async (name) => {
      fetches.push({ name, afterStart: sent.some((s) => s.name === 'brief.start') });
      if (answers.fetch instanceof Error) throw answers.fetch;
      return answers.fetch || { fetched: true, error: null };
    },
    createBranch: async (name, base, opts) => { failing('branch'); log.push(['branch', name, base, opts]); },
    branchSha: async (name) => { log.push(['sha', name]); return 'tip' in answers ? answers.tip : HEAD; },
    createWorkspace: async (branch, base) => {
      failing('workspace');
      log.push(['workspace', branch, base]);
      return answers.workspace !== undefined ? answers.workspace : { workspace: workspaceOf(branch, base), setupScript: 'npm ci' };
    },
    recordBranch: answers.recordBranch || (async (input) => { branches.push(input); }),
    writeSpec: async (slug, files, root) => { failing('spec'); log.push(['spec', slug, files, root]); },
    writeTasks: async (rows) => { failing('tasks'); log.push(['tasks', rows]); },
    tasksPath: () => TASKS_PATH,
    begun: async (partId) => (answers.begun || {})[partId] || null,
    recordBegun: async (entry) => log.push(['recorded', entry]),
    now: () => NOW,
  };
  return { deps, log, sent, branches, fetches, starts: () => sent.filter((s) => s.name === 'brief.start') };
}

const REQUEST = { number: 3, beginPartId: 'p1', branch: 'feat/login-flow' };

/** The effects in order, without the branch-tip read. */
const steps = (log) => log.map((e) => e[0]).filter((name) => name !== 'sha');
/** The first logged effect named `name`. */
const effect = (log, name) => log.find((e) => e[0] === name);

test('pickBase prefers origin\'s target, then the local one, then nothing', () => {
  assert.equal(start.pickBase('main', { local: true, remote: true }), 'origin/main');
  assert.equal(start.pickBase('main', { local: false, remote: true }), 'origin/main');
  assert.equal(start.pickBase('main', { local: true, remote: false }), 'main');
  assert.equal(start.pickBase('main', { local: false, remote: false }), null);
  assert.equal(start.pickBase('', { local: true, remote: true }), null);
});

const STARTED = {
  ...DETAIL,
  status: 'active',
  startedAt: NOW,
  parts: [
    { ...DETAIL.parts[0], recordRef: 'login-flow' },
    { ...DETAIL.parts[1], recordRef: 'task-fix-typo' },
  ],
};

test('prepareView in start mode: every part can be begun unless its definition does not parse', () => {
  const brief = { ...DETAIL, parts: [...DETAIL.parts, { id: 'p3', position: 2, title: 'Docs', shape: 'task', type: 'docs', definition: 'Just do it' }] };
  const view = start.prepareView({ brief, base: 'origin/main' });
  assert.deepEqual(view, {
    ok: true,
    mode: 'start',
    number: 3,
    title: 'Better login',
    targetBranch: 'main',
    parts: [
      { partId: 'p1', title: 'Login flow', shape: 'spec', type: 'feature', ref: null, begunBranch: null, problem: null, canBegin: true },
      { partId: 'p2', title: 'Fix typo', shape: 'task', type: 'fix', ref: null, begunBranch: null, problem: null, canBegin: true },
      { partId: 'p3', title: 'Docs', shape: 'task', type: 'docs', ref: null, begunBranch: null, problem: 'textBeforeHeading', canBegin: false },
    ],
    suggestions: { p1: 'feat/login-flow', p2: 'fix/fix-typo', p3: 'docs/docs' },
    base: 'origin/main',
    bases: [],
  });
});

test('prepareView in begin mode: only a reserved part this machine has not begun', () => {
  const view = start.prepareView({ brief: STARTED, base: 'main', begun: { p1: 'feat/login-flow' } });
  assert.equal(view.mode, 'begin');
  assert.deepEqual(view.parts.map((p) => [p.ref, p.begunBranch, p.canBegin]), [
    ['login-flow', 'feat/login-flow', false],
    ['task-fix-typo', null, true],
  ]);
});

test('prepareView refuses a brief that is neither startable nor started', () => {
  for (const brief of [{ ...DETAIL, shapedAt: null }, { ...STARTED, status: 'closed' }, { ...DETAIL, parts: [] }, { ...DETAIL, kind: 'proposal' }, null]) {
    assert.deepEqual(start.prepareView({ brief, base: 'main' }), { ok: false, reason: 'notStartable' });
  }
});

test('Start with a spec: brief.start reserves every ref, and only the chosen part is written and recorded', async () => {
  const { deps, log, starts } = fakes();
  const result = await start.handleStartRequest(REQUEST, deps);
  assert.deepEqual(result, {
    ok: true, mode: 'start', number: 3, branch: 'feat/login-flow',
    part: { title: 'Login flow', shape: 'spec', ref: 'login-flow' },
    specs: 1, tasks: 0,
    begin: { shape: 'spec', slug: 'login-flow', title: 'Login flow' },
    workspace: { id: 'ws1', name: 'login-flow', path: WS_PATH, branch: 'feat/login-flow', base: 'main' },
    setupScript: 'npm ci',
    fetch: { fetched: false, error: null, skipped: true },
  });
  assert.equal(starts().length, 1);
  assert.deepEqual(starts()[0].body, { id: 'b1', parts: [{ partId: 'p1', recordRef: 'login-flow' }, { partId: 'p2', recordRef: 'task-fix-typo' }] });
  assert.deepEqual(steps(log), ['branch', 'workspace', 'spec', 'recorded']);
  assert.deepEqual(log[0], ['branch', 'feat/login-flow', 'main', { track: true }]);
  assert.deepEqual(effect(log, 'workspace'), ['workspace', 'feat/login-flow', 'main']);
  assert.equal(effect(log, 'spec')[2]['spec.md'], `# Login flow\n\n${SPEC_DEF}\n`);
  assert.equal(effect(log, 'spec')[3], WS_PATH, 'the spec is written into the workspace');
  assert.deepEqual(effect(log, 'recorded')[1], { partId: 'p1', ref: 'login-flow', branch: 'feat/login-flow', baseSha: HEAD });
});

test('the ref written is the one reserved, after a local collision', async () => {
  const { deps, log, starts } = fakes({ specSlugs: ['login-flow'], taskIds: ['task-fix-typo', 'task-fix-typo-2'] });
  await start.handleStartRequest(REQUEST, deps);
  assert.deepEqual(starts()[0].body.parts.map((p) => p.recordRef), ['login-flow-2', 'task-fix-typo-3']);
  assert.equal(effect(log, 'spec')[1], 'login-flow-2');
});

test('Start with a task writes only that task row, and an empty branch takes its suggestion', async () => {
  const { deps, log } = fakes();
  const result = await start.handleStartRequest({ ...REQUEST, beginPartId: 'p2', branch: '  ' }, deps);
  assert.equal(result.branch, 'fix/fix-typo');
  assert.deepEqual(result.begin, {
    shape: 'task',
    task: { id: 'task-fix-typo', title: 'Fix typo', description: 'Fix the typo.', priority: 'high' },
    tasksPath: TASKS_PATH,
  });
  assert.deepEqual(result.workspace, { id: 'ws1', name: 'fix-typo', path: WS_PATH, branch: 'fix/fix-typo', base: 'main' });
  assert.deepEqual(steps(log), ['branch', 'workspace', 'tasks', 'recorded']);
  assert.equal(effect(log, 'tasks')[1].length, 1);
  assert.equal(effect(log, 'tasks')[1][0].acceptanceCriteria, '- Spelled right.');
});

test('Start does not check a part that is not being begun', async () => {
  const brief = { ...DETAIL, parts: [DETAIL.parts[0], { ...DETAIL.parts[1], definition: '## Notes\nx' }] };
  const { deps } = fakes({ get: ok(brief) });
  assert.equal((await start.handleStartRequest(REQUEST, deps)).ok, true);
});

test('Begin on a started brief: its reserved ref, no cloud write, recorded as begun', async () => {
  const { deps, log, starts } = fakes({ get: ok(STARTED) });
  const result = await start.handleStartRequest({ ...REQUEST, beginPartId: 'p2', branch: 'fix/typo' }, deps);
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'begin');
  assert.deepEqual(result.part, { title: 'Fix typo', shape: 'task', ref: 'task-fix-typo' });
  assert.equal(starts().length, 0);
  assert.deepEqual(steps(log), ['branch', 'workspace', 'tasks', 'recorded']);
  assert.equal(effect(log, 'tasks')[1][0].id, 'task-fix-typo');
});

test('Begin refuses a part begun on a branch that still exists, and allows it once that branch is gone', async () => {
  const kept = fakes({ get: ok(STARTED), begun: { p1: { branch: 'feat/login-flow' } }, local: ['main', 'feat/login-flow'] });
  assert.deepEqual(await start.handleStartRequest({ ...REQUEST, branch: 'feat/again' }, kept.deps),
    { ok: false, reason: 'alreadyBegun', detail: 'feat/login-flow' });
  assert.deepEqual(kept.log, []);
  const gone = fakes({ get: ok(STARTED), begun: { p1: { branch: 'feat/login-flow' } } });
  assert.equal((await start.handleStartRequest(REQUEST, gone.deps)).ok, true);
});

test('Begin refuses a part without a reserved ref', async () => {
  const brief = { ...STARTED, parts: [{ ...STARTED.parts[0], recordRef: null }, STARTED.parts[1]] };
  const { deps, log } = fakes({ get: ok(brief) });
  assert.deepEqual(await start.handleStartRequest(REQUEST, deps), { ok: false, reason: 'notStartable' });
  assert.deepEqual(log, []);
});

test('a remote base is cut without tracking', async () => {
  const { deps, log } = fakes({ local: [], remote: ['main'] });
  const result = await start.handleStartRequest(REQUEST, deps);
  assert.equal(result.ok, true);
  assert.deepEqual(log[0], ['branch', 'feat/login-flow', 'origin/main', { track: false }]);
});

test('with no base picked, origin\'s target wins over the local one and is fetched before brief.start', async () => {
  const { deps, log, fetches, starts } = fakes({ local: ['main'], remote: ['main'] });
  const result = await start.handleStartRequest(REQUEST, deps);
  assert.equal(result.ok, true);
  assert.deepEqual(fetches, [{ name: 'main', afterStart: false }]);
  assert.equal(starts().length, 1);
  assert.deepEqual(effect(log, 'branch'), ['branch', 'feat/login-flow', 'origin/main', { track: false }]);
  assert.deepEqual(effect(log, 'workspace'), ['workspace', 'feat/login-flow', 'main']);
  assert.deepEqual(result.fetch, { fetched: true, error: null, skipped: false });
});

test('an origin base the user picks is fetched by its branch name', async () => {
  const { deps, log, fetches } = fakes({ local: ['main'], remote: ['main', 'dev'] });
  const result = await start.handleStartRequest({ ...REQUEST, base: 'origin/dev' }, deps);
  assert.equal(result.ok, true);
  assert.deepEqual(fetches.map((f) => f.name), ['dev']);
  assert.deepEqual(effect(log, 'branch'), ['branch', 'feat/login-flow', 'origin/dev', { track: false }]);
});

test('a failed fetch is no refusal: the branch is cut from the last fetched copy and the answer says so', async () => {
  const offline = fakes({ local: [], remote: ['main'], fetch: { fetched: false, error: 'Could not resolve host' } });
  const result = await start.handleStartRequest(REQUEST, offline.deps);
  assert.equal(result.ok, true);
  assert.deepEqual(effect(offline.log, 'branch'), ['branch', 'feat/login-flow', 'origin/main', { track: false }]);
  assert.deepEqual(result.fetch, { fetched: false, error: 'Could not resolve host', skipped: false });
  const thrown = fakes({ local: [], remote: ['main'], fetch: new Error('git is gone') });
  const answer = await start.handleStartRequest(REQUEST, thrown.deps);
  assert.equal(answer.ok, true);
  assert.deepEqual(answer.fetch, { fetched: false, error: 'git is gone', skipped: false });
});

test('a local base is cut as it is, with no fetch', async () => {
  const { deps, log, fetches } = fakes({ local: ['main'], remote: ['main'] });
  const result = await start.handleStartRequest({ ...REQUEST, base: 'main' }, deps);
  assert.equal(result.ok, true);
  assert.deepEqual(fetches, []);
  assert.deepEqual(effect(log, 'branch'), ['branch', 'feat/login-flow', 'main', { track: true }]);
  assert.deepEqual(result.fetch, { fetched: false, error: null, skipped: true });
});

test('a refused start fetches nothing', async () => {
  const { deps, fetches } = fakes({ local: ['main', 'feat/login-flow'], remote: ['main'] });
  assert.equal((await start.handleStartRequest(REQUEST, deps)).reason, 'branchTaken');
  assert.deepEqual(fetches, []);
});

test('baseOptions lists local branches newest first, then origin\'s, without its HEAD', () => {
  const branches = [
    { name: 'main', isRemote: false, time: 1 },
    { name: 'feat/x', isRemote: false, time: 5 },
    { name: 'origin/main', isRemote: true, time: 1 },
    { name: 'origin/HEAD', isRemote: true, time: 9 },
    { name: 'upstream/main', isRemote: true, time: 9 },
    { name: 'origin/dev', isRemote: true, time: 3 },
    null,
  ];
  assert.deepEqual(start.baseOptions(branches), [
    { name: 'feat/x', remote: false },
    { name: 'main', remote: false },
    { name: 'origin/dev', remote: true },
    { name: 'origin/main', remote: true },
  ]);
  assert.deepEqual(start.baseOptions(undefined), []);
});

test('a chosen base is used when it exists: a local one tracks by default, origin\'s is cut without tracking', async () => {
  const localBase = fakes({ local: ['main', 'dev'] });
  assert.equal((await start.handleStartRequest({ ...REQUEST, base: 'dev' }, localBase.deps)).ok, true);
  assert.deepEqual(localBase.log[0], ['branch', 'feat/login-flow', 'dev', { track: true }]);
  const remoteBase = fakes({ remote: ['release'] });
  assert.equal((await start.handleStartRequest({ ...REQUEST, base: 'origin/release' }, remoteBase.deps)).ok, true);
  assert.deepEqual(remoteBase.log[0], ['branch', 'feat/login-flow', 'origin/release', { track: false }]);
});

test('a chosen base that does not exist is refused, naming it', async () => {
  for (const base of ['nope', 'origin/nope']) {
    const { deps, log, starts } = fakes();
    assert.deepEqual(await start.handleStartRequest({ ...REQUEST, base }, deps), { ok: false, reason: 'baseMissing', detail: base });
    assert.equal(starts().length, 0);
    assert.deepEqual(log, []);
  }
});

test('each local refusal writes nothing and sends no brief.start', async () => {
  const badPart = { ...DETAIL, parts: [{ ...DETAIL.parts[0], definition: '## Goal\nx' }, DETAIL.parts[1]] };
  const cases = [
    [{ get: ok({ ...DETAIL, shapedAt: null }) }, REQUEST, { ok: false, reason: 'notStartable' }],
    [{ get: ok(badPart) }, REQUEST, { ok: false, reason: 'badDefinition', part: 'Login flow', detail: 'noProblem' }],
    [{}, { ...REQUEST, beginPartId: 'nope' }, { ok: false, reason: 'badRequest' }],
    [{}, { ...REQUEST, beginPartId: null }, { ok: false, reason: 'badRequest' }],
    [{}, { ...REQUEST, branch: 'Bad Name' }, { ok: false, reason: 'badBranch', detail: 'Bad Name' }],
    [{ local: ['main', 'feat/login-flow'] }, REQUEST, { ok: false, reason: 'branchTaken', detail: 'feat/login-flow' }],
    [{ local: [] }, REQUEST, { ok: false, reason: 'baseMissing', detail: 'main' }],
    [{ get: { status: 401, body: {} } }, REQUEST, { ok: false, reason: 'unauthorized' }],
  ];
  for (const [answers, request, expected] of cases) {
    const { deps, log, starts } = fakes(answers);
    assert.deepEqual(await start.handleStartRequest(request, deps), expected, expected.reason);
    assert.equal(starts().length, 0, expected.reason);
    assert.deepEqual(log, [], expected.reason);
  }
});

test('a server refusal, recordRefTaken among them, writes nothing', async () => {
  for (const [code, reason] of [['RECORD_REF_TAKEN', 'recordRefTaken'], ['ALREADY_STARTED', 'alreadyStarted'], ['PARTS_MISMATCH', 'partsMismatch'], ['NOT_SHAPED', 'notShaped']]) {
    const { deps, log, starts } = fakes({ start: refusal(code) });
    assert.deepEqual(await start.handleStartRequest(REQUEST, deps), { ok: false, reason }, code);
    assert.equal(starts().length, 1);
    assert.deepEqual(log, [], code);
  }
});

test('uncommitted changes are never asked about or stashed, whatever the request says', async () => {
  const { deps, log } = fakes();
  const touched = [];
  deps.changeCount = async () => { touched.push('changeCount'); return 3; };
  deps.currentBranch = async () => { touched.push('currentBranch'); return 'feat/other'; };
  deps.stash = async () => { touched.push('stash'); };
  for (const request of [REQUEST, { ...REQUEST, stash: true }]) {
    const result = await start.handleStartRequest(request, deps);
    assert.equal(result.ok, true);
    assert.equal('stashMessage' in result, false);
  }
  assert.deepEqual(touched, []);
  assert.deepEqual(steps(log), ['branch', 'workspace', 'spec', 'recorded', 'branch', 'workspace', 'spec', 'recorded']);
});

test('prepareView carries no dirty-folder fields', () => {
  const view = start.prepareView({ brief: DETAIL, base: 'main', currentBranch: 'feat/other', changeCount: 4 });
  assert.equal('changeCount' in view, false);
  assert.equal('currentBranch' in view, false);
});

test('a failure after the checks is partial, names the part, and records nothing', async () => {
  const cases = [
    [{ fail: 'branch' }, REQUEST, 'branch'],
    [{ fail: 'workspace' }, REQUEST, 'workspace'],
    [{ fail: 'spec' }, REQUEST, 'files'],
    [{ fail: 'tasks', get: ok(STARTED) }, { ...REQUEST, beginPartId: 'p2' }, 'files'],
  ];
  for (const [answers, request, step] of cases) {
    const { deps, log } = fakes(answers);
    const result = await start.handleStartRequest(request, deps);
    const missing = request.beginPartId === 'p2'
      ? [{ title: 'Fix typo', shape: 'task', ref: 'task-fix-typo' }]
      : [{ title: 'Login flow', shape: 'spec', ref: 'login-flow' }];
    assert.deepEqual(result, { ok: false, reason: 'partial', step, written: [], missing, error: `${answers.fail} broke` }, answers.fail);
    assert.equal(log.some((e) => e[0] === 'recorded'), false, answers.fail);
  }
});

// ─── Begin records the branch (frame-cloud-brief-done) ────────

test('Start sends recordBranch once with the branch and the commit it was cut from', async () => {
  const { deps, branches } = fakes();
  const result = await start.handleStartRequest(REQUEST, deps);
  assert.equal(result.ok, true);
  assert.deepEqual(branches, [{ id: 'b1', partId: 'p1', branch: 'feat/login-flow', baseSha: HEAD }]);
});

test('Begin sends recordBranch once with the branch and the base SHA', async () => {
  const { deps, log, branches } = fakes({ get: ok(STARTED) });
  const result = await start.handleStartRequest({ ...REQUEST, beginPartId: 'p2', branch: 'fix/typo' }, deps);
  assert.equal(result.mode, 'begin');
  assert.deepEqual(branches, [{ id: 'b1', partId: 'p2', branch: 'fix/typo', baseSha: HEAD }]);
  assert.deepEqual(effect(log, 'recorded')[1], { partId: 'p2', ref: 'task-fix-typo', branch: 'fix/typo', baseSha: HEAD });
});

test('a rejecting or throwing recordBranch leaves Begin\'s answer unchanged', async () => {
  for (const mode of ['start', 'begin']) {
    const answers = mode === 'begin' ? { get: ok(STARTED) } : {};
    const request = mode === 'begin' ? { ...REQUEST, beginPartId: 'p2', branch: 'fix/typo' } : REQUEST;
    const want = await start.handleStartRequest(request, fakes(answers).deps);
    let calls = 0;
    const rejecting = fakes({ ...answers, recordBranch: async () => { calls += 1; throw new Error('offline'); } });
    assert.deepEqual(await start.handleStartRequest(request, rejecting.deps), want, mode);
    const throwing = fakes({ ...answers, recordBranch: () => { calls += 1; throw new Error('boom'); } });
    assert.deepEqual(await start.handleStartRequest(request, throwing.deps), want, mode);
    assert.equal(calls, 2, mode);
    assert.equal(rejecting.log.some((e) => e[0] === 'recorded'), true, mode);
  }
  // Let the swallowed rejections settle inside this test.
  await new Promise((resolve) => setImmediate(resolve));
});

test('without a full commit id the branch is recorded here but not sent', async () => {
  for (const tip of [null, '', 'abc123', 'C'.repeat(40)]) {
    const { deps, log, branches } = fakes({ tip });
    assert.equal((await start.handleStartRequest(REQUEST, deps)).ok, true);
    assert.deepEqual(branches, [], String(tip));
    assert.deepEqual(effect(log, 'recorded')[1], { partId: 'p1', ref: 'login-flow', branch: 'feat/login-flow', baseSha: null });
  }
  const failing = fakes();
  failing.deps.branchSha = async () => { throw new Error('git broke'); };
  assert.equal((await start.handleStartRequest(REQUEST, failing.deps)).ok, true);
  assert.deepEqual(failing.branches, []);
});

test('a Begin that fails partway sends no branch', async () => {
  for (const fail of ['branch', 'workspace', 'spec']) {
    const { deps, branches } = fakes({ fail });
    assert.equal((await start.handleStartRequest(REQUEST, deps)).reason, 'partial', fail);
    assert.deepEqual(branches, [], fail);
  }
});

// ─── The part opens in its own workspace (frame-cloud-start-workspace) ──

test('workspaceBase is a branch name: origin/ is dropped, a local base is kept', () => {
  assert.equal(start.workspaceBase('origin/main'), 'main');
  assert.equal(start.workspaceBase('origin/release/2.0'), 'release/2.0');
  assert.equal(start.workspaceBase('dev'), 'dev');
  assert.equal(start.workspaceBase('  origin/main '), 'main');
  assert.equal(start.workspaceBase(undefined), '');
});

test('the order: cut the branch, read its tip, open the workspace, then write the part', async () => {
  const { deps, log } = fakes();
  await start.handleStartRequest(REQUEST, deps);
  assert.deepEqual(log.map((e) => e[0]), ['branch', 'sha', 'workspace', 'spec', 'recorded']);
});

test('the base commit is read from the new branch, not from the main checkout', async () => {
  const { deps, log, branches } = fakes({ tip: 'd'.repeat(40) });
  await start.handleStartRequest(REQUEST, deps);
  assert.deepEqual(effect(log, 'sha'), ['sha', 'feat/login-flow']);
  assert.deepEqual(branches, [{ id: 'b1', partId: 'p1', branch: 'feat/login-flow', baseSha: 'd'.repeat(40) }]);
  assert.equal(effect(log, 'recorded')[1].baseSha, 'd'.repeat(40));
});

test('the workspace is opened on the part\'s branch with the base as a branch name', async () => {
  const remote = fakes({ local: [], remote: ['main'] });
  const result = await start.handleStartRequest(REQUEST, remote.deps);
  assert.deepEqual(effect(remote.log, 'branch'), ['branch', 'feat/login-flow', 'origin/main', { track: false }]);
  assert.deepEqual(effect(remote.log, 'workspace'), ['workspace', 'feat/login-flow', 'main']);
  assert.equal(result.workspace.base, 'main');
  const picked = fakes({ local: ['main', 'dev'] });
  await start.handleStartRequest({ ...REQUEST, base: 'dev' }, picked.deps);
  assert.deepEqual(effect(picked.log, 'workspace'), ['workspace', 'feat/login-flow', 'dev']);
});

test('a spec part is written into the workspace; a task part\'s row goes to the main checkout with its path', async () => {
  const spec = fakes();
  const specResult = await start.handleStartRequest(REQUEST, spec.deps);
  assert.equal(effect(spec.log, 'spec')[3], WS_PATH);
  assert.equal('tasksPath' in specResult.begin, false);
  const task = fakes();
  const taskResult = await start.handleStartRequest({ ...REQUEST, beginPartId: 'p2' }, task.deps);
  assert.equal(effect(task.log, 'spec'), undefined);
  assert.equal(effect(task.log, 'tasks')[1][0].id, 'task-fix-typo');
  assert.equal(taskResult.begin.tasksPath, TASKS_PATH);
  const noPath = fakes();
  noPath.deps.tasksPath = () => '';
  assert.equal((await start.handleStartRequest({ ...REQUEST, beginPartId: 'p2' }, noPath.deps)).begin.tasksPath, null);
});

test('a failed workspace leaves the branch cut, writes no part, records nothing and sends no branch', async () => {
  const { deps, log, branches, starts } = fakes({ fail: 'workspace' });
  const result = await start.handleStartRequest(REQUEST, deps);
  assert.deepEqual(result, {
    ok: false, reason: 'partial', step: 'workspace', written: [],
    missing: [{ title: 'Login flow', shape: 'spec', ref: 'login-flow' }], error: 'workspace broke',
  });
  assert.equal(starts().length, 1, 'the brief is started all the same');
  assert.deepEqual(steps(log), ['branch']);
  assert.deepEqual(branches, []);
});

test('a workspace answer without an id or a path is a failed workspace step', async () => {
  for (const workspace of [null, {}, { workspace: { id: 'ws1' } }, { workspace: { path: WS_PATH } }]) {
    const { deps, log } = fakes({ workspace });
    const result = await start.handleStartRequest(REQUEST, deps);
    assert.equal(result.reason, 'partial', JSON.stringify(workspace));
    assert.equal(result.step, 'workspace', JSON.stringify(workspace));
    assert.equal(effect(log, 'spec'), undefined);
  }
});

test('a workspace without a setup script answers an empty one, and its branch defaults to the part\'s', async () => {
  const { deps } = fakes({ workspace: { workspace: { id: 'ws2', name: 'x', path: '/w/x' } } });
  const result = await start.handleStartRequest(REQUEST, deps);
  assert.equal(result.setupScript, '');
  assert.deepEqual(result.workspace, { id: 'ws2', name: 'x', path: '/w/x', branch: 'feat/login-flow', base: null });
});

// ─── Begun parts ──────────────────────────────────────────────

const BEGUN = { projectId: 'proj1', number: 3, partId: 'p1', ref: 'login-flow', branch: 'feat/login-flow', begunAt: NOW };

test('addBegun records a part under its project, brief and part, and getBegun reads it back', () => {
  const store = start.addBegun(start.emptyBegun(), BEGUN);
  assert.deepEqual(start.getBegun(store, 'proj1', 3, 'p1'), { ref: 'login-flow', branch: 'feat/login-flow', begunAt: NOW });
  assert.equal(start.getBegun(store, 'proj1', 3, 'p2'), null);
  assert.equal(start.getBegun(store, 'proj2', 3, 'p1'), null);
  assert.equal(start.getBegun(store, 'proj1', 4, 'p1'), null);
});

test('the begun entry keeps a 40-hex baseSha, and an old entry without one still reads', () => {
  const sha = 'a'.repeat(40);
  const store = start.addBegun(start.emptyBegun(), { ...BEGUN, baseSha: sha });
  assert.deepEqual(start.getBegun(store, 'proj1', 3, 'p1'), { ref: 'login-flow', branch: 'feat/login-flow', begunAt: NOW, baseSha: sha });
  // An entry written before this feature: no baseSha key at all.
  const old = start.normalizeBegun({ begun: { 'proj1:3:p1': { ref: 'login-flow', branch: 'feat/login-flow', begunAt: NOW } } });
  assert.deepEqual(start.getBegun(old, 'proj1', 3, 'p1'), { ref: 'login-flow', branch: 'feat/login-flow', begunAt: NOW });
  // A baseSha that is not a full lowercase id is dropped, the entry kept.
  for (const bad of [null, '', 'abc', 'A'.repeat(40), 'a'.repeat(64), 7]) {
    const kept = start.addBegun(start.emptyBegun(), { ...BEGUN, baseSha: bad });
    assert.deepEqual(start.getBegun(kept, 'proj1', 3, 'p1'), { ref: 'login-flow', branch: 'feat/login-flow', begunAt: NOW }, String(bad));
  }
});

test('addBegun replaces a part begun again, and ignores a malformed entry', () => {
  const once = start.addBegun(start.emptyBegun(), BEGUN);
  const again = start.addBegun(once, { ...BEGUN, branch: 'feat/other' });
  assert.equal(start.getBegun(again, 'proj1', 3, 'p1').branch, 'feat/other');
  assert.deepEqual(once, start.addBegun(once, { ...BEGUN, partId: 'p2', branch: '' }));
  assert.deepEqual(once, start.addBegun(once, { ...BEGUN, partId: 'p2', number: '3' }));
});

test('normalizeBegun turns any shape into a valid store', () => {
  assert.deepEqual(start.normalizeBegun(null), { version: 1, begun: {} });
  assert.deepEqual(start.normalizeBegun({ begun: [] }), { version: 1, begun: {} });
  const kept = start.normalizeBegun({ begun: {
    'proj1:3:p1': { ref: 'a', branch: 'feat/a', begunAt: NOW, extra: 1 },
    'proj1:3:p2': { ref: 'b', branch: '' },
    'bad-key': { ref: 'c', branch: 'feat/c', begunAt: NOW },
  } });
  assert.deepEqual(kept, { version: 1, begun: { 'proj1:3:p1': { ref: 'a', branch: 'feat/a', begunAt: NOW } } });
});

test('withBegunBranches drops an entry whose branch this folder no longer has', () => {
  const store = start.addBegun(start.addBegun(start.emptyBegun(), BEGUN), { ...BEGUN, partId: 'p2', ref: 'task-x', branch: 'feat/gone' });
  const briefs = [{ number: 3, parts: [{ id: 'p1' }, { id: 'p2' }] }];
  const out = start.withBegunBranches(briefs, store, 'proj1', new Set(['main', 'feat/login-flow']));
  assert.deepEqual(out[0].parts.map((p) => p.begunBranch), ['feat/login-flow', null]);
});

test('withBegunBranches marks this machine\'s gone branch as gone when the cloud names it', () => {
  const store = start.addBegun(start.emptyBegun(), { ...BEGUN, branch: 'feat/gone' });
  const local = new Set(['main']);
  const briefs = [{ number: 3, parts: [{ id: 'p1', recordRef: 'login-flow', branch: 'feat/gone' }] }];
  const [part] = start.withBegunBranches(briefs, store, 'proj1', local)[0].parts;
  assert.equal(part.begunBranch, null);
  assert.equal(part.branchGone, true);
});

test('withBegunBranches never marks another machine\'s branch as gone', () => {
  const local = new Set(['main']);
  // No entry here: the cloud's branch was begun on another machine.
  const elsewhere = [{ number: 3, parts: [{ id: 'p1', recordRef: 'login-flow', branch: 'feat/theirs' }] }];
  assert.equal(start.withBegunBranches(elsewhere, start.emptyBegun(), 'proj1', local)[0].parts[0].branchGone, false);
  // This machine's entry names an older branch; the cloud has another machine's re-Begin.
  const store = start.addBegun(start.emptyBegun(), { ...BEGUN, branch: 'feat/mine-gone' });
  const rebegun = [{ number: 3, parts: [{ id: 'p1', recordRef: 'login-flow', branch: 'feat/theirs' }] }];
  assert.equal(start.withBegunBranches(rebegun, store, 'proj1', local)[0].parts[0].branchGone, false);
});

test('withBegunBranches keeps a live branch, and without a local list nothing is gone', () => {
  const store = start.addBegun(start.emptyBegun(), BEGUN);
  const briefs = [{ number: 3, parts: [{ id: 'p1', recordRef: 'login-flow', branch: BEGUN.branch }] }];
  const live = start.withBegunBranches(briefs, store, 'proj1', new Set([BEGUN.branch]))[0].parts[0];
  assert.deepEqual([live.begunBranch, live.branchGone], [BEGUN.branch, false]);
  const unknown = start.withBegunBranches(briefs, store, 'proj1')[0].parts[0];
  assert.deepEqual([unknown.begunBranch, unknown.branchGone], [BEGUN.branch, false]);
});

test('withBegunBranches marks each listed part with the branch this machine began it on', () => {
  const store = start.addBegun(start.emptyBegun(), BEGUN);
  const briefs = [
    { number: 3, parts: [{ id: 'p1', recordRef: 'login-flow' }, { id: 'p2', recordRef: 'task-fix-typo' }] },
    { number: 4, parts: null },
    { number: 5 },
  ];
  const out = start.withBegunBranches(briefs, store, 'proj1');
  assert.deepEqual(out[0].parts.map((p) => p.begunBranch), ['feat/login-flow', null]);
  assert.equal(out[1].parts, null);
  assert.equal('parts' in out[2], false);
  assert.equal(briefs[0].parts[0].begunBranch, undefined);
});
