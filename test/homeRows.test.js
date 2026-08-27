/**
 * Home's two row builders — the only real logic in the widget board.
 *
 * Both modules are pure by design (C8): CI runs `npm test` with no
 * `npm ci`, so nothing here may reach `electron`, `lucide` or `laneStatus`.
 * Requiring them at the top of this file is itself half the test — if either
 * grows a dependency on the renderer, this suite stops loading.
 *
 * What is covered is what a reader would get wrong twice: which lanes count
 * as agents, and which one you should look at first.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { agentRows } = require('../src/renderer/home/agentRows');

// ─── helpers ──────────────────────────────────────────────

function lane(id, status, extra = {}) {
  return {
    terminal: { id, name: id, ...(extra.terminal || {}) },
    status: {
      status,
      agentName: extra.agentName || null,
      lastActivityAt: extra.lastActivityAt || null
    }
  };
}

// ─── agentRows ────────────────────────────────────────────

test('empty in, empty out', () => {
  assert.deepEqual(agentRows([]), []);
  assert.deepEqual(agentRows(null), []);
  assert.deepEqual(agentRows(undefined), []);
});

test('shell lanes are excluded — the widget is called Agents', () => {
  const rows = agentRows([
    lane('idle-one', 'idle'),
    lane('running-one', 'running'),
    lane('agent-one', 'agent-working')
  ]);

  assert.deepEqual(rows.map(r => r.id), ['agent-one']);
});

test('the three agent statuses are kept', () => {
  const rows = agentRows([
    lane('a', 'agent-working'),
    lane('b', 'agent-approval'),
    lane('c', 'agent-input')
  ]);

  assert.equal(rows.length, 3);
  assert.deepEqual(new Set(rows.map(r => r.status)),
    new Set(['agent-working', 'agent-approval', 'agent-input']));
});

test('order is approval, then input, then working', () => {
  // Deliberately fed in the reverse of the expected order, so a no-op sort
  // cannot pass this.
  const rows = agentRows([
    lane('working', 'agent-working'),
    lane('input', 'agent-input'),
    lane('approval', 'agent-approval')
  ]);

  assert.deepEqual(rows.map(r => r.id), ['approval', 'input', 'working']);
});

test('within one status the most recent activity leads, and a silent lane sorts last', () => {
  const rows = agentRows([
    lane('quiet', 'agent-working', { lastActivityAt: '2026-08-27T09:00:00.000Z' }),
    lane('never', 'agent-working'),
    lane('recent', 'agent-working', { lastActivityAt: '2026-08-27T11:30:00.000Z' })
  ]);

  assert.deepEqual(rows.map(r => r.id), ['recent', 'quiet', 'never']);
});

test('a row carries what the widget draws, and nothing it has to look up', () => {
  const [row] = agentRows([
    lane('t1', 'agent-approval', {
      agentName: 'claude',
      lastActivityAt: '2026-08-27T10:00:00.000Z',
      terminal: { customName: 'Refactor', assignment: { kind: 'spec', ref: 'home-widget-board' } }
    })
  ]);

  assert.deepEqual(row, {
    id: 't1',
    // customName wins over the generated name, as everywhere else in Frame.
    name: 'Refactor',
    status: 'agent-approval',
    agentName: 'claude',
    lastActivityAt: '2026-08-27T10:00:00.000Z',
    assignment: { kind: 'spec', ref: 'home-widget-board' }
  });
});

test('a lane with no status object is not an agent', () => {
  assert.deepEqual(agentRows([{ terminal: { id: 'x' } }, null, {}]), []);
});

// ─── sessionRows ──────────────────────────────────────────

const { sessionRows, relativeTime } = require('../src/renderer/home/sessionRows');

// Pinned so the relative times are assertions, not a race with the clock.
const NOW = Date.parse('2026-08-27T12:00:00.000Z');

function session(id, modified, extra = {}) {
  return { sessionId: id, modified, messageCount: 4, ...extra };
}

test('no sessions, no rows', () => {
  assert.deepEqual(sessionRows([], NOW), []);
  assert.deepEqual(sessionRows(null, NOW), []);
});

test('at most three, newest first', () => {
  const rows = sessionRows([
    session('older', '2026-08-25T12:00:00.000Z'),
    session('newest', '2026-08-27T11:00:00.000Z'),
    session('oldest', '2026-08-20T12:00:00.000Z'),
    session('middle', '2026-08-26T12:00:00.000Z')
  ], NOW);

  assert.deepEqual(rows.map(r => r.id), ['newest', 'middle', 'older']);
});

test('the panel fallback chain: summary, then first prompt, then a placeholder', () => {
  const [withSummary, withPrompt, withNeither] = sessionRows([
    session('a', '2026-08-27T11:00:00.000Z', { summary: 'Refactor Home', firstPrompt: 'ignored' }),
    session('b', '2026-08-27T10:00:00.000Z', { firstPrompt: 'make the board a dashboard' }),
    session('c', '2026-08-27T09:00:00.000Z')
  ], NOW);

  assert.equal(withSummary.title, 'Refactor Home');
  assert.equal(withPrompt.title, 'make the board a dashboard');
  assert.equal(withNeither.title, 'Untitled session');
});

test('a row carries the fields the widget draws', () => {
  const [row] = sessionRows([
    session('s1', '2026-08-27T10:00:00.000Z', { summary: 'Widget board', gitBranch: 'feat/home', messageCount: 42 })
  ], NOW);

  assert.deepEqual(row, {
    id: 's1',
    title: 'Widget board',
    at: '2026-08-27T10:00:00.000Z',
    relative: '2 hours ago',
    messageCount: 42,
    branch: 'feat/home'
  });
});

test('a session with no id is not a session', () => {
  assert.deepEqual(sessionRows([{ modified: '2026-08-27T10:00:00.000Z' }, null], NOW), []);
});

test('relative time falls back to created when the transcript carries no last record', () => {
  const [row] = sessionRows([
    { sessionId: 'c1', created: '2026-08-26T12:00:00.000Z', messageCount: 1 }
  ], NOW);

  assert.equal(row.at, '2026-08-26T12:00:00.000Z');
  assert.equal(row.relative, 'yesterday');
});

test('relativeTime is honest about nothing and about garbage', () => {
  assert.equal(relativeTime(null, NOW), '');
  assert.equal(relativeTime('not a date', NOW), '');
  assert.equal(relativeTime('2026-08-27T11:59:30.000Z', NOW), 'just now');
  assert.equal(relativeTime('2026-08-27T11:00:00.000Z', NOW), '1 hour ago');
  assert.equal(relativeTime('2026-08-24T12:00:00.000Z', NOW), '3 days ago');
  assert.equal(relativeTime('2026-08-13T12:00:00.000Z', NOW), '2 weeks ago');
});
