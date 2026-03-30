/**
 * Tmux Manager Module
 * Low-level tmux session operations for terminal persistence
 */

const { execFileSync } = require('child_process');
const fs = require('fs');

const FRAME_SESSION_PREFIX = 'frame-';

let tmuxPath = null;

/**
 * Detect the system UTF-8 locale.
 * When Frame is launched from /Applications (not a terminal), Electron inherits
 * a minimal environment where LANG may be unset or "C". We query macOS directly.
 * @returns {string} e.g. "fr_FR.UTF-8"
 */
function detectUtf8Lang() {
  // 1. Trust process.env if it already points to a UTF-8 locale
  for (const key of ['LANG', 'LC_ALL', 'LC_CTYPE']) {
    const val = process.env[key] || '';
    if (val && val.toLowerCase().includes('utf')) return val;
  }

  // 2. macOS: derive from AppleLocale (works even in packaged apps)
  if (process.platform === 'darwin') {
    try {
      const locale = execFileSync('defaults', ['read', '-g', 'AppleLocale'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();
      if (locale) return `${locale}.UTF-8`;
    } catch {}
  }

  // 3. Try the `locale` command
  try {
    const out = execFileSync('locale', { encoding: 'utf8' });
    const m = out.match(/LANG="?([^"\n]+)"?/);
    if (m && m[1] && m[1] !== 'C' && m[1] !== 'POSIX') return m[1];
  } catch {}

  // 4. Safe fallback
  return 'UTF-8';
}

/**
 * Return env vars that guarantee UTF-8 in tmux and the shell it spawns.
 * Always returns an explicit LANG and LC_ALL — never an empty object —
 * so callers can spread it into any env without guessing.
 * @returns {{ LANG: string, LC_ALL: string }}
 */
function utf8Env() {
  const lang = detectUtf8Lang();
  return { LANG: lang, LC_ALL: lang };
}

/**
 * Find tmux binary path
 * @returns {string|null}
 */
function findTmux() {
  if (tmuxPath) return tmuxPath;

  const candidates = [
    '/opt/homebrew/bin/tmux',
    '/usr/local/bin/tmux',
    '/usr/bin/tmux'
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      tmuxPath = p;
      return p;
    }
  }

  try {
    const result = execFileSync('which', ['tmux'], { encoding: 'utf8' }).trim();
    if (result) {
      tmuxPath = result;
      return result;
    }
  } catch {}

  return null;
}

/**
 * Check if tmux is available on this system
 * @returns {boolean}
 */
function isTmuxAvailable() {
  return findTmux() !== null;
}

/**
 * Execute a tmux command
 * Always passes -u to enable UTF-8 mode
 * @param {string[]} args
 * @returns {string}
 */
function exec(args) {
  const bin = findTmux();
  if (!bin) throw new Error('tmux not found on this system');
  return execFileSync(bin, ['-u', ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...utf8Env() }
  });
}

/**
 * Create a new detached tmux session
 * @param {string} sessionName
 * @param {string} cwd - Working directory
 */
function createSession(sessionName, cwd) {
  const { LANG } = utf8Env();
  // -e passes env vars into the shell spawned inside the tmux session
  exec(['new-session', '-d', '-s', sessionName, '-c', cwd, '-e', `LANG=${LANG}`, '-e', `LC_ALL=${LANG}`]);
}

/**
 * Check if a tmux session exists
 * @param {string} sessionName
 * @returns {boolean}
 */
function sessionExists(sessionName) {
  try {
    exec(['has-session', '-t', sessionName]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill a tmux session
 * @param {string} sessionName
 */
function killSession(sessionName) {
  try {
    exec(['kill-session', '-t', sessionName]);
  } catch (err) {
    console.warn(`[tmuxManager] Could not kill session ${sessionName}:`, err.message);
  }
}

/**
 * List all active Frame tmux sessions
 * @returns {string[]} Session names prefixed with FRAME_SESSION_PREFIX
 */
function listFrameSessions() {
  try {
    const output = exec(['list-sessions', '-F', '#{session_name}']);
    return output
      .trim()
      .split('\n')
      .filter(name => name.startsWith(FRAME_SESSION_PREFIX));
  } catch {
    return [];
  }
}

/**
 * Build a session name from a terminal ID
 * @param {string} terminalId
 * @returns {string}
 */
function sessionNameFor(terminalId) {
  return `${FRAME_SESSION_PREFIX}${terminalId}`;
}

module.exports = {
  findTmux,
  isTmuxAvailable,
  utf8Env,
  createSession,
  sessionExists,
  killSession,
  listFrameSessions,
  sessionNameFor
};
