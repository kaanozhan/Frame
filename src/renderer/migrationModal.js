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
 * nothing at all — the project keeps working, its prose just keeps naming the
 * old paths.
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
// One offer per project per session: a user who clicks Later is not asked
// again until they reopen the app.
const deferred = new Set();

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

/**
 * Offer whatever decisions this project still carries. Silent when there are
 * none, when the user already said Later this session, or when main answers
 * with nothing — which is every project that was never on the old layout.
 */
async function offer(projectPath) {
  if (!modalEl || !projectPath || deferred.has(projectPath)) return;

  let decisions;
  try {
    decisions = await ipcRenderer.invoke(IPC.GET_MIGRATION_DECISIONS, projectPath);
  } catch (err) {
    return; // never block opening a project over this
  }
  if (!Array.isArray(decisions) || decisions.length === 0) return;

  currentProjectPath = projectPath;
  currentDecisions = decisions;
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
  // Every close defers: the modal always presents a decision, so declining to
  // answer it is itself an answer for this session.
  if (currentProjectPath) deferred.add(currentProjectPath);
  modalEl.classList.remove('visible');
  currentDecisions = null;
  currentProjectPath = null;
}

module.exports = { init, offer, close };
