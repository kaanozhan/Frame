/**
 * Telemetry
 *
 * Anonymous launch counter via Aptabase. Default opt-out: telemetry runs
 * unless the user disables it from Settings. We only ever send a single
 * `app_started` event per launch — no file paths, no project names, no
 * code, no personally identifying information.
 *
 * The Aptabase app key below is a public identifier (not a secret). It
 * has write-only permissions and cannot read the dashboard or delete
 * data. Same model as Google Analytics tracking IDs.
 */

const aptabase = require('@aptabase/electron/main');
const userSettings = require('./userSettings');

const APTABASE_APP_KEY = 'A-EU-5590504973';
const ENABLED_KEY = 'telemetryEnabled';

let initialized = false;

/**
 * Initialize Aptabase if telemetry is enabled. Safe to call once on app
 * boot — no events are sent until trackAppStarted() runs.
 */
function init() {
  if (!isEnabled()) return;
  if (initialized) return;
  try {
    aptabase.initialize(APTABASE_APP_KEY);
    initialized = true;
  } catch (err) {
    console.error('Telemetry: Aptabase init failed', err);
  }
}

/**
 * Send a single anonymous event marking this launch. No-op if disabled
 * or not initialized.
 */
function trackAppStarted() {
  if (!isEnabled() || !initialized) return;
  try {
    aptabase.trackEvent('app_started');
  } catch (err) {
    console.error('Telemetry: trackEvent failed', err);
  }
}

/**
 * Toggle telemetry from Settings. Persists the new state and lazily
 * initializes Aptabase if the user just turned it on.
 */
function setEnabled(enabled) {
  const value = enabled === true;
  userSettings.set(ENABLED_KEY, value);
  if (value && !initialized) {
    init();
  }
  return value;
}

/**
 * Effective enabled state. Default ON when the setting has never been
 * touched (opt-out semantics).
 */
function isEnabled() {
  const value = userSettings.get(ENABLED_KEY);
  return value !== false;
}

module.exports = { init, trackAppStarted, setEnabled, isEnabled };
