/**
 * Other projects' agents — the status bar slot's grouping and face
 * (workspace-list-agent-alerts spec, T09).
 *
 * Pinned: this project is left out; plain shells are not agents; agents
 * group by project, then workspace (main first); an unnamed workspace is
 * labelled by its id; projects with something waiting come first; the face
 * reads `Other projects · 3 agents · 1 waiting`.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { group, slotFace } = require('../src/renderer/workspaces/otherProjects');

const HERE = '/work/app';
const API = '/work/api';
const DOCS = '/work/docs';
const statuses = {
  a1: { status: 'agent-working', agentName: 'claude' },
  a2: { status: 'agent-approval', agentName: 'codex' },
  a3: { status: 'agent-input', agentName: 'claude' },
  a4: { status: 'idle', agentName: null },
  d1: { status: 'agent-working', agentName: 'claude' },
  d2: { status: 'agent-working', agentName: 'claude' },
  d3: { status: 'agent-working', agentName: 'claude' },
  h1: { status: 'agent-approval', agentName: 'claude' }
};
const getStatus = (id) => statuses[id] || null;
const states = [
  { id: 'h1', projectPath: HERE, name: '1st Terminal' },
  { id: 'd1', projectPath: DOCS, name: '1st Terminal' },
  { id: 'd2', projectPath: DOCS, name: '2nd Terminal' },
  { id: 'd3', projectPath: DOCS, workspaceId: 'w9', name: '1st Terminal' },
  { id: 'a2', projectPath: API, workspaceId: 'w1', name: '1st Terminal', customName: 'migrations' },
  { id: 'a1', projectPath: API, name: '1st Terminal' },
  { id: 'a3', projectPath: API, workspaceId: 'w1', name: '2nd Terminal' },
  { id: 'a4', projectPath: API, name: '2nd Terminal' },
  { id: 'x1', name: 'unscoped' }
];
const counts = new Map([[API, { approval: 1, input: 1 }], [HERE, { approval: 1, input: 0 }]]);

test('group: by project, then workspace; this project and plain shells are left out', () => {
  const projects = group(states, { currentProject: HERE, counts, getStatus });
  assert.deepEqual(projects.map((p) => p.path), [API, DOCS], 'the project with something waiting comes first');

  const api = projects[0];
  assert.deepEqual({ name: api.name, approval: api.approval, input: api.input, agentCount: api.agentCount },
    { name: 'api', approval: 1, input: 1, agentCount: 3 });
  assert.deepEqual(api.workspaces.map((w) => w.id), ['main', 'w1'], 'main first, whatever came first');
  assert.deepEqual(api.workspaces[1].agents, [
    { id: 'a2', agentName: 'codex', status: 'agent-approval', terminalName: 'migrations' },
    { id: 'a3', agentName: 'claude', status: 'agent-input', terminalName: '2nd Terminal' }
  ]);
  assert.deepEqual(api.workspaces[0].agents.map((a) => a.id), ['a1'], 'the idle shell a4 is not an agent');

  const docs = projects[1];
  assert.deepEqual({ approval: docs.approval, input: docs.input, agentCount: docs.agentCount }, { approval: 0, input: 0, agentCount: 3 });
  assert.deepEqual(docs.workspaces.map((w) => [w.id, w.agents.length]), [['main', 2], ['w9', 1]]);
});

test('group: an unnamed workspace is labelled by its id, a known one by its name', () => {
  const bare = group(states, { currentProject: HERE, counts, getStatus });
  assert.deepEqual(bare[0].workspaces.map((w) => w.label), ['main', 'w1']);

  const names = new Map([[API, new Map([['w1', 'ws/teal'], ['main', 'develop']])]]);
  const named = group(states, { currentProject: HERE, counts, getStatus, names });
  assert.deepEqual(named[0].workspaces.map((w) => w.label), ['develop', 'ws/teal']);
  assert.deepEqual(named[1].workspaces.map((w) => w.label), ['main', 'w9'], 'a project with no names read keeps ids');
});

test('group: with nothing waiting, the project running more agents comes first; empty input is empty', () => {
  const quiet = group(states, { currentProject: HERE, counts: new Map(), getStatus });
  assert.deepEqual(quiet.map((p) => [p.name, p.agentCount]), [['docs', 3], ['api', 3]], 'a tie keeps the order the projects were first seen in');
  const fewer = group(states.filter((s) => s.id !== 'a3'), { currentProject: HERE, getStatus });
  assert.deepEqual(fewer.map((p) => p.name), ['docs', 'api']);
  assert.deepEqual(group(null, { currentProject: HERE, getStatus }), []);
  assert.deepEqual(group(states, { currentProject: HERE }), [], 'no status lookup: no agent can be told');
  assert.deepEqual(group(states.filter((s) => s.projectPath === HERE), { currentProject: HERE, counts, getStatus }), []);
});

test('slotFace: names the scope, counts the agents, and says how many wait', () => {
  assert.equal(slotFace(3, 1), 'Other projects · 3 agents · 1 waiting');
  assert.equal(slotFace(3, 0), 'Other projects · 3 agents');
  assert.equal(slotFace(1, 0), 'Other projects · 1 agent');
  assert.equal(slotFace(12, 4), 'Other projects · 12 agents · 4 waiting');
});
