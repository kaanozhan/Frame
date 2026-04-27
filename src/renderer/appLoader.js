/**
 * App Loader
 *
 * Full-screen splash shown on boot until the first WORKSPACE_DATA arrives
 * (or a safety timeout fires). Avoids the brief flash of empty sidebar /
 * unmounted terminal that users see while the main process loads workspace
 * state.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');

const FAILSAFE_MS = 10000;
const FADE_MS = 280;

let loaderEl = null;
let firstDataArrived = false;

function init() {
  loaderEl = document.getElementById('app-loader');
  if (!loaderEl) return;

  // Hide as soon as workspace data arrives the first time. Registered before
  // welcomeOverlay's listener so the loader fades out before the welcome
  // modal can open behind it.
  ipcRenderer.on(IPC.WORKSPACE_DATA, () => {
    if (firstDataArrived) return;
    firstDataArrived = true;
    hide();
  });

  // Failsafe — never trap the user behind the loader if something fails.
  setTimeout(() => {
    if (!firstDataArrived) hide();
  }, FAILSAFE_MS);
}

function hide() {
  if (!loaderEl) return;
  loaderEl.classList.add('app-loader-hidden');
  setTimeout(() => {
    if (loaderEl && loaderEl.parentNode) {
      loaderEl.parentNode.removeChild(loaderEl);
    }
    loaderEl = null;
  }, FADE_MS);
}

module.exports = { init };
