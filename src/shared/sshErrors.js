/**
 * sshErrors — what an ssh failure means, in words a first-time user can act
 * on (server-first-connect).
 *
 * Frame reaches a server with the user's own `ssh` in BatchMode, so ssh can
 * never ask anything: a host key it has not seen, or a server that wants a
 * password, ends the connection with a terse last line. This module turns
 * ssh's stderr into a kind, a sentence and — where the user can fix it — the
 * one step that does: a terminal on this Mac with the setup command typed in,
 * where ssh itself shows the fingerprint and asks for the password. Frame
 * never sees either.
 *
 * Pure: stderr and exit code in, kind / sentence / command out.
 */

// ssh exits 255 when ssh itself failed; any other code is the remote
// command's own, and must never be read as an ssh error.
const SSH_FAILED = 255;

// Order matters: a changed host key also ends in "Host key verification
// failed", and must never be offered the "accept the key" step.
const RULES = [
  ['host-changed', /REMOTE HOST IDENTIFICATION HAS CHANGED/i],
  ['host-unknown', /Host key verification failed|No \S+ host key is known for/i],
  ['auth', /Permission denied \(/i],
  ['no-resolve', /Could not resolve hostname/i],
  ['refused', /Connection refused/i],
  ['timeout', /timed out/i],
  ['unreachable', /No route to host|Network is unreachable/i]
];

/** The kind of an ssh failure, or null (not ssh's own failure, or not one we know). */
function classify(stderr, code) {
  if (Number(code) !== SSH_FAILED) return null;
  const text = String(stderr || '');
  for (const [kind, re] of RULES) {
    if (re.test(text)) return kind;
  }
  return null;
}

/** Kinds only the user can fix: retrying them changes nothing. */
function needsUser(kind) {
  return kind === 'host-unknown' || kind === 'host-changed' || kind === 'auth';
}

/**
 * `{ message, action }` for the dialog. `action` is 'setup' (open a terminal
 * with `setupCommand`) or null. An unknown kind gives `fallback` (ssh's own
 * last line), as before this module.
 */
function describe(kind, host, fallback = '') {
  const h = String(host || 'The server');
  switch (kind) {
    case 'host-unknown':
      return { message: `${h} is new to this Mac: ssh has not accepted its host key yet. Set up access in a terminal — ssh shows the server's fingerprint and asks you to confirm it.`, action: 'setup' };
    case 'host-changed':
      return { message: `${h}'s host key has changed since this Mac last connected. That happens when a server is reinstalled — or when someone is in the middle. Check with whoever runs the server; Frame will not accept the new key.`, action: null };
    case 'auth':
      return { message: `${h} did not accept an SSH key from this Mac. Frame signs in with keys only — set up access in a terminal: it copies your key to the server and asks for the password once.`, action: 'setup' };
    case 'no-resolve':
      return { message: `${h} could not be found — check the name, or its Host entry in ~/.ssh/config.`, action: null };
    case 'refused':
      return { message: `${h} refused the connection — sshd may not be running there, or it listens on another port.`, action: null };
    case 'timeout':
      return { message: `${h} did not answer in time — check the address, the network or a firewall.`, action: null };
    case 'unreachable':
      return { message: `${h} cannot be reached from this network.`, action: null };
    default:
      return { message: String(fallback || ''), action: null };
  }
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/**
 * The line typed (never run) in a terminal on this Mac: create a key when
 * this Mac has none, then copy it to the server. ssh-copy-id asks to confirm
 * a new host's fingerprint and for the password itself. Works in zsh and bash.
 */
function setupCommand(host) {
  const noKey = '[ -f ~/.ssh/id_ed25519.pub ] || [ -f ~/.ssh/id_ecdsa.pub ] || [ -f ~/.ssh/id_rsa.pub ]';
  return `{ ${noKey} || ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519; } && ssh-copy-id ${shellQuote(host)}`;
}

module.exports = { classify, needsUser, describe, setupCommand, SSH_FAILED };
