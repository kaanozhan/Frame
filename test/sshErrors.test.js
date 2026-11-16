/**
 * What an ssh failure means (server-first-connect T01). The samples are
 * OpenSSH's own stderr, with placeholder hosts.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const E = require('../src/shared/sshErrors');

const CHANGED = [
  '@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@',
  '@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @',
  '@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@',
  'IT IS POSSIBLE THAT SOMEONE IS DOING SOMETHING NASTY!',
  'Host key for example.test has changed and you have requested strict checking.',
  'Host key verification failed.'
].join('\n');

const SAMPLES = {
  'host-unknown': [
    'No ED25519 host key is known for example.test and you have requested strict checking.\r\nHost key verification failed.\r\n',
    'Host key verification failed.'
  ],
  'host-changed': [CHANGED],
  auth: [
    'me@example.test: Permission denied (publickey,password).',
    'Permission denied (publickey).'
  ],
  'no-resolve': ['ssh: Could not resolve hostname example.test: nodename nor servname provided, or not known'],
  refused: ['ssh: connect to host example.test port 22: Connection refused'],
  timeout: [
    'ssh: connect to host example.test port 22: Operation timed out',
    'ssh: connect to host example.test port 22: Connection timed out'
  ],
  unreachable: [
    'ssh: connect to host 192.0.2.1 port 22: No route to host',
    'ssh: connect to host 192.0.2.1 port 22: Network is unreachable'
  ]
};

test('T01: each ssh failure is recognised from ssh\'s own stderr', () => {
  for (const [kind, lines] of Object.entries(SAMPLES)) {
    for (const line of lines) assert.equal(E.classify(line, 255), kind, line);
  }
});

test('T01: a changed host key is never read as an unknown one', () => {
  assert.equal(E.classify(CHANGED, 255), 'host-changed');
  assert.equal(E.describe('host-changed', 'example.test').action, null, 'no step to accept it');
});

test('T01: only ssh\'s own failures (exit 255) are classified; unknown text is null', () => {
  assert.equal(E.classify('Permission denied (publickey).', 1), null, 'a remote command\'s exit code');
  assert.equal(E.classify('Host key verification failed.', 0), null);
  assert.equal(E.classify('kex_exchange_identification: Connection closed by remote host', 255), null);
  assert.equal(E.classify('', 255), null);
});

test('T01: access errors wait for the user; network errors do not', () => {
  assert.deepEqual(['host-unknown', 'host-changed', 'auth'].map(E.needsUser), [true, true, true]);
  assert.deepEqual(['no-resolve', 'refused', 'timeout', 'unreachable', null].map(E.needsUser), [false, false, false, false, false]);
});

test('T01: every kind reads as a sentence naming the host; setup only where the user can fix it', () => {
  for (const kind of Object.keys(SAMPLES)) {
    const d = E.describe(kind, 'example.test');
    assert.match(d.message, /example\.test/, kind);
    assert.equal(d.action, kind === 'host-unknown' || kind === 'auth' ? 'setup' : null, kind);
  }
  assert.deepEqual(E.describe(null, 'example.test', 'ssh example.test: kex failed'), { message: 'ssh example.test: kex failed', action: null }, 'unknown: ssh\'s own line, as before');
});

test('T01: the setup command makes a key only when none exists, then copies it; the host is quoted', () => {
  const cmd = E.setupCommand('me@example.test');
  assert.match(cmd, /ssh-copy-id 'me@example\.test'$/);
  assert.match(cmd, /\[ -f ~\/\.ssh\/id_ed25519\.pub \] \|\| \[ -f ~\/\.ssh\/id_ecdsa\.pub \] \|\| \[ -f ~\/\.ssh\/id_rsa\.pub \] \|\| ssh-keygen -t ed25519/);
  assert.equal(E.setupCommand("a'b;rm"), `{ [ -f ~/.ssh/id_ed25519.pub ] || [ -f ~/.ssh/id_ecdsa.pub ] || [ -f ~/.ssh/id_rsa.pub ] || ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519; } && ssh-copy-id 'a'\\''b;rm'`);
  // The quoted host reaches the program as one argument, unchanged.
  const echoed = execFileSync('sh', ['-c', `printf %s ${E.setupCommand("a'b;rm").split('ssh-copy-id ')[1]}`], { encoding: 'utf8' });
  assert.equal(echoed, "a'b;rm");
});
