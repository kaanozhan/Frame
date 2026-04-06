/**
 * Update Checker Module
 * Checks GitHub Releases API for new versions
 */

const { ipcMain } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const https = require('https');

const REPO_OWNER = 'kaanozhan';
const REPO_NAME = 'Frame';

let mainWindow = null;

function init(window) {
  mainWindow = window;
}

function setupIPC() {
  ipcMain.handle(IPC.CHECK_FOR_UPDATE, async () => {
    return checkForUpdate();
  });
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
          if (!release.tag_name) {
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
              publishedAt: release.published_at
            };
            // Also notify renderer proactively
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send(IPC.UPDATE_AVAILABLE, result);
            }
            resolve(result);
          } else {
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
