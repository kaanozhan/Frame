/**
 * Migration Modal
 *
 * Asks before Frame moves a project's meta files into `.frame/`. Opened from
 * state.js when CHECK_IS_FRAME_PROJECT answers `layout: 'legacy'`, and never
 * otherwise — a project that has already migrated, or that Frame never
 * initialized, never sees it.
 *
 * Four states in one modal: the plan (what moves, where the backup goes),
 * progress while it runs, the receipt (what moved, what needs a look), and
 * the deferred state when the tree is dirty. "Later" writes nothing at all;
 * the project keeps working on its root files through frameStore's fallback.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const { escapeHtml } = require('./htmlUtils');

let modalEl = null;
let fileListEl = null;
let leadEl = null;
let backupNoteEl = null;
let dirtyWarningEl = null;
let dirtyListEl = null;
let progressEl = null;
let progressStepEl = null;
let receiptEl = null;
let laterBtn = null;
let runBtn = null;

let currentProjectPath = null;
let currentPlan = null;
// One offer per project per session: a user who clicks Later is not asked
// again until they reopen the app.
const deferred = new Set();

const DISPOSITION_TEXT = {
  move: 'moves into .frame/',
  'delete-identical': 'already in .frame/ — the root copy is backed up and removed',
  'backup-conflict': 'differs from the copy in .frame/ — kept in the backup for you to compare',
  'backup-only': "Frame's own backup file — moves into the backup folder"
};

function init() {
  modalEl = document.getElementById('migration-modal');
  if (!modalEl) return;

  fileListEl = document.getElementById('migration-file-list');
  leadEl = document.getElementById('migration-lead');
  backupNoteEl = document.getElementById('migration-backup-note');
  dirtyWarningEl = document.getElementById('migration-dirty-warning');
  dirtyListEl = document.getElementById('migration-dirty-list');
  progressEl = document.getElementById('migration-progress');
  progressStepEl = document.getElementById('migration-progress-step');
  receiptEl = document.getElementById('migration-receipt');
  laterBtn = document.getElementById('migration-later');
  runBtn = document.getElementById('migration-run');

  laterBtn.addEventListener('click', close);
  document.getElementById('migration-modal-close').addEventListener('click', close);
  runBtn.addEventListener('click', runMigration);

  ipcRenderer.on(IPC.LAYOUT_MIGRATION_PROGRESS, (event, { step, detail }) => {
    if (!progressStepEl) return;
    progressStepEl.textContent = `${stepLabel(step)}${detail ? `: ${detail}` : ''}`;
  });
}

function stepLabel(step) {
  switch (step) {
    case 'move': return 'Moving';
    case 'symlink': return 'Removing symlink';
    case 'restore': return 'Restoring';
    case 'pointer': return 'Writing';
    case 'hooks': return 'Updating hooks in';
    case 'sharing': return 'Applying sharing mode';
    default: return 'Working';
  }
}

/**
 * Offer the migration for this project. Silent when there is nothing to
 * migrate, when the user already said Later this session, or when main
 * answers with no plan.
 */
async function offer(projectPath) {
  if (!modalEl || !projectPath || deferred.has(projectPath)) return;

  let plan;
  try {
    plan = await ipcRenderer.invoke(IPC.GET_LAYOUT_MIGRATION_PLAN, projectPath);
  } catch (err) {
    return; // never block opening a project over this
  }
  if (!plan || !plan.artifacts || plan.artifacts.length === 0) return;

  currentProjectPath = projectPath;
  currentPlan = plan;
  render(plan);
  modalEl.classList.add('visible');
}

function render(plan) {
  receiptEl.style.display = 'none';
  progressEl.style.display = 'none';
  fileListEl.style.display = '';
  leadEl.style.display = '';

  fileListEl.innerHTML = plan.artifacts
    .map((a) => `<li><span class="file-icon">&#128196;</span> ${escapeHtml(a.name)}` +
      `<span class="file-desc">${escapeHtml(DISPOSITION_TEXT[a.disposition] || a.disposition)}</span></li>`)
    .join('');

  const symlinkNote = plan.symlinks.length > 0
    ? ` Frame's ${plan.symlinks.map(escapeHtml).join(' and ')} symlink${plan.symlinks.length > 1 ? 's are' : ' is'} removed` +
      (plan.restorableClaudeMd ? ', and your original CLAUDE.md is restored.' : '.')
    : '';
  backupNoteEl.innerHTML =
    `A copy of every file goes to <code>${escapeHtml(plan.backupDir)}</code> first.${symlinkNote}`;

  if (plan.canRun) {
    dirtyWarningEl.style.display = 'none';
    runBtn.style.display = '';
    runBtn.disabled = false;
    laterBtn.textContent = 'Later';
  } else {
    dirtyListEl.innerHTML = plan.dirty.map((f) => `<li>${escapeHtml(f)}</li>`).join('');
    dirtyWarningEl.style.display = '';
    runBtn.style.display = 'none';
    laterBtn.textContent = 'Close';
  }
}

async function runMigration() {
  if (!currentProjectPath || !currentPlan) return;

  runBtn.disabled = true;
  laterBtn.disabled = true;
  fileListEl.style.display = 'none';
  leadEl.style.display = 'none';
  progressEl.style.display = '';
  progressStepEl.textContent = 'Working…';

  let receipt;
  try {
    receipt = await ipcRenderer.invoke(IPC.RUN_LAYOUT_MIGRATION, { projectPath: currentProjectPath });
  } catch (err) {
    receipt = { ran: false, error: err.message };
  }

  progressEl.style.display = 'none';
  laterBtn.disabled = false;
  laterBtn.textContent = 'Close';
  runBtn.style.display = 'none';
  renderReceipt(receipt);
}

function renderReceipt(receipt) {
  receiptEl.style.display = '';

  if (!receipt || !receipt.ran) {
    const reason = receipt && receipt.error
      ? escapeHtml(receipt.error)
      : 'nothing was moved — the project may already use the .frame/ layout.';
    receiptEl.innerHTML = `<p>Migration did not run: ${reason}</p>`;
    return;
  }

  const lines = [
    `<p><strong>${receipt.moved.length}</strong> file${receipt.moved.length === 1 ? '' : 's'} moved into <code>.frame/</code>, ` +
    `<strong>${receipt.backedUp.length}</strong> backed up in <code>${escapeHtml(receipt.backupDir)}</code>.</p>`
  ];
  if (receipt.symlinksRemoved && receipt.symlinksRemoved.length > 0) {
    lines.push(`<p>Removed Frame's ${receipt.symlinksRemoved.map(escapeHtml).join(' and ')} symlink${receipt.symlinksRemoved.length > 1 ? 's' : ''}.</p>`);
  }
  if (receipt.claudeMdRestored) {
    lines.push('<p>Your original <code>CLAUDE.md</code> is back at the project root, exactly as it was.</p>');
  }
  lines.push(`<p>Sharing mode: <strong>${escapeHtml(receipt.sharingMode)}</strong>.</p>`);
  if (receipt.review && receipt.review.length > 0) {
    lines.push('<p>Worth a look:</p><ul>' +
      receipt.review.map((r) => `<li>${escapeHtml(r)}</li>`).join('') + '</ul>');
  }
  receiptEl.innerHTML = lines.join('');
}

function close() {
  if (!modalEl) return;
  if (currentProjectPath) deferred.add(currentProjectPath);
  modalEl.classList.remove('visible');
  currentPlan = null;
  currentProjectPath = null;
}

module.exports = { init, offer, close };
