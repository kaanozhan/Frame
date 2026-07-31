/**
 * Project Settings Modal
 *
 * Everything project-scoped lives here, opened from the project row's gear:
 * the Sharing section (Git Sharing per the behaviour matrix), the Workflow
 * section (Spec-Driven Development — populated when the toggle relocates
 * from App Settings), and "Remove from Frame". App Settings keeps only the
 * genuinely app-wide switches.
 *
 * For a project that isn't a Frame project the modal shows only the header
 * and Remove — there is no config to hold a per-project setting yet.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const specDrivenHint = require('./specDrivenHint');

const UNTRACK_COMMAND = 'git rm -r --cached .frame';

let overlayEl = null;
let nameEl = null;
let pathEl = null;
let workflowSectionEl = null;
let specDrivenToggleEl = null;
let specDrivenNoteEl = null;
let sharingSectionEl = null;
let sharingToggleEl = null;
let sharingDescEl = null;
let sharingWarningEl = null;
let copyBtnEl = null;
let removeBtnEl = null;

let isOpen = false;
// The project the modal is showing: { path, name, isFrameProject }. The gear
// exists on every row, so this is not necessarily the active project.
let currentProject = null;

function init() {
  overlayEl = document.getElementById('project-settings-overlay');
  nameEl = document.getElementById('project-settings-name');
  pathEl = document.getElementById('project-settings-path');
  workflowSectionEl = document.getElementById('project-settings-workflow-section');
  specDrivenToggleEl = document.getElementById('project-settings-spec-driven-toggle');
  specDrivenNoteEl = document.getElementById('project-settings-spec-driven-note');
  sharingSectionEl = document.getElementById('project-settings-sharing-section');
  sharingToggleEl = document.getElementById('project-settings-sharing-toggle');
  sharingDescEl = document.getElementById('project-settings-sharing-desc');
  sharingWarningEl = document.getElementById('project-settings-sharing-warning');
  copyBtnEl = document.getElementById('project-settings-copy-untrack');
  removeBtnEl = document.getElementById('project-settings-remove-btn');

  if (!overlayEl || !sharingToggleEl) {
    console.error('Project Settings modal: required elements not found');
    return;
  }

  sharingToggleEl.addEventListener('change', onSharingToggle);

  // Spec-Driven Development: per-project flag in .frame/config.json, not a
  // user preference. Main writes the flag and nothing else — no instruction
  // file is edited either way; the launch preamble reads the flag fresh and
  // decides what the agent is told. On failure we snap the switch back so it
  // never lies about the on-disk state. (Moved verbatim from App Settings.)
  if (specDrivenToggleEl) {
    specDrivenToggleEl.addEventListener('change', async () => {
      const projectPath = currentProject && currentProject.path;
      const wanted = specDrivenToggleEl.checked;
      if (!projectPath) {
        specDrivenToggleEl.checked = !wanted;
        return;
      }
      specDrivenToggleEl.disabled = true;
      try {
        const result = await ipcRenderer.invoke(IPC.SET_SPEC_DRIVEN, {
          projectPath,
          enabled: wanted
        });
        if (!result || !result.success) {
          specDrivenToggleEl.checked = !wanted;
          setSpecDrivenNote(
            'Could not change this setting: ' + ((result && result.error) || 'unknown error')
          );
        } else {
          setSpecDrivenNote(null);
          // Turning it off here is a deliberate choice — stop offering to
          // turn it back on, but only for this session. The project may stay
          // off for weeks, and then the reminder is worth having again; only
          // the hint's own "Don't show again" silences it for good.
          if (!wanted) specDrivenHint.suppressForSession(projectPath);
          specDrivenHint.refresh();
        }
      } catch (err) {
        specDrivenToggleEl.checked = !wanted;
        setSpecDrivenNote('Could not change this setting: ' + err.message);
      } finally {
        specDrivenToggleEl.disabled = false;
      }
    });
  }

  if (copyBtnEl) {
    copyBtnEl.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(UNTRACK_COMMAND);
        copyBtnEl.textContent = 'Copied';
        setTimeout(() => { copyBtnEl.textContent = 'Copy command'; }, 1500);
      } catch (_) {
        copyBtnEl.textContent = UNTRACK_COMMAND;
      }
    });
  }

  if (removeBtnEl) {
    removeBtnEl.addEventListener('click', () => {
      const project = currentProject;
      close();
      if (project) {
        // Lazy require: projectListUI's gear opens this modal, so a
        // top-level require in both directions would cycle.
        require('./projectListUI').confirmRemoveProject(project.path, project.name);
      }
    });
  }

  overlayEl.addEventListener('mousedown', (e) => {
    if (e.target === overlayEl) close();
  });

  document.querySelectorAll('[data-project-settings-close]').forEach((btn) => {
    btn.addEventListener('click', () => close());
  });

  document.addEventListener('keydown', (e) => {
    if (isOpen && e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
}

/**
 * Toggle change → SET_GIT_SHARING, the single write path shared with the
 * sharing hint. Snapped back on failure so the switch never lies about the
 * on-disk state (the settingsModal spec-driven precedent).
 */
async function onSharingToggle() {
  if (!currentProject) return;
  const mode = sharingToggleEl.checked ? 'repo' : 'local';
  sharingToggleEl.disabled = true;
  try {
    const result = await ipcRenderer.invoke(IPC.SET_GIT_SHARING, {
      projectPath: currentProject.path,
      mode
    });
    if (result && result.success && result.state) {
      renderSharingState(result.state);
    } else {
      sharingToggleEl.checked = mode !== 'repo';
      sharingToggleEl.disabled = false;
    }
  } catch (_) {
    sharingToggleEl.checked = mode !== 'repo';
    sharingToggleEl.disabled = false;
  }
}

/**
 * Render the Sharing section from the behaviour matrix. `effective` carries
 * D3 (tracked → repo whatever was declared); the S4 warning shows exactly
 * when a `local` declaration cannot be honoured because `.frame/` is tracked.
 */
function renderSharingState(state) {
  if (!state || !state.isRepo) {
    sharingToggleEl.checked = false;
    sharingToggleEl.disabled = true;
    sharingDescEl.textContent = 'Not a git repository — there is nothing to share or hide.';
    sharingWarningEl.style.display = 'none';
    return;
  }

  const conflicted = state.declared === 'local' && state.tracked;
  sharingToggleEl.checked = state.effective === 'repo';
  sharingToggleEl.disabled = false;
  sharingWarningEl.style.display = conflicted ? '' : 'none';

  if (conflicted) {
    sharingDescEl.textContent = '';
  } else if (state.effective === 'repo') {
    sharingDescEl.textContent = state.tracked
      ? 'Frame’s context is shared with everyone who clones this repository. Machine-local files stay out.'
      : '.frame/ now appears in git status — commit it to share it. Machine-local files stay out.';
  } else {
    sharingDescEl.textContent = '.frame/ is hidden from git on this machine.';
  }
}

/**
 * Open for a project row: { path, name, isFrameProject }. Non-Frame projects
 * get header + Remove only.
 */
function open(project) {
  if (!project || !project.path) return;
  currentProject = project;

  if (nameEl) nameEl.textContent = project.name || project.path.split('/').pop();
  if (pathEl) pathEl.textContent = project.path;

  const isFrame = project.isFrameProject === true;
  if (workflowSectionEl) workflowSectionEl.style.display = isFrame ? '' : 'none';
  if (sharingSectionEl) sharingSectionEl.style.display = isFrame ? '' : 'none';

  if (isFrame) {
    syncSpecDrivenToggle(project.path);
    sharingToggleEl.disabled = true;
    sharingDescEl.textContent = '';
    sharingWarningEl.style.display = 'none';
    ipcRenderer
      .invoke(IPC.GET_GIT_SHARING_STATE, project.path)
      .then((state) => {
        if (isOpen && currentProject && currentProject.path === project.path) {
          renderSharingState(state);
        }
      })
      .catch(() => {
        sharingDescEl.textContent = 'Could not read this project’s sharing state.';
      });
  }

  isOpen = true;
  overlayEl.classList.add('visible');
  // The spec-driven notice points here, so it has nothing to say while this
  // is open — and it lives below modal z-indexes, so left alone it would sit
  // behind the overlay.
  specDrivenHint.suspend();
}

/**
 * Reflect this project's features.specDriven flag. The modal only shows the
 * Workflow section for Frame projects, so a missing config reads as an error
 * rather than an empty state.
 */
async function syncSpecDrivenToggle(projectPath) {
  if (!specDrivenToggleEl) return;
  specDrivenToggleEl.disabled = true;
  try {
    const enabled = await ipcRenderer.invoke(IPC.IS_SPEC_DRIVEN_ENABLED, projectPath);
    if (!currentProject || currentProject.path !== projectPath) return;
    specDrivenToggleEl.checked = enabled === true;
    specDrivenToggleEl.disabled = false;
    setSpecDrivenNote(null);
  } catch (_) {
    specDrivenToggleEl.disabled = true;
    setSpecDrivenNote('Could not read this project’s Frame config.');
  }
}

function setSpecDrivenNote(message) {
  if (!specDrivenNoteEl) return;
  specDrivenNoteEl.textContent = message || '';
  specDrivenNoteEl.style.display = message ? '' : 'none';
}

function close() {
  if (!isOpen) return;
  isOpen = false;
  currentProject = null;
  overlayEl.classList.remove('visible');
  // Back to the corner if the active project still qualifies — turning the
  // feature on in here, or off (session-suppressed), both settle it.
  specDrivenHint.resume();
  if (typeof window.terminalFocus === 'function') window.terminalFocus();
}

module.exports = { init, open, close };
