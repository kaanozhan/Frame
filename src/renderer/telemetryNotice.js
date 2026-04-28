/**
 * Telemetry Notice Banner
 *
 * One-time banner shown at the top of the app on the first launch after
 * telemetry was introduced. Independent of the welcome modal so users who
 * already dismissed welcome still see this disclosure.
 *
 * Once acknowledged, never shows again. Persisted via userSettings.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');

const NOTICE_SHOWN_KEY = 'telemetryNoticeShown';

let bannerEl = null;
let acknowledgeBtn = null;
let closeBtn = null;
let settingsLink = null;

async function init(openSettings) {
  bannerEl = document.getElementById('telemetry-notice');
  acknowledgeBtn = document.getElementById('telemetry-notice-ack');
  closeBtn = document.getElementById('telemetry-notice-close');
  settingsLink = document.getElementById('telemetry-notice-settings-link');

  if (!bannerEl) return;

  // Show only if user hasn't seen it before
  const seen = await ipcRenderer.invoke(IPC.GET_USER_SETTING, NOTICE_SHOWN_KEY);
  if (seen === true) {
    bannerEl.remove();
    return;
  }

  bannerEl.classList.add('visible');

  if (acknowledgeBtn) acknowledgeBtn.addEventListener('click', dismiss);
  if (closeBtn) closeBtn.addEventListener('click', dismiss);
  if (settingsLink && typeof openSettings === 'function') {
    settingsLink.addEventListener('click', (e) => {
      e.preventDefault();
      openSettings();
    });
  }
}

function dismiss() {
  if (!bannerEl) return;
  ipcRenderer
    .invoke(IPC.SET_USER_SETTING, NOTICE_SHOWN_KEY, true)
    .catch((err) =>
      console.error('Telemetry notice: failed to persist dismiss', err)
    );
  bannerEl.classList.remove('visible');
  // Remove from DOM after fade so layout reflows
  setTimeout(() => {
    if (bannerEl && bannerEl.parentNode) bannerEl.parentNode.removeChild(bannerEl);
    bannerEl = null;
  }, 220);
}

module.exports = { init };
