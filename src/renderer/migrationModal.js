/**
 * Migration Decision Modal
 *
 * The move into `.frame/` no longer has a modal — it happens on project open
 * and reports itself on the banner. What is left here is the half that is
 * genuinely the user's call: `AGENTS.md` is their file, and rewriting its
 * prose to point at the new paths needs a yes.
 *
 * Offered from state.js on every project, not only a legacy one, because a
 * decision outlives the migration that created it: the file whose prose is
 * stale has already moved into `.frame/` by the time anyone is asked.
 *
 * Three states in one modal: the decision (which lines change, and what Frame
 * will not touch), progress while it applies, and the receipt. "Later" writes
 * nothing to the project at all — it keeps working, its prose just keeps
 * naming the old paths — and it is permanent: a "no" that came back every
 * time the app restarted would be the endless asking this spec exists to
 * end. Project Settings is the way back in.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const { escapeHtml } = require('./htmlUtils');

let modalEl = null;
let fileListEl = null;
let leadEl = null;
let backupNoteEl = null;
let progressEl = null;
let progressStepEl = null;
let receiptEl = null;
let laterBtn = null;
let runBtn = null;

let currentProjectPath = null;
let currentDecisions = null;
let answered = false;

// Persisted in user settings, not in the project's config: the deferral is a
// person's answer on a machine, and `.frame/config.json` is committed in
// `repo` mode — a teammate would inherit the "no" and never be offered the
// fix.
const DEFERRED_KEY = 'migrationDecisionsDeferred';

function init() {
  modalEl = document.getElementById('migration-modal');
  if (!modalEl) return;

  fileListEl = document.getElementById('migration-file-list');
  leadEl = document.getElementById('migration-lead');
  backupNoteEl = document.getElementById('migration-backup-note');
  progressEl = document.getElementById('migration-progress');
  progressStepEl = document.getElementById('migration-progress-step');
  receiptEl = document.getElementById('migration-receipt');
  laterBtn = document.getElementById('migration-later');
  runBtn = document.getElementById('migration-run');

  laterBtn.addEventListener('click', close);
  document.getElementById('migration-modal-close').addEventListener('click', close);
  runBtn.addEventListener('click', applyDecisions);
}

async function readDeferred() {
  try {
    const stored = await ipcRenderer.invoke(IPC.GET_USER_SETTING, DEFERRED_KEY);
    return Array.isArray(stored) ? stored.slice() : [];
  } catch (err) {
    return [];
  }
}

async function markDeferred(projectPath) {
  if (!projectPath) return;
  try {
    const list = await readDeferred();
    if (list.includes(projectPath)) return;
    list.push(projectPath);
    await ipcRenderer.invoke(IPC.SET_USER_SETTING, DEFERRED_KEY, list);
  } catch (err) {
    console.error('migrationModal: could not persist the deferral', err);
  }
}

/** Does this project still have something to be asked about? */
async function hasPendingDecisions(projectPath) {
  if (!projectPath) return false;
  try {
    const decisions = await ipcRenderer.invoke(IPC.GET_MIGRATION_DECISIONS, projectPath);
    return Array.isArray(decisions) && decisions.length > 0;
  } catch (err) {
    return false;
  }
}

/**
 * Offer whatever decisions this project still carries. Silent when there are
 * none, when the user has deferred this project, or when main answers with
 * nothing — which is every project that was never on the old layout.
 *
 * `force` is the way back in from Project Settings: it bypasses the deferral
 * without clearing it, so a user who opens the question and closes it again
 * has not accidentally re-armed the prompt.
 */
async function offer(projectPath, { force = false } = {}) {
  if (!modalEl || !projectPath) return;
  if (!force && (await readDeferred()).includes(projectPath)) return;

  let decisions;
  try {
    decisions = await ipcRenderer.invoke(IPC.GET_MIGRATION_DECISIONS, projectPath);
  } catch (err) {
    return; // never block opening a project over this
  }
  if (!Array.isArray(decisions) || decisions.length === 0) return;

  currentProjectPath = projectPath;
  currentDecisions = decisions;
  answered = false;
  render(decisions);
  modalEl.classList.add('visible');
}

function render(decisions) {
  receiptEl.style.display = 'none';
  progressEl.style.display = 'none';
  fileListEl.style.display = '';
  leadEl.style.display = '';
  backupNoteEl.style.display = '';
  runBtn.style.display = '';
  runBtn.disabled = false;
  laterBtn.disabled = false;
  laterBtn.textContent = 'Later';

  const prose = decisions.find((d) => d.kind === 'agents-prose');
  const edits = (prose && prose.edits) || [];

  const items = edits.map((e) =>
    `<li><span class="file-icon">&#9998;</span> <code>${escapeHtml(e.from)}</code>` +
    `<span class="file-desc">becomes <code>${escapeHtml(e.to)}</code></span></li>`);
  if (prose && prose.symlinkNote) {
    items.push('<li><span class="file-icon">&#9998;</span> The <code>CLAUDE.md</code> symlink note' +
      '<span class="file-desc">becomes a note pointing at <code>.claude/rules/frame.md</code></span></li>');
  }
  fileListEl.innerHTML = items.join('');

  // Said out loud before the click, not after: a section Frame cannot prove
  // it wrote is never rewritten.
  const review = (prose && prose.review) || [];
  const untouched = review.length > 0
    ? ` Anything Frame did not write is left alone — including ${review.map((r) => `<code>${escapeHtml(r)}</code>`).join(', ')}.`
    : ' Anything Frame did not write is left alone.';
  backupNoteEl.innerHTML =
    `Only the lines above change. Your own text, headings and notes stay exactly as they are.${untouched}`;
}

async function applyDecisions() {
  if (!currentProjectPath || !currentDecisions) return;

  runBtn.disabled = true;
  laterBtn.disabled = true;
  fileListEl.style.display = 'none';
  leadEl.style.display = 'none';
  backupNoteEl.style.display = 'none';
  progressEl.style.display = '';
  progressStepEl.textContent = 'Updating AGENTS.md…';

  let receipt;
  try {
    receipt = await ipcRenderer.invoke(IPC.APPLY_MIGRATION_DECISIONS, {
      projectPath: currentProjectPath,
      decisions: currentDecisions
    });
  } catch (err) {
    receipt = { ran: false, error: err.message };
  }

  answered = Boolean(receipt && receipt.ran);
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
      : 'none of the lines Frame knows about were there, so nothing was changed.';
    receiptEl.innerHTML = `<p><code>AGENTS.md</code> was left as it is: ${reason}</p>`;
  } else {
    receiptEl.innerHTML = '<p><code>AGENTS.md</code> now points at <code>.frame/</code>, ' +
      'and the copy Claude Code reads has been refreshed.</p>';
  }

  if (receipt && receipt.review && receipt.review.length > 0) {
    receiptEl.innerHTML += '<p>Worth a look:</p><ul>' +
      receipt.review.map((r) => `<li>${escapeHtml(r)}</li>`).join('') + '</ul>';
  }
}

function close() {
  if (!modalEl) return;
  // Closing without answering defers: the modal always presents a decision,
  // so declining to answer it is itself an answer — and a permanent one,
  // reachable again from Project Settings. Closing *after* answering records
  // nothing; the decision has emptied itself and cannot be offered again.
  if (currentProjectPath && !answered) markDeferred(currentProjectPath);
  modalEl.classList.remove('visible');
  currentDecisions = null;
  currentProjectPath = null;
}

module.exports = { init, offer, close, hasPendingDecisions };
