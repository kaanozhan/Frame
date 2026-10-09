/**
 * The session-restore store's pure core: which reports count, how the live
 * map turns into a project's record, and what a project restores.
 *
 * The module is pure by contract — requiring it here with no Electron and no
 * stubs is itself half the test.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const store = require('../src/main/sessionRestoreStore');

const P = '/work/project-a';
const Q = '/work/project-b';
const S1 = 'a89de792-a745-4fbb-a9a5-df6df97cb566';
const S2 = '01a120aa-8786-7e52-ac45-768dd283efac';
const S3 = '11111111-2222-3333-4444-555555555555';

function payload(sessionId, extra = {}) {
  return JSON.stringify({
    session_id: sessionId,
    transcript_path: `/home/u/.claude/projects/x/${sessionId}.jsonl`,
    cwd: P,
    hook_event_name: 'SessionStart',
    source: 'startup',
    ...extra
  });
}

function liveWith(...terminals) {
  const live = {};
  terminals.forEach(([id, projectPath], i) => store.registerTerminal(live, id, { projectPath, createdAt: i + 1 }));
  return live;
}

function report(terminalId, tool, sessionId) {
  return store.parseReport(`${terminalId}.${tool}.123.json`, payload(sessionId));
}

// ─── reports ──────────────────────────────────────────────

test('parseReportName accepts only the hook\'s finished file name', () => {
  assert.deepEqual(store.parseReportName('term-3.claude.4567.json'), { terminalId: 'term-3', tool: 'claude', pid: 4567 });
  assert.deepEqual(store.parseReportName('term-12.codex.9.json'), { terminalId: 'term-12', tool: 'codex', pid: 9 });
  assert.equal(store.parseReportName('term-3.claude.4567.tmp'), null);
  assert.equal(store.parseReportName('term-3.gemini.4567.json'), null);
  assert.equal(store.parseReportName('../term-3.claude.1.json'), null);
});

test('parseReport reads the SessionStart payload', () => {
  const r = store.parseReport('term-1.claude.42.json', payload(S1, { source: 'resume' }));
  assert.equal(r.terminalId, 'term-1');
  assert.equal(r.tool, 'claude');
  assert.equal(r.pid, 42);
  assert.equal(r.sessionId, S1);
  assert.equal(r.transcriptPath, `/home/u/.claude/projects/x/${S1}.jsonl`);
  assert.equal(r.cwd, P);
  assert.equal(r.source, 'resume');
});

test('parseReport rejects what could not be resumed safely', () => {
  assert.equal(store.parseReport('term-1.claude.1.json', '{not json'), null);
  assert.equal(store.parseReport('term-1.claude.1.json', payload('abc; rm -rf ~')), null);
  assert.equal(store.parseReport('term-1.claude.1.json', payload(S1, { transcript_path: undefined })), null);
  assert.equal(store.parseReport('term-1.claude.1.json', payload(S1, { transcript_path: 'relative.jsonl' })), null);
  assert.ok(store.parseReport('term-1.codex.1.json', payload(S2, { transcript_path: 'C:\\Users\\u\\.codex\\s.jsonl' })));
});

// ─── live map → record ────────────────────────────────────

test('a plain shell never enters the record (S2)', () => {
  const live = liveWith(['term-1', P], ['term-2', P]);
  assert.equal(store.applyReport(live, report('term-2', 'claude', S1)), P);
  store.applyForeground(live, 'term-1', { processName: 'zsh', shellName: 'zsh' });
  const rec = store.projectRecord(live, P, 100);
  assert.equal(rec.sessions.length, 1);
  assert.equal(rec.sessions[0].sessionId, S1);
});

test('two Claude terminals in one project keep their own sessions (S7)', () => {
  const live = liveWith(['term-1', P], ['term-2', P]);
  store.applyReport(live, report('term-1', 'claude', S1));
  store.applyReport(live, report('term-2', 'claude', S3));
  const rec = store.projectRecord(live, P, 100);
  assert.deepEqual(rec.sessions.map((s) => s.sessionId), [S1, S3]);
});

test('Claude and Codex in one project both record with their tool (S8)', () => {
  const live = liveWith(['term-1', P], ['term-2', P]);
  store.applyReport(live, report('term-1', 'claude', S1));
  store.applyReport(live, report('term-2', 'codex', S2));
  assert.deepEqual(store.projectRecord(live, P, 1).sessions.map((s) => s.tool), ['claude', 'codex']);
});

test('a new session in the same terminal (/clear) replaces the old one', () => {
  const live = liveWith(['term-1', P]);
  store.applyReport(live, report('term-1', 'claude', S1));
  assert.equal(store.applyReport(live, report('term-1', 'claude', S3)), P);
  assert.deepEqual(store.projectRecord(live, P, 1).sessions.map((s) => s.sessionId), [S3]);
  // The same report again changes nothing persistent.
  assert.equal(store.applyReport(live, report('term-1', 'claude', S3)), null);
});

test('reports for unknown or project-less terminals are ignored', () => {
  const live = liveWith(['term-1', null]);
  assert.equal(store.applyReport(live, report('term-1', 'claude', S1)), null);
  assert.equal(store.applyReport(live, report('term-9', 'claude', S1)), null);
});

test('closing a terminal drops its session (S5)', () => {
  const live = liveWith(['term-1', P], ['term-2', P]);
  store.applyReport(live, report('term-1', 'claude', S1));
  assert.equal(store.applyClose(live, 'term-1'), P);
  assert.equal(store.applyClose(live, 'term-2'), null, 'a plain shell closing changes no record');
  assert.equal(store.projectRecord(live, P, 1).sessions.length, 0);
});

test('leaving the CLI for the shell drops the session (S5)', () => {
  const live = liveWith(['term-1', P]);
  store.applyReport(live, report('term-1', 'claude', S1));
  assert.equal(store.applyForeground(live, 'term-1', { processName: 'claude', shellName: 'zsh' }), null);
  assert.equal(store.applyForeground(live, 'term-1', { processName: 'zsh', shellName: 'zsh' }), P);
  assert.equal(store.projectRecord(live, P, 1).sessions.length, 0);
});

test('a claimed terminal survives its shell prompt until the agent was seen', () => {
  const live = liveWith(['term-1', P]);
  assert.equal(store.applyClaim(live, 'term-1', { tool: 'codex', sessionId: S2, transcriptPath: '/t.jsonl', name: 'Review' }), P);
  // Fresh shell before `codex resume` is typed: not an exit.
  assert.equal(store.applyForeground(live, 'term-1', { processName: 'zsh', shellName: 'zsh' }), null);
  assert.equal(store.projectRecord(live, P, 1).sessions[0].name, 'Review');
  store.applyForeground(live, 'term-1', { processName: 'codex', shellName: 'zsh' });
  assert.equal(store.applyForeground(live, 'term-1', { processName: 'zsh', shellName: 'zsh' }), P);
});

test('applyClaim refuses unknown tools and non-UUID ids', () => {
  const live = liveWith(['term-1', P]);
  assert.equal(store.applyClaim(live, 'term-1', { tool: 'gemini', sessionId: S1 }), null);
  assert.equal(store.applyClaim(live, 'term-1', { tool: 'claude', sessionId: 'x' }), null);
});

test('one active terminal per project; names follow renames', () => {
  const live = liveWith(['term-1', P], ['term-2', P], ['term-3', Q]);
  store.applyReport(live, report('term-1', 'claude', S1));
  store.applyReport(live, report('term-2', 'claude', S3));
  store.applyReport(live, report('term-3', 'claude', S2));
  store.applyMeta(live, 'term-1', { active: true });
  store.applyMeta(live, 'term-3', { active: true });
  assert.equal(store.applyMeta(live, 'term-2', { active: true, name: 'Auth work' }), P);
  const rec = store.projectRecord(live, P, 1);
  assert.equal(rec.activeSessionId, S3);
  assert.equal(rec.sessions[1].name, 'Auth work');
  assert.equal(store.projectRecord(live, Q, 1).activeSessionId, S2, 'another project keeps its own active terminal');
  assert.equal(store.applyMeta(live, 'term-2', { active: true }), null, 'no change, no write');
});

// ─── store ────────────────────────────────────────────────

test('normalizeStore tolerates missing and malformed input', () => {
  assert.deepEqual(store.normalizeStore(null), { version: 1, lastActiveProject: null, projects: {} });
  const s = store.normalizeStore({ lastActiveProject: P, projects: { [P]: { sessions: [] }, [Q]: 'junk' } });
  assert.equal(s.lastActiveProject, P);
  assert.deepEqual(Object.keys(s.projects), [P]);
});

test('putRecord removes a project with nothing to restore', () => {
  const s = store.normalizeStore({ projects: { [P]: { savedAt: 1, sessions: [{ sessionId: S1 }] } } });
  store.putRecord(s, P, { savedAt: 2, activeSessionId: null, sessions: [] });
  assert.deepEqual(s.projects, {});
});

test('putRecord prunes to the most recently saved projects', () => {
  const s = store.normalizeStore({});
  for (let i = 0; i < store.MAX_PROJECTS + 3; i++) {
    store.putRecord(s, `/p/${i}`, { savedAt: i, activeSessionId: null, sessions: [{ sessionId: S1 }] });
  }
  // The one written last is kept even though an older write had a later stamp.
  store.putRecord(s, '/p/0', { savedAt: 0, activeSessionId: null, sessions: [{ sessionId: S1 }] });
  assert.equal(Object.keys(s.projects).length, store.MAX_PROJECTS);
  assert.ok(s.projects['/p/0']);
  assert.ok(!s.projects['/p/3']);
});

// ─── restore plan ─────────────────────────────────────────

function rec(sessions, activeSessionId = null) {
  return { savedAt: 1, activeSessionId, sessions };
}

test('planRestore skips sessions whose transcript is gone (S4)', () => {
  const plan = store.planRestore(rec([
    { tool: 'claude', sessionId: S1, transcriptPath: '/gone.jsonl' },
    { tool: 'codex', sessionId: S2, transcriptPath: '/here.jsonl', name: 'Review' }
  ], S1), (p) => p === '/here.jsonl');
  assert.deepEqual(plan.sessions.map((s) => s.sessionId), [S2]);
  assert.equal(plan.sessions[0].name, 'Review');
  assert.equal(plan.activeSessionId, null, 'the active session was skipped, so nothing is focused by id');
});

test('planRestore keeps order and the active session (S1)', () => {
  const plan = store.planRestore(rec([
    { tool: 'claude', sessionId: S1, transcriptPath: '/a' },
    { tool: 'claude', sessionId: S3, transcriptPath: '/b' }
  ], S3), () => true);
  assert.deepEqual(plan.sessions.map((s) => s.sessionId), [S1, S3]);
  assert.equal(plan.activeSessionId, S3);
});

test('planRestore drops invalid and duplicate entries and caps the count', () => {
  const many = [];
  for (let i = 0; i < 12; i++) {
    many.push({ tool: 'claude', sessionId: `${String(i).padStart(8, '0')}-0000-0000-0000-000000000000`, transcriptPath: `/t${i}` });
  }
  many.unshift({ tool: 'claude', sessionId: many[0].sessionId, transcriptPath: '/dup' });
  many.unshift({ tool: 'gemini', sessionId: S1, transcriptPath: '/g' });
  many.unshift({ tool: 'claude', sessionId: 'nope', transcriptPath: '/n' });
  const plan = store.planRestore(rec(many), () => true);
  assert.equal(plan.sessions.length, store.MAX_RESTORE);
  assert.equal(new Set(plan.sessions.map((s) => s.sessionId)).size, store.MAX_RESTORE);
  assert.ok(plan.sessions.every((s) => s.tool === 'claude'));
});

test('planRestore with no record restores nothing', () => {
  assert.deepEqual(store.planRestore(undefined, () => true), { sessions: [], activeSessionId: null });
});
