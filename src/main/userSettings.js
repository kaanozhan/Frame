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

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let settingsPath = null;
let cache = {};

function init() {
  settingsPath = path.join(app.getPath('userData'), 'user-settings.json');
  load();
}

function load() {
  try {
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      cache = JSON.parse(raw) || {};
    } else {
      cache = {};
    }
  } catch (err) {
    console.error('userSettings: failed to load', err);
    cache = {};
  }
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
    fs.writeFileSync(settingsPath, JSON.stringify(cache, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('userSettings: failed to write', err);
    return false;
  }
}

module.exports = { init, get, set };
