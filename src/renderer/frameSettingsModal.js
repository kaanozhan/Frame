/**
 * Frame Settings
 *
 * Frame's own settings, opened by the gear in the sidebar header (and Cmd+,,
 * and the app menu's Settings item). Machine-wide: privacy choices and the
 * About panel with the updater are the same whichever project is open, and
 * they outlive every one of them.
 *
 * The project's own settings are a separate surface (projectSettingsModal),
 * reached from the sliders button at the foot of the sidebar rail. The gear
 * is here because a gear means application preferences everywhere else; the
 * project's scope wears a different mark for the same reason.
 *
 * The sidebar's update dot and banner lead here — into About, which is where
 * the release they are announcing can actually be read.
 */

const { ipcRenderer, shell } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const settingsOverlay = require('./settingsOverlay');
const uiZoom = require('../shared/uiZoom');

const ANALYTICS_KEY = 'analyticsEnabled';
const { ANALYTICS_UI_HIDDEN } = require('../shared/analyticsUi');
const CRASH_DUMPS_KEY = 'crashDumpsEnabled';
const ERROR_REPORTING_KEY = 'errorReportingEnabled';
const DISMISSED_VERSION_KEY = 'dismissedUpdateVersion';

let overlay = null;
let toggleEl = null;
let crashDumpsToggleEl = null;
let errorReportingToggleEl = null;
// Appearance › Interface size (ui-zoom-steps spec). Main owns the step; this
// select shows it and asks for another over UI_ZOOM_SET.
let zoomSelectEl = null;

// About section elements + state
let aboutVersionEl = null;
let aboutStatusEl = null;
let aboutCheckBtn = null;
let updateBanner = null;
let updateLatestEl = null;
let updateReleasedEl = null;
let updateLinkEl = null;
let updateDismissBtn = null;
let updateTitleEl = null;
let updateInstallBtn = null;
let currentUpdateInfo = null;
// Auto-update (packaged macOS only): main downloads in the background and
// the banner offers "Restart to Install" once the download is done.
let autoUpdateActive = false;
let updateDownloaded = false;

function init() {
  toggleEl = document.getElementById('settings-analytics-toggle');
  crashDumpsToggleEl = document.getElementById('settings-crash-dumps-toggle');
  errorReportingToggleEl = document.getElementById('settings-error-reporting-toggle');
  zoomSelectEl = document.getElementById('settings-ui-zoom');
  initZoomSelect();

  // About section
  aboutVersionEl = document.getElementById('settings-version');
  aboutStatusEl = document.getElementById('settings-update-status');
  aboutCheckBtn = document.getElementById('settings-check-updates');
  updateBanner = document.getElementById('settings-update-available');
  updateLatestEl = document.getElementById('settings-update-latest');
  updateReleasedEl = document.getElementById('settings-update-released');
  updateLinkEl = document.getElementById('settings-update-link');
  updateDismissBtn = document.getElementById('settings-update-dismiss');
  updateTitleEl = document.getElementById('settings-update-title');
  updateInstallBtn = document.getElementById('settings-update-install');

  overlay = settingsOverlay.create('frame-settings-overlay', syncToggleFromSettings);
  if (!overlay || !toggleEl) {
    if (!toggleEl) console.error('Frame settings: required elements not found');
    return;
  }

  // Analytics UI hidden: its two rows are not offered (analyticsUi.js).
  if (ANALYTICS_UI_HIDDEN) hideAnalyticsRows();

  // Load current value
  syncToggleFromSettings();
  initAboutSection();

  // Toggle: persist + tell main to enable/disable sending (and to mint or
  // delete the install id, which setEnabled does on the spot)
  toggleEl.addEventListener('change', async () => {
    const enabled = toggleEl.checked;
    // Main first: setEnabled reads the old state to send the opt-out's one
    // analytics_disabled event, which it cannot do once the setting is off.
    await ipcRenderer.invoke(IPC.ANALYTICS_SET_ENABLED, enabled);
    await ipcRenderer.invoke(IPC.SET_USER_SETTING, ANALYTICS_KEY, enabled);
    // Only arrives when switching ON: track() is gated on the new state, so
    // an opt-out sends nothing, which is the point of an opt-out.
    ipcRenderer.send(IPC.ANALYTICS_TRACK, 'settings_changed', { setting: 'analytics' });
    // Error reporting rides on analytics being on, so the row follows it
    // rather than sitting enabled over a switch that silences it.
    syncErrorReportingAvailability(enabled);
  });

  // Error reports: opt-in, persisted setting only — analytics.captureException
  // reads it per call, so a change takes effect immediately.
  if (errorReportingToggleEl) {
    errorReportingToggleEl.addEventListener('change', async () => {
      await ipcRenderer.invoke(IPC.SET_USER_SETTING, ERROR_REPORTING_KEY, errorReportingToggleEl.checked);
      ipcRenderer.send(IPC.ANALYTICS_TRACK, 'settings_changed', { setting: 'error_reporting' });
    });
  }

  // Crash dumps: persisted setting only — crashGuard reads it at startup
  // (the reporter can't be stopped once started, so changes apply on next launch)
  if (crashDumpsToggleEl) {
    crashDumpsToggleEl.addEventListener('change', async () => {
      await ipcRenderer.invoke(IPC.SET_USER_SETTING, CRASH_DUMPS_KEY, crashDumpsToggleEl.checked);
      ipcRenderer.send(IPC.ANALYTICS_TRACK, 'settings_changed', { setting: 'crash_dumps' });
    });
  }

  // Interface size: every entry point (shortcut, menu, status bar, trackpad)
  // ends in main's setStep and comes back over UI_ZOOM_CHANGED, so the select
  // follows a change made anywhere — including its own.
  ipcRenderer.on(IPC.UI_ZOOM_CHANGED, (event, { step }) => {
    if (zoomSelectEl) zoomSelectEl.value = String(step);
  });

  // Open from menu trigger — the app menu's Settings item is application
  // preferences, so it lands here rather than on the project's panel.
  ipcRenderer.on(IPC.OPEN_SETTINGS, () => overlay.open());

  // Push updates from periodic recheck refresh the About panel state
  ipcRenderer.on(IPC.UPDATE_AVAILABLE, (event, info) => {
    currentUpdateInfo = info;
    renderUpdateState({ checked: true, found: true, info });
  });

  ipcRenderer.on(IPC.UPDATE_DOWNLOADED, (event, info) => {
    currentUpdateInfo = info;
    autoUpdateActive = true;
    updateDownloaded = true;
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

  // Diagnostics: reveal the rotating (redacted) log file — the first thing
  // to grab when filing a bug report. Location documented in PRIVACY.md.
  const openLogsBtn = document.getElementById('settings-open-logs');
  if (openLogsBtn) {
    openLogsBtn.addEventListener('click', async () => {
      try {
        const info = await ipcRenderer.invoke(IPC.GET_LOG_INFO);
        if (info && info.logPath) shell.showItemInFolder(info.logPath);
        else if (info && info.logsDir) shell.openPath(info.logsDir);
      } catch (err) {
        console.error('Settings: could not open logs folder', err);
      }
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

  if (updateInstallBtn) {
    updateInstallBtn.addEventListener('click', () => {
      ipcRenderer.invoke(IPC.INSTALL_UPDATE).catch(() => {});
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
      autoUpdateActive = !!status.autoUpdate;
      updateDownloaded = !!status.downloaded;
      if (status.result) {
        currentUpdateInfo = status.result;
        renderUpdateState({
          checked: !!status.lastCheckedAt,
          found: true,
          info: status.result,
          checkedAt: status.lastCheckedAt
        });
      } else if (status.lastStatus === 'error') {
        renderUpdateState({
          checked: true,
          failed: true,
          failReason: status.lastErrorReason,
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
    // Discriminated result: 'update-available' | 'up-to-date' | 'error'.
    // A failed check must never render as "you're up to date".
    const res = await ipcRenderer.invoke(IPC.CHECK_FOR_UPDATE);
    if (res && res.status === 'update-available') {
      currentUpdateInfo = res.info;
      if (res.downloaded) updateDownloaded = true;
      renderUpdateState({
        checked: true,
        found: true,
        info: res.info,
        checkedAt: res.checkedAt,
        userInitiated
      });
    } else if (res && res.status === 'error') {
      renderUpdateState({
        checked: true,
        failed: true,
        failReason: res.reason,
        checkedAt: res.checkedAt,
        userInitiated
      });
    } else {
      renderUpdateState({
        checked: true,
        found: false,
        checkedAt: res ? res.checkedAt : null,
        userInitiated
      });
    }
  } catch (err) {
    if (aboutStatusEl) aboutStatusEl.textContent = 'Could not check for updates.';
  } finally {
    if (aboutCheckBtn) aboutCheckBtn.disabled = false;
  }
}

function renderUpdateState({ checked, found, failed, failReason, info, checkedAt, userInitiated }) {
  if (!aboutStatusEl) return;
  const stamp = checkedAt ? formatRelative(new Date(checkedAt)) : '';
  if (found && info) {
    if (updateDownloaded) {
      aboutStatusEl.textContent = 'Downloaded. Restart Frame to install it.';
    } else if (autoUpdateActive) {
      aboutStatusEl.textContent = stamp
        ? `Downloading in the background… Last checked ${stamp}.`
        : 'Downloading in the background…';
    } else {
      aboutStatusEl.textContent = stamp ? `Last checked ${stamp}.` : '';
    }
    showUpdateBanner(info);
  } else if (failed) {
    const why = failReason === 'timeout'
      ? 'timed out'
      : failReason === 'parse'
        ? 'unexpected response'
        : failReason === 'download'
          ? 'download failed'
          : 'network error';
    aboutStatusEl.textContent = `Update check failed (${why}) — you may not be on the latest version.`;
    hideUpdateBanner();
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
  if (updateTitleEl) {
    updateTitleEl.textContent = updateDownloaded ? 'Update ready' : 'New version available';
  }
  if (updateInstallBtn) updateInstallBtn.style.display = updateDownloaded ? '' : 'none';
  // One primary action at a time: installing outranks reading the notes.
  if (updateLinkEl) updateLinkEl.classList.toggle('settings-about-btn-primary', !updateDownloaded);
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
  // The header's pulsing dot is gone (2026-09-14); only the banner remains.
  const banner = document.getElementById('sidebar-update-banner');
  if (banner) banner.style.display = 'none';
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

/**
 * Fill the Interface size select from the shared ladder — one option per
 * step, labelled the way the ladder labels it plus the percentage — so the
 * markup can never disagree with the numbers main applies.
 */
function initZoomSelect() {
  if (!zoomSelectEl) return;
  zoomSelectEl.innerHTML = '';
  for (const step of uiZoom.STEPS) {
    const opt = document.createElement('option');
    opt.value = String(step);
    opt.textContent = `${uiZoom.labelFor(step)} (${uiZoom.percentFor(step)}%)`;
    zoomSelectEl.appendChild(opt);
  }
  zoomSelectEl.addEventListener('change', async () => {
    const step = uiZoom.clampStep(Number(zoomSelectEl.value));
    try {
      await ipcRenderer.invoke(IPC.UI_ZOOM_SET, step);
      // From this control only. Zoom also changes by shortcut, menu, status
      // bar and trackpad; counting those too would say "people zoom", not
      // "people go to Settings to zoom", which is the question here.
      ipcRenderer.send(IPC.ANALYTICS_TRACK, 'settings_changed', { setting: 'ui_zoom' });
    } catch (err) {
      console.error('Frame settings: could not set the interface size', err);
    }
  });
}

async function syncZoomFromMain() {
  if (!zoomSelectEl) return;
  try {
    const { step } = await ipcRenderer.invoke(IPC.UI_ZOOM_GET);
    zoomSelectEl.value = String(step);
  } catch (err) {
    console.error('Frame settings: could not read the interface size', err);
  }
}

/**
 * Error reporting is gated on analytics in main (analytics.captureException
 * requires both), so the row is disabled rather than left looking live over a
 * switch that silences it. The stored value is untouched — turning analytics
 * back on restores whatever the user had chosen here.
 */
/** Hidden analytics UI: hide its switch and the error-report switch that rides on it. */
function hideAnalyticsRows() {
  for (const id of ['settings-analytics-row', 'settings-error-reporting-row']) {
    const row = document.getElementById(id);
    if (row) row.style.display = 'none'; // .settings-row's display: flex would override [hidden]
  }
  const title = document.getElementById('settings-privacy-title');
  if (title) title.textContent = 'Privacy';
}

function syncErrorReportingAvailability(analyticsOn) {
  if (!errorReportingToggleEl) return;
  errorReportingToggleEl.disabled = !analyticsOn;
  const row = errorReportingToggleEl.closest('.settings-row');
  if (row) row.classList.toggle('settings-row-disabled', !analyticsOn);
}

async function syncToggleFromSettings() {
  if (!toggleEl) return;
  syncZoomFromMain();
  const value = await ipcRenderer.invoke(IPC.GET_USER_SETTING, ANALYTICS_KEY);
  // Default ON when unset (opt-out semantics)
  toggleEl.checked = value !== false;

  if (errorReportingToggleEl) {
    const errors = await ipcRenderer.invoke(IPC.GET_USER_SETTING, ERROR_REPORTING_KEY);
    // Default OFF when unset — this one is opt-in
    errorReportingToggleEl.checked = errors === true;
    syncErrorReportingAvailability(toggleEl.checked);
  }

  if (crashDumpsToggleEl) {
    const dumps = await ipcRenderer.invoke(IPC.GET_USER_SETTING, CRASH_DUMPS_KEY);
    // Default ON when unset (local-only; nothing is uploaded)
    crashDumpsToggleEl.checked = dumps !== false;
  }
}

module.exports = {
  init,
  open: () => overlay && overlay.open(),
  close: () => overlay && overlay.close(),
  toggle: () => overlay && overlay.toggle()
};
