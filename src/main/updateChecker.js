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

function checkForUpdate() {
  return new Promise((resolve) => {
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
          lastCheckedAt = new Date().toISOString();
          if (!release.tag_name) {
            lastResult = null;
            resolve(null);
            return;
          }
          const latestVersion = release.tag_name.replace(/^v/, '');
          const currentVersion = require('../../package.json').version;

          if (isNewerVersion(currentVersion, latestVersion)) {
            const result = {
              currentVersion,
              latestVersion,
              releaseUrl: release.html_url,
              releaseName: release.name || release.tag_name,
              publishedAt: release.published_at,
              releaseNotes: release.body || ''
            };
            lastResult = result;
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send(IPC.UPDATE_AVAILABLE, result);
            }
            resolve(result);
          } else {
            lastResult = null;
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
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
