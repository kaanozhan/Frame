/**
 * cloudConnectionCopy tests — the words Frame says about a device's Frame
 * Cloud connection (frame-cloud-teammate-connection).
 * Runs with Node's built-in runner: `npm test`.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const copy = require('../src/renderer/cloudConnectionCopy');
const { ROLE_FORBIDDEN } = require('../src/renderer/cloudRoles');

const A = { id: 'p1', slug: 'app', name: 'App' };

test('statusChip: one chip per row state, Connected green and Ready blue', () => {
  assert.deepEqual(copy.statusChip('connected'), { label: 'Connected', className: 'cloud-chip-connected' });
  assert.deepEqual(copy.statusChip('ready'), { label: 'Ready to connect', className: 'cloud-chip-ready' });
  assert.deepEqual(copy.statusChip('notConnected'), { label: 'Not connected', className: '' });
  assert.deepEqual(copy.statusChip('notClaimed'), { label: 'Not claimed', className: '' });
  assert.equal(copy.statusChip('linked').label, 'Not connected', 'an unknown state reads Not connected');
});

test('no chip says Linked: the identity is never a state on screen', () => {
  for (const chip of Object.values(copy.STATUS_CHIPS)) assert.doesNotMatch(chip.label, /link/i);
});

test('CLAIM_LINE says claiming picks the folder, and that clones then connect with one click', () => {
  assert.match(copy.CLAIM_LINE, /^Claiming picks the folder that is this project\./);
  assert.match(copy.CLAIM_LINE, /every member's clone/);
  assert.match(copy.CLAIM_LINE, /one click/);
});

test('notHereNote: a claimed project asks for a clone and Connect, never a Connect step in On this device', () => {
  const note = copy.notHereNote('notConnected');
  assert.match(note, /clone of its repository/);
  assert.match(note, /"Add a project…"/);
  assert.match(note, /click Connect\.$/);
  assert.doesNotMatch(note, /On this device/);
});

test('notHereNote: a connected device with no folder here can re-add one or disconnect', () => {
  const note = copy.notHereNote('connected');
  assert.match(note, /This device is connected/);
  assert.match(note, /opens connected/);
  assert.match(note, /disconnect this device/);
});

test('notHereNote: an unclaimed project is chosen with Connect a folder…', () => {
  assert.match(copy.notHereNote('notClaimed'), /Connect a folder…/);
  assert.equal(copy.notHereNote('something'), copy.notHereNote('notConnected'));
});

test('disconnectQuestion names the project, says Briefs leave this device, and who stays connected', () => {
  const q = copy.disconnectQuestion(A);
  assert.match(q, /^Disconnect this device from App\?/);
  assert.match(q, /Briefs stop showing here\./);
  assert.match(q, /Your teammates and your other devices stay connected/);
  assert.match(q, /the folder stays as it is\./);
  const away = copy.disconnectQuestion(A, { folderHere: false });
  assert.doesNotMatch(away, /folder/);
  assert.match(copy.disconnectQuestion({ slug: 'app' }), /from app\?/);
  assert.match(copy.disconnectQuestion(null), /from this project\?/);
});

test('connectRefusal: a stale list says it was refreshed; sign-out says nothing', () => {
  assert.match(copy.connectRefusal('unlinked'), /no longer claimed — the list was refreshed\./);
  assert.match(copy.connectRefusal('identityChanged'), /another folder — the list was refreshed\./);
  assert.match(copy.connectRefusal('notFound'), /no longer exists/);
  assert.equal(copy.connectRefusal('roleForbidden'), ROLE_FORBIDDEN);
  assert.equal(copy.connectRefusal('unauthorized'), null);
  assert.equal(copy.connectRefusal('other'), "Couldn't connect this device. Try again.");
});

test('disconnectRefusal: network and the fallback name this device', () => {
  assert.equal(copy.disconnectRefusal('network'), "Frame Cloud couldn't be reached.");
  assert.equal(copy.disconnectRefusal('other'), "Couldn't disconnect this device. Try again.");
  assert.equal(copy.disconnectRefusal('unauthorized'), null);
});

test('CONNECTED_EXPLANATION: per device, per member, briefs through Frame Cloud, code with git', () => {
  const e = copy.CONNECTED_EXPLANATION;
  assert.match(e, /^Connected on this device\./);
  assert.match(e, /Each member connects on each of their own devices\./);
  assert.match(e, /Briefs and their progress go through Frame Cloud/);
  assert.match(e, /code, specs and tasks move with git\./);
});

test('readyLead names the project and says connecting changes no one else', () => {
  const lead = copy.readyLead(A);
  assert.match(lead, /^This folder is App's repository\./);
  assert.match(lead, /Connect this device/);
  assert.match(lead, /nobody else's connection changes\./);
});

test('TAKEOVER_QUESTION says every device of the project, teammates included, is disconnected', () => {
  assert.match(copy.TAKEOVER_QUESTION, /Connect this folder instead\?/);
  assert.match(copy.TAKEOVER_QUESTION, /Every device connected to the project, teammates' included, will be disconnected\./);
  assert.doesNotMatch(copy.TAKEOVER_QUESTION, /other folder will read/);
});

test('CLAIMED_ELSEWHERE does not call an identity Connected', () => {
  assert.equal(copy.CLAIMED_ELSEWHERE.chip, 'Claimed');
  assert.doesNotMatch(copy.CLAIMED_ELSEWHERE.chip, /connected/i);
  assert.match(copy.CLAIMED_ELSEWHERE.note, /takes it over and disconnects every device/);
});

test('settingsRow: connected names the project and workspace, then explains the connection', () => {
  const row = copy.settingsRow('connected', A, { name: 'Acme', slug: 'acme' });
  assert.equal(row.label, 'Connected to App');
  assert.equal(row.description, `In Acme. ${copy.CONNECTED_EXPLANATION}`);
  assert.match(copy.settingsRow('connected', A, null).description, /^In Frame Cloud\./);
});

test('settingsRow: confirmDisconnect asks about this device only', () => {
  const row = copy.settingsRow('confirmDisconnect', A, { name: 'Acme' });
  assert.equal(row.label, 'Connected to App');
  assert.equal(row.description, copy.disconnectQuestion(A));
});

test('settingsRow: ready reads Ready to connect with the Ready lead', () => {
  const row = copy.settingsRow('ready', A, { slug: 'acme' });
  assert.equal(row.label, 'Ready to connect');
  assert.equal(row.description, `In acme. ${copy.readyLead(A)}`);
});

test('settingsRow: anything else reads Not connected, offering connect or create', () => {
  assert.deepEqual(copy.settingsRow('notConnected'), {
    label: 'Not connected',
    description: 'Connect this project to a Frame Cloud project, or create one for it.',
  });
  assert.equal(copy.settingsRow(undefined).label, 'Not connected');
});
