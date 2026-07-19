/**
 * App Loader
 *
 * Full-screen splash shown on boot until the first WORKSPACE_DATA arrives.
 * Avoids the brief flash of empty sidebar / unmounted terminal that users
 * see while the main process loads workspace state.
 *
 * If the failsafe timeout fires before any data, the splash swaps to a
 * "couldn't load workspace" state with a Retry button instead of silently
 * dropping the user into a blank app. Main has no error variant for
 * LOAD_WORKSPACE — the timeout is the only failure signal the renderer has.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');

const FAILSAFE_MS = 10000;
const FADE_MS = 280;

let loaderEl = null;
let firstDataArrived = false;
let failsafeTimer = null;
let initialized = false;

function init() {
  loaderEl = document.getElementById('app-loader');
  if (!loaderEl) return;
  // Init-once: a re-init must not stack a second WORKSPACE_DATA listener.
  if (initialized) return;
  initialized = true;

  // Hide as soon as workspace data arrives the first time. Registered before
  // welcomeOverlay's listener so the loader fades out before the welcome
  // modal can open behind it. Also resolves the failure state: if data
  // arrives late (slow main, or after Retry), the loader still goes away.
  ipcRenderer.on(IPC.WORKSPACE_DATA, () => {
    if (firstDataArrived) return;
    firstDataArrived = true;
    hide();
  });

  armFailsafe();
}

function armFailsafe() {
  if (failsafeTimer) clearTimeout(failsafeTimer);
  failsafeTimer = setTimeout(() => {
    if (!firstDataArrived) showFailureState();
  }, FAILSAFE_MS);
}

function showFailureState() {
  if (!loaderEl) return;
  loaderEl.innerHTML = `
    <div class="app-loader-mark app-loader-mark-error">&#10022;</div>
    <div class="app-loader-error-title">Couldn't load your workspace</div>
    <div class="app-loader-error-detail">The workspace didn't respond in time. You can retry, or restart Frame if this keeps happening.</div>
    <button type="button" class="btn app-loader-retry">Retry</button>
  `;
  loaderEl.querySelector('.app-loader-retry').addEventListener('click', () => {
    loaderEl.querySelector('.app-loader-error-title').textContent = 'Retrying…';
    ipcRenderer.send(IPC.LOAD_WORKSPACE);
    armFailsafe();
  });
}

function hide() {
  if (failsafeTimer) {
    clearTimeout(failsafeTimer);
    failsafeTimer = null;
  }
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
