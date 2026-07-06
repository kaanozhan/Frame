/**
 * Health Notice Banner
 *
 * Dismissible one-liner at the top of the app for degraded/recovered states
 * pushed from the main process: crash-guard errors (MAIN_PROCESS_ERROR),
 * state files restored from backup (STATE_FILE_RECOVERED), and corrupt
 * tasks.json (TASKS_FILE_ERROR). Same visual pattern as the telemetry
 * notice, but created on demand — one banner, latest message wins.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');

let bannerEl = null;
let messageEl = null;
let lastMessage = null;

function init() {
  ipcRenderer.on(IPC.MAIN_PROCESS_ERROR, (event, payload) => {
    const kind = payload && payload.severity === 'warning' ? 'warn' : 'error';
    show(kind, payload && payload.message ? payload.message : 'An unexpected error occurred in the main process.');
  });

  ipcRenderer.on(IPC.STATE_FILE_RECOVERED, (event, payload) => {
    const file = payload && payload.file ? payload.file : 'A state file';
    show('warn', `${file} was corrupt and has been restored from its backup.`);
  });

  ipcRenderer.on(IPC.TASKS_FILE_ERROR, (event, payload) => {
    if (payload && payload.recovered) {
      show('warn', 'tasks.json was corrupt and has been restored from its backup.');
    } else {
      show('warn', 'tasks.json was corrupt — started a fresh file; the broken copy is preserved next to it.');
    }
  });
}

function show(kind, message) {
  // An uncaught-exception loop must not stack/flicker banners.
  if (bannerEl && message === lastMessage) return;
  lastMessage = message;

  if (!bannerEl) {
    bannerEl = document.createElement('div');
    bannerEl.className = 'health-notice';
    bannerEl.setAttribute('role', 'alert');

    const icon = document.createElement('span');
    icon.className = 'health-notice-icon';
    icon.textContent = '⚠';

    messageEl = document.createElement('span');
    messageEl.className = 'health-notice-text';

    const close = document.createElement('button');
    close.className = 'health-notice-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '✕';
    close.addEventListener('click', dismiss);

    bannerEl.append(icon, messageEl, close);
    document.body.appendChild(bannerEl);
  }

  bannerEl.classList.toggle('health-notice-error', kind === 'error');
  messageEl.textContent = message;
  bannerEl.classList.add('visible');
}

function dismiss() {
  if (!bannerEl) return;
  bannerEl.classList.remove('visible');
  const el = bannerEl;
  bannerEl = null;
  messageEl = null;
  lastMessage = null;
  setTimeout(() => {
    if (el.parentNode) el.parentNode.removeChild(el);
  }, 220);
}

module.exports = { init };
