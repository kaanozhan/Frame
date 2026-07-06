/**
 * Update Checker Module
 *
 * Polls the GitHub Releases API for newer versions on launch and every
 * RECHECK_INTERVAL_MS while the app stays open. Notifies the renderer
 * with UPDATE_AVAILABLE; the renderer decides how to present (bell
 * button, sidebar notification dot, Settings About section).
 *
 * Dismiss support: a version the user has dismissed is recorded in
 * userSettings (dismissedUpdateVersion). The dismissed version still
 * appears in manual checks and in the About panel, but the renderer
 * uses the dismissed flag to suppress passive indicators.
 */

const { ipcMain } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const https = require('https');

const REPO_OWNER = 'kaanozhan';
const REPO_NAME = 'Frame';
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

let mainWindow = null;
let recheckTimer = null;
let lastCheckedAt = null;
let lastResult = null;
let lastStatus = null; // 'update-available' | 'up-to-date' | 'error'
let lastErrorReason = null; // 'network' | 'timeout' | 'parse' | null

function init(window) {
  mainWindow = window;
  startPeriodicRecheck();
}

function setupIPC() {
  ipcMain.handle(IPC.CHECK_FOR_UPDATE, async () => {
    return checkForUpdate();
  });
  ipcMain.handle(IPC.GET_UPDATE_STATUS, () => ({
    lastCheckedAt,
    lastStatus,
    lastErrorReason,
    result: lastResult,
    currentVersion: require('../../package.json').version
  }));
}

function startPeriodicRecheck() {
  if (recheckTimer) clearInterval(recheckTimer);
  recheckTimer = setInterval(() => {
    checkForUpdate().catch(() => {});
  }, RECHECK_INTERVAL_MS);
}

/**
 * Check GitHub for a newer release.
 *
 * Resolves a discriminated result — the UI must be able to tell "you're
 * current" apart from "the check failed" (they used to both resolve null):
 *   { status: 'update-available', info }
 *   { status: 'up-to-date', checkedAt }
 *   { status: 'error', reason: 'network' | 'timeout' | 'parse', checkedAt }
 * Never rejects.
 */
function checkForUpdate() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (status, extra = {}) => {
      if (settled) return;
      settled = true;
      lastCheckedAt = new Date().toISOString();
      lastStatus = status;
      lastErrorReason = status === 'error' ? extra.reason : null;
      if (status !== 'update-available') lastResult = null;
      resolve({ status, checkedAt: lastCheckedAt, ...extra });
    };

    const options = {
      hostname: 'api.github.com',
      path: `/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`,
      headers: { 'User-Agent': 'Frame-App' }
    };

    const req = https.get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const release = JSON.parse(data);
          if (!release.tag_name) {
            // No releases published — current by definition.
            finish('up-to-date');
            return;
          }
          const latestVersion = release.tag_name.replace(/^v/, '');
          const currentVersion = require('../../package.json').version;

          if (isNewerVersion(currentVersion, latestVersion)) {
            const info = {
              currentVersion,
              latestVersion,
              releaseUrl: release.html_url,
              releaseName: release.name || release.tag_name,
              publishedAt: release.published_at,
              releaseNotes: release.body || ''
            };
            lastResult = info;
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send(IPC.UPDATE_AVAILABLE, info);
            }
            finish('update-available', { info });
          } else {
            finish('up-to-date');
          }
        } catch {
          finish('error', { reason: 'parse' });
        }
      });
    });

    req.on('error', () => finish('error', { reason: 'network' }));
    req.setTimeout(10000, () => { req.destroy(); finish('error', { reason: 'timeout' }); });
  });
}

/**
 * Compare semver: returns true if latest > current
 */
function isNewerVersion(current, latest) {
  const c = current.split('.').map(Number);
  const l = latest.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((l[i] || 0) > (c[i] || 0)) return true;
    if ((l[i] || 0) < (c[i] || 0)) return false;
  }
  return false;
}

module.exports = { init, setupIPC, checkForUpdate };
