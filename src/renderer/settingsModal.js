/**
 * Settings Modal
 *
 * Minimal preferences UI. v1 ships a single "Privacy & Analytics" section
 * with the telemetry toggle. Future settings (theme, AI tool defaults,
 * keybinding remap) plug into this same modal.
 */

const { ipcRenderer, shell } = require('electron');
const { IPC } = require('../shared/ipcChannels');

const TELEMETRY_KEY = 'telemetryEnabled';
const DISMISSED_VERSION_KEY = 'dismissedUpdateVersion';

let overlayEl = null;
let toggleEl = null;
let isOpen = false;

// About section elements + state
let aboutVersionEl = null;
let aboutStatusEl = null;
let aboutCheckBtn = null;
let updateBanner = null;
let updateLatestEl = null;
let updateReleasedEl = null;
let updateLinkEl = null;
let updateDismissBtn = null;
let currentUpdateInfo = null;

function init() {
  overlayEl = document.getElementById('settings-overlay');
  toggleEl = document.getElementById('settings-telemetry-toggle');

  // About section
  aboutVersionEl = document.getElementById('settings-version');
  aboutStatusEl = document.getElementById('settings-update-status');
  aboutCheckBtn = document.getElementById('settings-check-updates');
  updateBanner = document.getElementById('settings-update-available');
  updateLatestEl = document.getElementById('settings-update-latest');
  updateReleasedEl = document.getElementById('settings-update-released');
  updateLinkEl = document.getElementById('settings-update-link');
  updateDismissBtn = document.getElementById('settings-update-dismiss');

  if (!overlayEl || !toggleEl) {
    console.error('Settings modal: required elements not found');
    return;
  }

  // Load current value
  syncToggleFromSettings();
  initAboutSection();

  // Toggle: persist + tell main process to enable/disable Aptabase
  toggleEl.addEventListener('change', async () => {
    const enabled = toggleEl.checked;
    await ipcRenderer.invoke(IPC.SET_USER_SETTING, TELEMETRY_KEY, enabled);
    await ipcRenderer.invoke(IPC.TELEMETRY_SET_ENABLED, enabled);
  });

  overlayEl.addEventListener('mousedown', (e) => {
    if (e.target === overlayEl) close();
  });

  document.querySelectorAll('[data-settings-close]').forEach((btn) => {
    btn.addEventListener('click', () => close());
  });

  document.addEventListener('keydown', (e) => {
    if (isOpen && e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });

  // Open from menu trigger
  ipcRenderer.on(IPC.OPEN_SETTINGS, () => open());

  // Push updates from periodic recheck refresh the About panel state
  ipcRenderer.on(IPC.UPDATE_AVAILABLE, (event, info) => {
    currentUpdateInfo = info;
    renderUpdateState({ checked: true, found: true, info });
  });
}

function initAboutSection() {
  // Version text from package.json
  try {
    const pkgVersion = require('../../package.json').version;
    if (aboutVersionEl) aboutVersionEl.textContent = `v${pkgVersion}`;
  } catch (e) { /* ignore */ }

  if (aboutCheckBtn) {
    aboutCheckBtn.addEventListener('click', () => {
      runCheck(true);
    });
  }

  if (updateLinkEl) {
    updateLinkEl.addEventListener('click', (e) => {
      e.preventDefault();
      if (currentUpdateInfo && currentUpdateInfo.releaseUrl) {
        shell.openExternal(currentUpdateInfo.releaseUrl);
      }
    });
  }

  if (updateDismissBtn) {
    updateDismissBtn.addEventListener('click', async () => {
      if (!currentUpdateInfo) return;
      await ipcRenderer.invoke(
        IPC.SET_USER_SETTING,
        DISMISSED_VERSION_KEY,
        currentUpdateInfo.latestVersion
      );
      // Hide the banner immediately; sidebar dot is also gated by this flag.
      hideUpdateBanner();
      hideSidebarDot();
    });
  }

  // Hydrate from main's cached status (no extra network call)
  ipcRenderer
    .invoke(IPC.GET_UPDATE_STATUS)
    .then((status) => {
      if (!status) return;
      if (status.result) {
        currentUpdateInfo = status.result;
        renderUpdateState({
          checked: !!status.lastCheckedAt,
          found: true,
          info: status.result,
          checkedAt: status.lastCheckedAt
        });
      } else if (status.lastCheckedAt) {
        renderUpdateState({
          checked: true,
          found: false,
          checkedAt: status.lastCheckedAt
        });
      } else {
        // Not yet checked since launch — fire one to populate
        runCheck(false);
      }
    })
    .catch(() => {});
}

async function runCheck(userInitiated) {
  if (aboutStatusEl) aboutStatusEl.textContent = 'Checking…';
  if (aboutCheckBtn) aboutCheckBtn.disabled = true;
  try {
    const info = await ipcRenderer.invoke(IPC.CHECK_FOR_UPDATE);
    const status = await ipcRenderer.invoke(IPC.GET_UPDATE_STATUS);
    if (info) {
      currentUpdateInfo = info;
      renderUpdateState({
        checked: true,
        found: true,
        info,
        checkedAt: status ? status.lastCheckedAt : null,
        userInitiated
      });
    } else {
      renderUpdateState({
        checked: true,
        found: false,
        checkedAt: status ? status.lastCheckedAt : null,
        userInitiated
      });
    }
  } catch (err) {
    if (aboutStatusEl) aboutStatusEl.textContent = 'Could not check for updates.';
  } finally {
    if (aboutCheckBtn) aboutCheckBtn.disabled = false;
  }
}

function renderUpdateState({ checked, found, info, checkedAt, userInitiated }) {
  if (!aboutStatusEl) return;
  const stamp = checkedAt ? formatRelative(new Date(checkedAt)) : '';
  if (found && info) {
    aboutStatusEl.textContent = stamp ? `Last checked ${stamp}.` : '';
    showUpdateBanner(info);
  } else if (checked) {
    aboutStatusEl.textContent = stamp
      ? `You're up to date. Last checked ${stamp}.`
      : "You're up to date.";
    hideUpdateBanner();
  } else {
    aboutStatusEl.textContent = 'Not checked yet.';
  }
}

function showUpdateBanner(info) {
  if (!updateBanner) return;
  updateBanner.style.display = '';
  if (updateLatestEl) updateLatestEl.textContent = `v${info.latestVersion}`;
  if (updateReleasedEl) {
    const released = info.publishedAt ? formatRelative(new Date(info.publishedAt)) : '';
    updateReleasedEl.textContent = released ? `— Released ${released}` : '';
  }
  if (updateLinkEl) updateLinkEl.setAttribute('href', info.releaseUrl || '#');
}

function hideUpdateBanner() {
  if (updateBanner) updateBanner.style.display = 'none';
}

function hideSidebarDot() {
  const dot = document.getElementById('update-dot');
  if (dot) dot.style.display = 'none';
}

function formatRelative(date) {
  const diffMs = Date.now() - date.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

async function syncToggleFromSettings() {
  if (!toggleEl) return;
  const value = await ipcRenderer.invoke(IPC.GET_USER_SETTING, TELEMETRY_KEY);
  // Default ON when unset (opt-out semantics)
  toggleEl.checked = value !== false;
}

function open() {
  if (isOpen) return;
  isOpen = true;
  syncToggleFromSettings();
  overlayEl.classList.add('visible');
}

function close() {
  if (!isOpen) return;
  isOpen = false;
  overlayEl.classList.remove('visible');
  if (typeof window.terminalFocus === 'function') window.terminalFocus();
}

function toggle() {
  if (isOpen) close();
  else open();
}

module.exports = { init, open, close, toggle };
