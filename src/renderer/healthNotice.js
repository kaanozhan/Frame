/**
 * Health Notice Banner
 *
 * Dismissible one-liner at the top of the app for degraded/recovered states
 * pushed from the main process: crash-guard errors (MAIN_PROCESS_ERROR),
 * state files restored from backup (STATE_FILE_RECOVERED), and corrupt
 * tasks.json (TASKS_FILE_ERROR). It also carries the layout migration's
 * receipt — the one thing here that is news rather than a degraded state,
 * which is what the informational variant is for: Frame moved a project's
 * own files without asking, so it says so, and says where the backup is.
 * Same visual pattern as the telemetry notice, but created on demand — one
 * banner, latest message wins.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');

let bannerEl = null;
let messageEl = null;
let iconEl = null;
let lastMessage = null;

const ICONS = { error: '⚠', warn: '⚠', info: 'ℹ' };

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

    iconEl = document.createElement('span');
    iconEl.className = 'health-notice-icon';

    messageEl = document.createElement('span');
    messageEl.className = 'health-notice-text';

    const close = document.createElement('button');
    close.className = 'health-notice-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '✕';
    close.addEventListener('click', dismiss);

    bannerEl.append(iconEl, messageEl, close);
    document.body.appendChild(bannerEl);
  }

  bannerEl.classList.toggle('health-notice-error', kind === 'error');
  bannerEl.classList.toggle('health-notice-info', kind === 'info');
  // A receipt is not an alert: announcing it as one interrupts a screen
  // reader for something the user is not being asked to do anything about.
  bannerEl.setAttribute('role', kind === 'info' ? 'status' : 'alert');
  iconEl.textContent = ICONS[kind] || ICONS.warn;
  messageEl.textContent = message;
  bannerEl.classList.add('visible');
}

function dismiss() {
  if (!bannerEl) return;
  bannerEl.classList.remove('visible');
  const el = bannerEl;
  bannerEl = null;
  messageEl = null;
  iconEl = null;
  lastMessage = null;
  setTimeout(() => {
    if (el.parentNode) el.parentNode.removeChild(el);
  }, 220);
}

/**
 * The layout migration's one-liner: the receipt of a move the user never
 * agreed to beforehand, or the reason one was left alone.
 *
 * Takes `migration` from IS_FRAME_PROJECT_RESULT verbatim, and says nothing
 * when there is nothing to say — which is every open of a project that was
 * already on the `.frame/` layout.
 */
function showMigration(migration) {
  if (!migration) return;

  if (migration.blocked === 'unmerged') {
    const files = (migration.unmerged || []).join(', ') || 'a Frame file';
    show('warn', `Frame left this project alone: ${files} is in an unresolved merge. Finish the merge and reopen.`);
    return;
  }

  if (!migration.ran) return;

  const moved = (migration.moved || []).length;
  const parts = [`Frame moved ${moved} file${moved === 1 ? '' : 's'} into .frame/`];
  if (migration.backupDir) parts.push(`copies are in ${migration.backupDir}`);

  const symlinks = migration.symlinksRemoved || [];
  if (symlinks.length) {
    // Naming them matters: GEMINI.md has no replacement, so Gemini CLI stops
    // reading Frame's instructions in this project.
    parts.push(`${symlinks.join(' and ')} removed`);
  }
  if (migration.claudeMdRestored) parts.push('your original CLAUDE.md is back');

  let message = `${parts.join(' — ')}.`;
  if (migration.failedAt) {
    message += ` The move stopped at "${migration.failedAt}" — the backup has everything.`;
  }
  const review = (migration.review || []).length;
  if (review) message += ` ${review} need${review === 1 ? 's' : ''} a look — see Activity.`;

  show(migration.failedAt ? 'warn' : 'info', message);
}

module.exports = { init, showMigration };
