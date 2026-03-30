/**
 * Tmux Manager Module
 * Low-level tmux session operations for terminal persistence
 */

const { execFileSync } = require('child_process');
const fs = require('fs');

const FRAME_SESSION_PREFIX = 'frame-';

let tmuxPath = null;

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
 * @param {string[]} args
 * @returns {string}
 */
function exec(args) {
  const bin = findTmux();
  if (!bin) throw new Error('tmux not found on this system');
  return execFileSync(bin, args, { encoding: 'utf8' });
}

/**
 * Create a new detached tmux session
 * @param {string} sessionName
 * @param {string} cwd - Working directory
 */
function createSession(sessionName, cwd) {
  exec(['new-session', '-d', '-s', sessionName, '-c', cwd]);
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
  createSession,
  sessionExists,
  killSession,
  listFrameSessions,
  sessionNameFor
};
