/**
 * The rules behind tasks in server workspaces (server-tasks T01):
 * merging the Mac's and the servers' task lists, the host chip, a task's
 * home, a reorder split by home, and where Play runs a task.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/shared/serverTasks');

const mac = [
  { id: 'task-1', title: 'On the Mac', status: 'pending' },
  { id: 'task-spec-merged-T01', title: 'Merged spec task', status: 'completed' }
];
const box = {
  host: 'box', serverKey: 'kb', serverProjectPath: '/srv/app', tasksPath: '/srv/app/.frame/tasks.json', offline: false,
  tasks: [
    { id: 'task-2', title: 'On box', status: 'pending' },
    { id: 'task-spec-merged-T01', title: 'Merged spec task (server copy)', status: 'in_progress' }
  ]
};
const gpu = {
  host: 'gpu', serverKey: 'kg', serverProjectPath: '/home/me/app', tasksPath: '/home/me/app/.frame/tasks.json', offline: true,
  tasks: [{ id: 'task-3', title: 'On gpu', status: 'pending' }]
};

test('merge: Mac tasks first and untouched, then server tasks tagged with their home', () => {
  const merged = S.mergeTaskLists(mac, [box, gpu]);
  assert.deepEqual(merged.map((t) => t.id), ['task-1', 'task-spec-merged-T01', 'task-2', 'task-3']);
  assert.equal(merged[0], mac[0], 'a Mac task is the same object');
  assert.equal('location' in merged[0], false);
  assert.deepEqual(
    { location: merged[2].location, host: merged[2].host, serverKey: merged[2].serverKey, serverProjectPath: merged[2].serverProjectPath, tasksPath: merged[2].tasksPath, offline: merged[2].offline },
    { location: 'server', host: 'box', serverKey: 'kb', serverProjectPath: '/srv/app', tasksPath: '/srv/app/.frame/tasks.json', offline: false }
  );
  assert.equal(merged[3].offline, true);
  assert.equal(box.tasks[0].location, undefined, 'the input is not mutated');
});

test('merge: the Mac copy wins a duplicate id (a merged spec\'s tasks after a pull)', () => {
  const merged = S.mergeTaskLists(mac, [box]);
  const dup = merged.filter((t) => t.id === 'task-spec-merged-T01');
  assert.equal(dup.length, 1);
  assert.equal(dup[0].status, 'completed', 'the Mac record');
  assert.equal(S.isServerTask(dup[0]), false);
});

test('merge: tolerates empty and malformed input', () => {
  assert.deepEqual(S.mergeTaskLists(null, null), []);
  assert.deepEqual(S.mergeTaskLists([null], [{ host: 'x', tasks: [{ title: 'no id' }, null] }, null]), []);
});

test('chip: host, host · offline, none for a Mac task', () => {
  const merged = S.mergeTaskLists(mac, [box, gpu]);
  assert.equal(S.taskChipLabel(merged.find((t) => t.id === 'task-2')), 'box');
  assert.equal(S.taskChipLabel(merged.find((t) => t.id === 'task-3')), 'gpu · offline');
  assert.equal(S.taskChipLabel(merged[0]), null);
  assert.equal(S.taskChipLabel(null), null);
});

test('home: Mac, the right server, or null', () => {
  const merged = S.mergeTaskLists(mac, [box, gpu]);
  assert.deepEqual(S.homeOf('task-1', merged), { location: 'mac' });
  assert.deepEqual(S.homeOf('task-2', merged), { location: 'server', serverKey: 'kb', serverProjectPath: '/srv/app', host: 'box', offline: false });
  assert.equal(S.homeOf('task-3', merged).offline, true);
  assert.deepEqual(S.homeOf('task-spec-merged-T01', merged), { location: 'mac' }, 'a duplicate goes home to the Mac');
  assert.equal(S.homeOf('nope', merged), null);
  assert.equal(S.homeOf(null, merged), null);
});

test('reorder: split by home, order and status kept, unknown ids dropped', () => {
  const merged = S.mergeTaskLists(mac, [box, gpu]);
  const split = S.splitOrder([
    { id: 'task-2' }, { id: 'task-1', status: 'in_progress' }, { id: 'ghost' }, { id: 'task-3' }, { id: 'task-spec-merged-T01' }
  ], merged);
  assert.deepEqual(split.mac, [{ id: 'task-1', status: 'in_progress' }, { id: 'task-spec-merged-T01' }]);
  assert.deepEqual(split.servers.map((s) => [s.serverKey, s.serverProjectPath, s.order.map((e) => e.id)]), [
    ['kb', '/srv/app', ['task-2']],
    ['kg', '/home/me/app', ['task-3']]
  ]);
  assert.equal(split.servers[1].offline, true);
});

test('Play: a Mac task runs in the selected local checkout, or the main checkout with a note while a server workspace is selected', () => {
  const merged = S.mergeTaskLists(mac, [box]);
  const macTask = merged[0];
  assert.deepEqual(S.runTarget(macTask, null, []), { workspaceId: 'main' });
  assert.deepEqual(S.runTarget(macTask, { id: 'main' }, []), { workspaceId: 'main' });
  assert.deepEqual(S.runTarget(macTask, { id: 'w1', location: 'local' }, []), { workspaceId: 'w1' });
  assert.deepEqual(S.runTarget(macTask, { id: 'sw', location: 'server', serverKey: 'kb', serverProjectPath: '/srv/app' }, []),
    { workspaceId: 'main', note: 'mac-task-on-server' });
});

test('Play: a server task runs in the selected workspace when it is on that server and project, otherwise the user chooses', () => {
  const merged = S.mergeTaskLists(mac, [box, gpu]);
  const onBox = merged.find((t) => t.id === 'task-2');
  const wsBox = [
    { id: 'b1', name: 'teal', serverKey: 'kb', serverProjectPath: '/srv/app' },
    { id: 'b2', name: 'jade', serverKey: 'kb', serverProjectPath: '/srv/app', offline: true },
    { id: 'b3', name: 'other project', serverKey: 'kb', serverProjectPath: '/srv/other' },
    { id: 'g1', name: 'on gpu', serverKey: 'kg', serverProjectPath: '/srv/app' }
  ];
  assert.deepEqual(S.runTarget(onBox, { id: 'b1', location: 'server', serverKey: 'kb', serverProjectPath: '/srv/app' }, wsBox), { workspaceId: 'b1' });
  assert.deepEqual(S.runTarget(onBox, { id: 'w1', location: 'local' }, wsBox), { choose: [wsBox[0]] }, 'only live workspaces of that server and project');
  assert.deepEqual(S.runTarget(onBox, { id: 'g1', location: 'server', serverKey: 'kg', serverProjectPath: '/srv/app' }, wsBox), { choose: [wsBox[0]] }, 'another server is not its home');
  assert.deepEqual(S.runTarget(onBox, null, []), { error: 'no-workspace' });
  assert.deepEqual(S.runTarget(merged.find((t) => t.id === 'task-3'), null, wsBox), { error: 'offline' });
});

test('the Run dialog\'s note: why a task runs where it runs, and when it cannot', () => {
  const task = { id: 't', location: 'server', host: 'box' };
  assert.deepEqual(S.runTargetNote({ error: 'offline' }, task, null), { text: 'box is offline — reconnect to run this task.', blocking: true });
  assert.deepEqual(S.runTargetNote({ error: 'no-workspace' }, task, null), { text: 'box has no workspace of this project — create one there to run this task.', blocking: true });
  assert.deepEqual(S.runTargetNote({ choose: [{ id: 'b1' }] }, task, null), { text: 'This task lives on box. Pick its workspace there to run it in.', blocking: false });
  assert.deepEqual(S.runTargetNote({ workspaceId: 'main', note: 'mac-task-on-server' }, { id: 'm' }, { id: 'sw', host: 'gpu' }),
    { text: 'This task lives on this Mac, so it runs in the main checkout — an agent on gpu could not update this Mac\'s task list.', blocking: false });
  assert.equal(S.runTargetNote({ workspaceId: 'w1' }, { id: 'm' }, null), null, 'runs where the user is: nothing to say');
  assert.equal(S.runTargetNote(null, task, null), null);
});
