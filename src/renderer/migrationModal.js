/**
 * Layout Migration Modal
 *
 * Shown when the user selects a project that still uses the pre-overlay
 * layout. The startup sweep never opens this — it runs silently because
 * nobody is waiting on it. Reaching here means the sweep did not get to this
 * project (added since, failed, or deferred), so the user has just selected it
 * and is waiting for it, which is when blocking UI is earned (D13).
 *
 * Three end states, driven entirely by MIGRATION_PROGRESS:
 *   migrated — the modal closes and the project opens. No receipt: the user
 *              watched it happen.
 *   deferred — the files holding it up, and what to do about them. This is the
 *              one place a D4 deferral is explained, because here it is
 *              blocking someone right now and there is a concrete action.
 *   failed   — the real error, the sentence that stops the panic (nothing was
 *              lost, the backup has it), and Try again.
 *
 * Reuses the `settings-modal` vocabulary rather than inventing a dialog.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');

const CLOSE_DELAY_MS = 650;

const DISPOSITION_TEXT = {
  move: 'moved',
  'delete-identical': 'already in .frame/',
  'backup-conflict': 'kept the .frame/ version'
};

let overlayEl = null;
let titleEl = null;
let subtitleEl = null;
let artifactsEl = null;
let messageEl = null;
let actionsEl = null;
let retryEl = null;
let closeEl = null;

let currentProject = null;

function init() {
  overlayEl = document.getElementById('migration-overlay');
  titleEl = document.getElementById('migration-title');
  subtitleEl = document.getElementById('migration-subtitle');
  artifactsEl = document.getElementById('migration-artifacts');
  messageEl = document.getElementById('migration-message');
  actionsEl = document.getElementById('migration-actions');
  retryEl = document.getElementById('migration-retry');
  closeEl = overlayEl ? overlayEl.querySelector('[data-migration-close]') : null;

  if (!overlayEl || !artifactsEl) {
    console.error('Migration modal: required elements not found');
    return;
  }

  if (closeEl) closeEl.addEventListener('click', close);
  if (retryEl) {
    retryEl.addEventListener('click', () => {
      if (!currentProject) return;
      ipcRenderer.send(IPC.RETRY_MIGRATION, { projectPath: currentProject });
    });
  }

  ipcRenderer.on(IPC.MIGRATION_PROGRESS, (event, payload) => {
    if (!payload) return;
    if (payload.phase === 'start') return onStart(payload);
    if (payload.phase === 'artifact') return onArtifact(payload);
    if (payload.phase === 'done') return onDone(payload);
  });
}

function onStart(payload) {
  currentProject = payload.projectPath;
  artifactsEl.innerHTML = '';
  messageEl.style.display = 'none';
  messageEl.innerHTML = '';
  actionsEl.style.display = 'none';
  if (closeEl) closeEl.style.display = 'none';

  titleEl.textContent = 'Updating project layout';
  subtitleEl.textContent = `Moving ${payload.name || 'this project'}'s Frame files into .frame/`;
  overlayEl.classList.add('visible');
}

function onArtifact(payload) {
  const row = document.createElement('li');
  row.className = 'migration-artifact';

  const name = document.createElement('span');
  name.className = 'migration-artifact-name';
  name.textContent = payload.rel;

  const note = document.createElement('span');
  note.className = 'migration-artifact-note';
  note.textContent = DISPOSITION_TEXT[payload.disposition] || payload.disposition;

  row.append(name, note);
  artifactsEl.appendChild(row);
}

function onDone(payload) {
  if (payload.status === 'migrated') {
    // Nothing to read: the user watched it happen and the project is open.
    setTimeout(close, CLOSE_DELAY_MS);
    return;
  }

  if (payload.status === 'skipped') {
    close();
    return;
  }

  if (closeEl) closeEl.style.display = '';

  if (payload.status === 'deferred') {
    const files = Array.isArray(payload.dirty) ? payload.dirty : [];
    titleEl.textContent = 'Project layout not updated yet';
    subtitleEl.textContent = '';
    setMessage([
      `Frame can't update the layout while ${listFiles(files)} ${files.length === 1 ? 'has' : 'have'} uncommitted changes — moving ${files.length === 1 ? 'it' : 'them'} now would leave your unfinished work in a file you didn't choose.`,
      'Commit or stash the changes, then reopen the project.'
    ]);
    return;
  }

  titleEl.textContent = 'Could not update the project layout';
  subtitleEl.textContent = '';
  setMessage([
    payload.error || 'The migration stopped before it finished.',
    `Nothing was lost: a copy of everything removed is in ${payload.backupDir || '.frame/migration-backup/'}.`
  ]);
  actionsEl.style.display = '';
}

/** Plain text only — a file name and an error message are both user data. */
function setMessage(paragraphs) {
  messageEl.innerHTML = '';
  for (const text of paragraphs) {
    const p = document.createElement('p');
    p.textContent = text;
    messageEl.appendChild(p);
  }
  messageEl.style.display = '';
}

function listFiles(files) {
  if (!files.length) return 'a file';
  if (files.length === 1) return files[0];
  return `${files.slice(0, -1).join(', ')} and ${files[files.length - 1]}`;
}

function close() {
  if (!overlayEl) return;
  overlayEl.classList.remove('visible');
  currentProject = null;
}

module.exports = { init, close };
