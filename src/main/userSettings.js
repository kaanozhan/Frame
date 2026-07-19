/**
 * User Settings
 *
 * Generic key-value store for renderer-side user preferences that need to
 * persist across launches. Backed by user-settings.json under the app's
 * userData directory.
 *
 * Used instead of localStorage because Electron's renderer localStorage
 * has been observed to lose state across launches in dev mode (likely
 * tied to userData path resolution timing). This main-process JSON is
 * the same pattern aiToolManager / workspace already use.
 */

const path = require('path');
const { app } = require('electron');
const fsSafe = require('./fsSafe');

let settingsPath = null;
let cache = {};
let failed = false;

function init() {
  settingsPath = path.join(app.getPath('userData'), 'user-settings.json');
  load();
}

function load() {
  const { data, source, error } = fsSafe.readJsonWithRecovery(settingsPath);
  if (source === 'bak') {
    console.error('userSettings: user-settings.json was corrupt — restored from .bak');
    // Count the recovery. Lazy + deferred require: telemetry requires this
    // module, so a top-level require here would be circular.
    setImmediate(() => {
      try {
        require('./telemetry').track('error_occurred', { category: 'settings_corrupt_recovered' });
      } catch (e) {}
    });
  } else if (error) {
    console.error('userSettings: failed to load (corrupt copy preserved):', error.message);
  }
  // Unrecoverable load (read/parse error with no .bak to fall back on) means
  // the cache no longer reflects what the user chose — consumers that must
  // not fail open (telemetry opt-out) check loadFailed(). A missing file
  // (fresh install) or a successful .bak recovery is not a failure.
  failed = data === null && error !== null;
  cache = data || {};
}

function get(key) {
  return Object.prototype.hasOwnProperty.call(cache, key) ? cache[key] : null;
}

function set(key, value) {
  if (value === null || value === undefined) {
    delete cache[key];
  } else {
    cache[key] = value;
  }
  try {
    fsSafe.writeFileAtomic(settingsPath, JSON.stringify(cache, null, 2));
    // A successful write makes the on-disk file match the cache again, so a
    // degraded load is no longer the source of truth.
    failed = false;
    return true;
  } catch (err) {
    console.error('userSettings: failed to write', err);
    return false;
  }
}

/**
 * True when the last load ended in an unrecoverable failure — the settings
 * file existed but could not be read or parsed, and no usable `.bak` was
 * found. Distinct from a fresh install (no file), which is not a failure.
 */
function loadFailed() {
  return failed;
}

module.exports = { init, get, set, loadFailed };
