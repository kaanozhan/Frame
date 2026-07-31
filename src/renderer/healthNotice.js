/**
 * Health Notice Banner
 *
 * Dismissible one-liner at the top of the app for states pushed from the main
 * process: crash-guard errors (MAIN_PROCESS_ERROR), state files restored from
 * backup (STATE_FILE_RECOVERED), corrupt tasks.json (TASKS_FILE_ERROR), and
 * the layout-migration receipt (MIGRATION_COMPLETED). Same visual pattern as
 * the telemetry notice, but created on demand — one banner, latest message
 * wins.
 *
 * Three kinds: `error`, `warn`, and `info`. The last exists for the migration
 * receipt, which is not a degraded state — a completed migration gets an
 * information icon and `role="status"`, not `⚠` and `role="alert"` — and it is
 * the only kind that can carry an action button.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');

let bannerEl = null;
let messageEl = null;
let actionEl = null;
let lastMessage = null;
let showChanges = null;

function init(deps = {}) {
  showChanges = typeof deps.onShowChanges === 'function' ? deps.onShowChanges : null;

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

  ipcRenderer.on(IPC.MIGRATION_COMPLETED, (event, payload) => {
    const receipt = buildReceipt(payload && payload.projects);
    if (!receipt) return;
    show('info', receipt.message, receipt.tracked && showChanges
      ? { label: 'Show changes', onClick: showChanges }
      : null);
  });
}

/**
 * The receipt for one sweep. It reports; it does not advise.
 *
 * Its job is to answer "why does my working tree have seven deletions?" before
 * the user asks it — attribution, not instruction. So it says what moved, what
 * was restored and where the backup is, and says nothing about committing,
 * about sharing modes, or about Project Settings: when and whether to commit
 * is the user's repo discipline and Frame has no standing in it.
 *
 * Deferred projects are deliberately absent. That state is normal, it resolves
 * the moment the user commits, and reporting it every startup would be a
 * recurring message with no action attached — the foreground modal is where a
 * deferral gets explained, because there the user is actually blocked.
 *
 * @returns {{ message: string, tracked: number }|null} null when nothing
 *   happened that the user needs to be told about.
 */
function buildReceipt(projects) {
  const all = Array.isArray(projects) ? projects : [];
  const migrated = all.filter((p) => p.status === 'migrated');
  const failed = all.filter((p) => p.status === 'failed');
  if (!migrated.length && !failed.length) return null;

  const tracked = migrated.reduce((sum, p) => sum + (p.tracked || 0), 0);
  const parts = [];

  if (migrated.length === 1) {
    parts.push(
      `${migrated[0].name} was migrated to the current Frame layout — its tasks, structure and notes now live in .frame/, and a copy of everything removed is in .frame/migration-backup/.`
    );
  } else if (migrated.length > 1) {
    parts.push(
      `${migrated.length} projects migrated to the current Frame layout — ${migrated.map((p) => p.name).join(', ')}. Their tasks, structure and notes now live in .frame/; a copy of everything removed is in each project's .frame/migration-backup/.`
    );
  }

  // Keyed off the deleted files' tracked state, not the sharing mode: a user
  // who gitignored .frame/ themselves but committed the root files derives
  // `local` while the deletions are plainly visible (D8).
  if (tracked) {
    parts.push(`${tracked} tracked ${tracked === 1 ? 'file was' : 'files were'} removed — Frame staged nothing.`);
  }

  // With migration silent and the legacy banner gone, a failed project has no
  // other way to tell the user why it is empty.
  if (failed.length) {
    parts.push(
      failed.length === 1
        ? `${failed[0].name} could not be migrated.`
        : `${failed.length} projects could not be migrated: ${failed.map((p) => p.name).join(', ')}.`
    );
  }

  return { message: parts.join(' '), tracked };
}

function show(kind, message, action) {
  // An uncaught-exception loop must not stack/flicker banners.
  if (bannerEl && message === lastMessage) return;
  lastMessage = message;

  if (!bannerEl) {
    bannerEl = document.createElement('div');
    bannerEl.className = 'health-notice';

    const icon = document.createElement('span');
    icon.className = 'health-notice-icon';

    messageEl = document.createElement('span');
    messageEl.className = 'health-notice-text';

    actionEl = document.createElement('button');
    actionEl.className = 'health-notice-action';
    actionEl.style.display = 'none';

    const close = document.createElement('button');
    close.className = 'health-notice-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '✕';
    close.addEventListener('click', dismiss);

    bannerEl.append(icon, messageEl, actionEl, close);
    document.body.appendChild(bannerEl);
  }

  const info = kind === 'info';
  bannerEl.classList.toggle('health-notice-error', kind === 'error');
  bannerEl.classList.toggle('health-notice-info', info);
  bannerEl.setAttribute('role', info ? 'status' : 'alert');
  bannerEl.querySelector('.health-notice-icon').textContent = info ? 'ℹ' : '⚠';
  messageEl.textContent = message;

  actionEl.replaceWith(actionEl.cloneNode(false)); // drop the previous handler
  actionEl = bannerEl.querySelector('.health-notice-action');
  if (action && action.label) {
    actionEl.textContent = action.label;
    actionEl.style.display = '';
    actionEl.addEventListener('click', () => {
      dismiss();
      action.onClick();
    });
  } else {
    actionEl.style.display = 'none';
  }

  bannerEl.classList.add('visible');
}

function dismiss() {
  if (!bannerEl) return;
  bannerEl.classList.remove('visible');
  const el = bannerEl;
  bannerEl = null;
  messageEl = null;
  actionEl = null;
  lastMessage = null;
  setTimeout(() => {
    if (el.parentNode) el.parentNode.removeChild(el);
  }, 220);
}

module.exports = { init, buildReceipt };
