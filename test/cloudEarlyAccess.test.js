/**
 * cloudEarlyAccess tests — the Frame Cloud window's words while the server is
 * invite-only.
 * Runs with Node's built-in runner: `npm test` (node --test test/).
 * Pure: no DOM, no Electron.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const early = require('../src/renderer/cloudEarlyAccess');

test('paneMode keeps today\'s pane unless the server said it is invite-only', () => {
  for (const state of [undefined, null, {}, { inviteOnly: false }, { inviteOnly: null }, { inviteOnly: 'true' }]) {
    assert.equal(early.paneMode(state), 'classic', JSON.stringify(state));
  }
  assert.equal(early.paneMode({ inviteOnly: false, waitlistEmail: 'ada@example.com' }), 'classic');
});

test('paneMode shows the form until this machine has joined, then the card', () => {
  assert.equal(early.paneMode({ inviteOnly: true }), 'form');
  assert.equal(early.paneMode({ inviteOnly: true, waitlistEmail: '' }), 'form');
  assert.equal(early.paneMode({ inviteOnly: true, waitlistEmail: 'ada@example.com' }), 'joined');
});

test('paneMode is the sign-in pane once this machine has signed in before', () => {
  assert.equal(early.paneMode({ inviteOnly: true, signedInBefore: true }), 'classic');
  // The marker wins over a waitlist address that was never cleared.
  assert.equal(early.paneMode({ inviteOnly: true, signedInBefore: true, waitlistEmail: 'ada@example.com' }), 'classic');
  assert.equal(early.paneMode({ inviteOnly: false, signedInBefore: true }), 'classic');
  // Only `true` is the marker.
  for (const signedInBefore of [false, null, undefined, 'true', 1]) {
    assert.equal(early.paneMode({ inviteOnly: true, signedInBefore }), 'form', String(signedInBefore));
    assert.equal(
      early.paneMode({ inviteOnly: true, signedInBefore, waitlistEmail: 'ada@example.com' }),
      'joined',
      String(signedInBefore)
    );
  }
});

test('joinFailure explains each reason and offers frame.cool when joining here cannot work', () => {
  assert.deepEqual(early.joinFailure('invalid'), {
    message: 'Enter a full email address, like ada@example.com.',
    showFallback: false,
  });
  for (const reason of ['rateLimited', 'network', 'unavailable', 'anything-else', undefined]) {
    const f = early.joinFailure(reason);
    assert.equal(f.showFallback, true, String(reason));
    assert.ok(f.message.length > 0);
  }
  assert.equal(early.joinFailure('unavailable').message, early.joinFailure('network').message);
});

test('joinedBody names the address', () => {
  assert.equal(early.joinedBody('ada@example.com'), "We'll email ada@example.com when your invite is ready.");
});

test('the sign-in words match the web and the waitlist link is frame.cool\'s', () => {
  assert.equal(early.COPY.signIn, 'Continue with GitHub');
  assert.equal(early.WAITLIST_URL, 'https://frame.cool/early-access');
  assert.match(early.COPY.awaitingHint, /Open browser again/);
});

test('no string names a plan, trial, price or Pro', () => {
  const strings = [
    ...Object.values(early.COPY),
    early.joinedBody('ada@example.com'),
    ...['invalid', 'rateLimited', 'network'].map((r) => early.joinFailure(r).message),
  ];
  for (const s of strings) {
    assert.doesNotMatch(s, /\btrial\b|\bplan\b|\bPro\b|\$|€|£|\bprice\b/i, s);
  }
});
