/**
 * Claude Usage Manager Module
 * Fetches Claude Code usage data from OAuth API and provides periodic updates
 */

const { execFile } = require('child_process');
const fs = require('fs');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
const https = require('https');
const { IPC } = require('../shared/ipcChannels');
const logger = require('./logger');
const pollGate = require('./pollGate');

// Token sources, in order: the macOS Keychain (`security` CLI), then Claude
// Code's file-based store (~/.claude/.credentials.json) — the cross-platform
// location, so Linux/Windows users get usage data too. Only when neither
// source yields anything is usage reported unavailable, with the reason.
// Repeated token misses (not signed in / locked keychain) stop the poll; a
// manual refresh from the widget re-arms it.
const KEYCHAIN_SUPPORTED = process.platform === 'darwin';
const CREDENTIALS_FILE = path.join(os.homedir(), '.claude', '.credentials.json');
const MAX_TOKEN_MISSES = 3;

/** Is any credential source present on this system right now? */
function tokenSourceAvailable() {
  return KEYCHAIN_SUPPORTED || fs.existsSync(CREDENTIALS_FILE);
}

let mainWindow = null;
let pollingInterval = null;
let cachedUsage = null;
let lastFetchTime = null;
let consecutiveTokenMisses = 0;

/**
 * Initialize the module with window reference
 */
function init(window) {
  mainWindow = window;
  if (!tokenSourceAvailable()) {
    logger.info('claudeUsage', `usage polling disabled: no macOS Keychain (${process.platform}) and no ${CREDENTIALS_FILE}`);
    // One push so the widget can explain itself instead of showing stale "--".
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC.CLAUDE_USAGE_DATA, degradedPayload('no-credentials'));
      }
    }, 2000);
    return;
  }
  // Start polling when window is ready
  startPolling();
}

function degradedPayload(reason) {
  return {
    available: false,
    reason,
    error:
      reason === 'no-credentials'
        ? 'No Claude Code credentials found on this system — sign in via the claude CLI, then click to refresh'
        : 'Claude Code OAuth token not found — sign in via the claude CLI, then click to refresh',
    fiveHour: null,
    sevenDay: null,
    lastUpdated: new Date().toISOString()
  };
}

/** Pull the access token out of a credentials JSON string */
function parseAccessToken(raw) {
  const credentials = JSON.parse(raw);
  // Token can be in different locations depending on auth method
  if (credentials.claudeAiOauth?.accessToken) {
    return credentials.claudeAiOauth.accessToken;
  }
  if (credentials.accessToken) {
    return credentials.accessToken;
  }
  return null;
}

/**
 * Read the Keychain entry via the `security` CLI, asynchronously — the old
 * execSync here blocked the whole main process for up to 5s on every poll.
 */
function readKeychainCredentials() {
  return new Promise((resolve) => {
    execFile(
      'security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      { encoding: 'utf8', timeout: 5000 },
      (err, stdout) => resolve(err ? { error: err } : { raw: stdout.trim() })
    );
  });
}

/**
 * Get OAuth token: macOS Keychain first, then the file-based store
 * @returns {Promise<string|null>} Access token or null if not found
 */
async function getOAuthToken() {
  if (KEYCHAIN_SUPPORTED) {
    const { raw, error } = await readKeychainCredentials();
    if (error) {
      // Token not found, keychain locked, or exec error — try the file next
      logger.warn('claudeUsage', 'keychain token lookup failed:', error.message);
    } else if (raw) {
      try {
        const token = parseAccessToken(raw);
        if (token) return token;
      } catch (err) {
        logger.warn('claudeUsage', 'keychain credentials parse failed:', err.message);
      }
    }
  }

  try {
    if (fs.existsSync(CREDENTIALS_FILE)) {
      return parseAccessToken(await fsp.readFile(CREDENTIALS_FILE, 'utf8'));
    }
  } catch (err) {
    logger.warn('claudeUsage', 'credentials file read failed:', err.message);
  }
  return null;
}

/**
 * Fetch usage data from Claude OAuth API
 * @returns {Promise<Object>} Usage data or error
 */
async function fetchUsage() {
  if (!tokenSourceAvailable()) {
    return degradedPayload('no-credentials');
  }

  const token = await getOAuthToken();

  if (!token) {
    consecutiveTokenMisses++;
    if (consecutiveTokenMisses >= MAX_TOKEN_MISSES && pollingInterval) {
      logger.info('claudeUsage', `no OAuth token after ${consecutiveTokenMisses} attempts — pausing usage polling (manual refresh re-arms it)`);
      stopPolling();
    }
    return degradedPayload('no-token');
  }
  consecutiveTokenMisses = 0;

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.anthropic.com',
      path: '/api/oauth/usage',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'Content-Type': 'application/json'
      },
      timeout: 10000
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            const usage = JSON.parse(data);
            const result = {
              fiveHour: {
                utilization: usage.five_hour?.utilization || 0,
                resetsAt: usage.five_hour?.resets_at || null
              },
              sevenDay: {
                utilization: usage.seven_day?.utilization || 0,
                resetsAt: usage.seven_day?.resets_at || null
              },
              lastUpdated: new Date().toISOString(),
              error: null
            };
            cachedUsage = result;
            lastFetchTime = Date.now();
            resolve(result);
          } else if (res.statusCode === 401) {
            resolve({
              error: 'Token expired or invalid',
              fiveHour: null,
              sevenDay: null,
              lastUpdated: new Date().toISOString()
            });
          } else {
            resolve({
              error: `API error: ${res.statusCode}`,
              fiveHour: null,
              sevenDay: null,
              lastUpdated: new Date().toISOString()
            });
          }
        } catch (parseErr) {
          resolve({
            error: 'Failed to parse response',
            fiveHour: null,
            sevenDay: null,
            lastUpdated: new Date().toISOString()
          });
        }
      });
    });

    req.on('error', (err) => {
      resolve({
        error: `Network error: ${err.message}`,
        fiveHour: cachedUsage?.fiveHour || null,
        sevenDay: cachedUsage?.sevenDay || null,
        lastUpdated: cachedUsage?.lastUpdated || new Date().toISOString()
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        error: 'Request timeout',
        fiveHour: cachedUsage?.fiveHour || null,
        sevenDay: cachedUsage?.sevenDay || null,
        lastUpdated: cachedUsage?.lastUpdated || new Date().toISOString()
      });
    });

    req.end();
  });
}

// TTL-cached fetch: the poll cadence, the initial load, and the gate's
// refresh-on-show all funnel through this, so a show-transition inside the
// TTL window costs zero Keychain/network hits. Manual refresh bypasses it.
const USAGE_TTL_MS = 300000;
const fetchUsageCached = pollGate.ttlCache(() => fetchUsage(), USAGE_TTL_MS);

/**
 * Send usage data to renderer
 */
async function sendUsageToRenderer() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const usage = await fetchUsageCached();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.CLAUDE_USAGE_DATA, usage);
  }
}

/**
 * Start periodic polling for usage updates. Visibility-gated: pauses while
 * all windows are hidden, refreshes immediately on show.
 * @param {number} interval - Polling interval in ms (default: 300000 = 5 minutes)
 */
function startPolling(interval = 300000) {
  // Stop any existing polling
  stopPolling();

  // Initial fetch after a short delay
  setTimeout(() => {
    sendUsageToRenderer();
  }, 2000);

  // Start periodic updates
  pollingInterval = pollGate.gatedInterval(() => {
    sendUsageToRenderer();
  }, interval);
}

/**
 * Stop polling
 */
function stopPolling() {
  if (pollingInterval) {
    pollingInterval.dispose();
    pollingInterval = null;
  }
}

/**
 * Setup IPC handlers
 * @param {Electron.IpcMain} ipcMain
 */
function setupIPC(ipcMain) {
  // Handle initial load request — TTL-cached (a fresh panel open inside the
  // TTL window reuses the last poll's result)
  ipcMain.on(IPC.LOAD_CLAUDE_USAGE, async (event) => {
    const usage = await fetchUsageCached();
    if (!event.sender.isDestroyed()) {
      event.sender.send(IPC.CLAUDE_USAGE_DATA, usage);
    }
  });

  // Handle manual refresh request. Also re-arms polling if it was paused
  // after repeated token misses (e.g. the user has signed in since).
  ipcMain.on(IPC.REFRESH_CLAUDE_USAGE, async (event) => {
    consecutiveTokenMisses = 0;
    const usage = await fetchUsage();
    event.sender.send(IPC.CLAUDE_USAGE_DATA, usage);
    if (tokenSourceAvailable() && !pollingInterval && !usage.error) {
      startPolling();
    }
  });
}

/**
 * Cleanup on app quit
 */
function cleanup() {
  stopPolling();
  mainWindow = null;
}

module.exports = {
  init,
  setupIPC,
  cleanup,
  fetchUsage,
  startPolling,
  stopPolling
};
