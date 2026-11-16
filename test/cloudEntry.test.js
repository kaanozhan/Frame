/**
 * cloudEntry tests — what the app header's Frame Cloud entry shows for a
 * session (frame-cloud-header-entry spec).
 * Runs with Node's built-in runner: `npm test` (node --test test/).
 * Pure: no DOM, no Electron.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { entryFor } = require('../src/renderer/cloudEntry');

const SIGNED_OUT_STATES = ['signedOut', 'requestingCode', 'awaitingApproval', 'registering', 'failed'];

test('there is no entry without a server address or a session', () => {
  for (const session of [undefined, null, {}, { state: 'unavailable' }, { state: '' }]) {
    assert.equal(entryFor(session), null, JSON.stringify(session));
  }
  // Even an invite-only flag draws nothing while the address is missing.
  assert.equal(entryFor({ state: 'unavailable', inviteOnly: true }), null);
});

test('signed out on an open or unknown server reads "Frame Cloud"', () => {
  const expected = {
    kind: 'cloud',
    label: 'Frame Cloud',
    tag: null,
    initial: '',
    tooltip: 'Frame Cloud',
    call: false,
  };
  for (const extra of [{}, { inviteOnly: false }, { inviteOnly: null }, { inviteOnly: 'true' }]) {
    assert.deepEqual(entryFor({ state: 'signedOut', ...extra }), expected, JSON.stringify(extra));
  }
  // A remembered join means nothing once the server is open.
  assert.deepEqual(entryFor({ state: 'signedOut', inviteOnly: false, waitlistEmail: 'ada@example.com' }), expected);
});

test('invite-only and not on the list: the waitlist call with an Early access tag', () => {
  for (const extra of [{}, { waitlistEmail: '' }]) {
    assert.deepEqual(entryFor({ state: 'signedOut', inviteOnly: true, ...extra }), {
      kind: 'cloud',
      label: 'Join Frame Cloud waitlist',
      tag: 'Early access',
      initial: '',
      tooltip: 'Frame Cloud · Early access · Join the waitlist',
      call: true,
    });
  }
});

test('invite-only and on the list: "Frame Cloud" with an On the list tag, no call', () => {
  assert.deepEqual(entryFor({ state: 'signedOut', inviteOnly: true, waitlistEmail: 'ada@example.com' }), {
    kind: 'cloud',
    label: 'Frame Cloud',
    tag: 'On the list',
    initial: '',
    tooltip: "Frame Cloud · Early access · You're on the list",
    call: false,
  });
});

test('a machine that has signed in before: "Frame Cloud" with a Sign in tag, no waitlist call', () => {
  const expected = {
    kind: 'cloud',
    label: 'Frame Cloud',
    tag: 'Sign in',
    initial: '',
    tooltip: 'Frame Cloud · Sign in',
    call: false,
  };
  // Whatever the server says of invites, and over a waitlist address never cleared.
  const variants = [
    { inviteOnly: true },
    { inviteOnly: true, waitlistEmail: 'ada@example.com' },
    { inviteOnly: false },
    { inviteOnly: null },
    {},
  ];
  for (const extra of variants) {
    assert.deepEqual(entryFor({ state: 'signedOut', signedInBefore: true, ...extra }), expected, JSON.stringify(extra));
  }
  // A machine that never signed in keeps the plain entry on an open server.
  assert.equal(entryFor({ state: 'signedOut', inviteOnly: false }).tag, null);
  // Only `true` is the marker: anything else behaves as a machine that never signed in.
  for (const signedInBefore of [false, null, undefined, 'true', 1]) {
    const entry = entryFor({ state: 'signedOut', inviteOnly: true, signedInBefore });
    assert.equal(entry.call, true, String(signedInBefore));
    assert.equal(entry.tag, 'Early access', String(signedInBefore));
  }
});

test('the sign-in steps read exactly as signed out does', () => {
  const variants = [
    {},
    { inviteOnly: true },
    { inviteOnly: true, waitlistEmail: 'ada@example.com' },
    { inviteOnly: true, signedInBefore: true },
  ];
  for (const extra of variants) {
    const signedOut = entryFor({ state: 'signedOut', ...extra });
    for (const state of SIGNED_OUT_STATES) {
      assert.deepEqual(entryFor({ state, ...extra }), signedOut, `${state} ${JSON.stringify(extra)}`);
    }
  }
});

test('signed in without a workspace: "Frame Cloud" with a No workspace tag', () => {
  const expected = {
    kind: 'cloud',
    label: 'Frame Cloud',
    tag: 'No workspace',
    initial: '',
    tooltip: 'Frame Cloud · No workspace',
    call: false,
  };
  for (const workspace of [undefined, null, {}, { name: 'Acme' }]) {
    assert.deepEqual(entryFor({ state: 'signedIn', workspace }), expected, JSON.stringify(workspace));
  }
});

test('signed in with a workspace: its initial and name, the role in the tooltip only', () => {
  const entry = entryFor({ state: 'signedIn', workspace: { slug: 'acme', name: 'Acme', role: 'developer' } });
  assert.deepEqual(entry, {
    kind: 'workspace',
    label: 'Acme',
    tag: null,
    initial: 'A',
    tooltip: 'Frame Cloud · Acme · Developer',
    call: false,
  });
  assert.doesNotMatch(entry.label, /Developer/);
});

test('signed in ignores the early-access flags', () => {
  const entry = entryFor({
    state: 'signedIn',
    inviteOnly: true,
    waitlistEmail: 'ada@example.com',
    signedInBefore: true,
    workspace: { slug: 'acme', name: 'Acme', role: 'admin' },
  });
  assert.equal(entry.kind, 'workspace');
  assert.equal(entry.tag, null);
  assert.equal(entry.call, false);
  assert.equal(entry.tooltip, 'Frame Cloud · Acme · Admin');
});

test('a workspace without a known role names only the workspace', () => {
  for (const role of [undefined, null, '', 'owner']) {
    const entry = entryFor({ state: 'signedIn', workspace: { slug: 'acme', name: 'Acme', role } });
    assert.equal(entry.tooltip, 'Frame Cloud · Acme', String(role));
  }
});

test('a workspace without a name falls back to its slug', () => {
  const entry = entryFor({ state: 'signedIn', workspace: { slug: 'lab', role: 'viewer' } });
  assert.equal(entry.label, 'lab');
  assert.equal(entry.initial, 'L');
  assert.equal(entry.tooltip, 'Frame Cloud · lab · Viewer');
});

test('the initial is the first character by code point, upper-cased', () => {
  const initial = (name) => entryFor({ state: 'signedIn', workspace: { slug: 'x', name } }).initial;
  assert.equal(initial('élan'), 'É');
  assert.equal(initial('ölçü'), 'Ö');
  assert.equal(initial('  spaced'), 'S');
  assert.equal(initial('日本'), '日');
  // An astral character is one initial, not half a surrogate pair.
  assert.equal(initial('🚀 Launch'), '🚀');
  assert.equal(initial('42 Labs'), '4');
});

test('no label, tag or tooltip names a plan, trial, price or Pro', () => {
  const sessions = [
    { state: 'signedOut' },
    { state: 'signedOut', inviteOnly: true },
    { state: 'signedOut', inviteOnly: true, waitlistEmail: 'ada@example.com' },
    { state: 'signedOut', inviteOnly: true, signedInBefore: true },
    { state: 'signedIn' },
    { state: 'signedIn', workspace: { slug: 'acme', name: 'Acme', role: 'admin' } },
    { state: 'signedIn', workspace: { slug: 'acme', name: 'Acme', role: 'developer' } },
    { state: 'signedIn', workspace: { slug: 'acme', name: 'Acme', role: 'viewer' } },
  ];
  const strings = sessions
    .map(entryFor)
    .flatMap((e) => [e.label, e.tag, e.tooltip])
    .filter((s) => s !== null);
  assert.ok(strings.length >= sessions.length * 2);
  for (const s of strings) {
    assert.doesNotMatch(s, /\btrial\b|\bplan\b|\bPro\b|\$|€|£|\bprice\b|\bfree\b/i, s);
  }
});
