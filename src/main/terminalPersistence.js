/**
 * Terminal Persistence Module
 * Persists terminal session metadata to disk so they can be restored on app restart
 */

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

function getStoragePath() {
  return path.join(app.getPath('userData'), 'terminal-sessions.json');
}

/**
 * Load all persisted terminal sessions
 * @returns {Object} Map of terminalId -> { sessionName, cwd, projectPath, customName }
 */
function load() {
  try {
    const filePath = getStoragePath();
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[terminalPersistence] Failed to load sessions:', err);
    return {};
  }
}

/**
 * Persist all terminal sessions to disk
 * @param {Object} sessions - Map of terminalId -> session data
 */
function save(sessions) {
  try {
    fs.writeFileSync(getStoragePath(), JSON.stringify(sessions, null, 2), 'utf8');
  } catch (err) {
    console.error('[terminalPersistence] Failed to save sessions:', err);
  }
}

/**
 * Add or update a terminal session entry
 * @param {string} terminalId
 * @param {{ sessionName: string, cwd: string, projectPath: string|null, customName: string|null }} data
 */
function add(terminalId, data) {
  const sessions = load();
  save({ ...sessions, [terminalId]: data });
}

/**
 * Remove a terminal session entry
 * @param {string} terminalId
 */
function remove(terminalId) {
  const sessions = load();
  const { [terminalId]: _removed, ...rest } = sessions;
  save(rest);
}

/**
 * Update a specific field of a terminal session
 * @param {string} terminalId
 * @param {Object} patch
 */
function update(terminalId, patch) {
  const sessions = load();
  if (!sessions[terminalId]) return;
  save({ ...sessions, [terminalId]: { ...sessions[terminalId], ...patch } });
}

module.exports = { load, save, add, remove, update };
