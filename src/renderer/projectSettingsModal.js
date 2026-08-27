/**
 * Project Settings
 *
 * The open project's own settings, opened by the sliders button at the foot
 * of the sidebar rail. Everything here writes into that project's `.frame/`
 * and none of it outlives the project: the spec-driven flag and the git
 * sharing mode live in its `config.json`, and Remove Frame deletes the
 * directory holding both.
 *
 * Frame's machine-wide settings — privacy, updates — are a separate surface
 * (frameSettingsModal), reached from the sidebar header. They used to share
 * one modal, which put "Remove Frame from this project" a scroll away from
 * "Send anonymous usage stats" as though they were the same kind of choice.
 *
 * With no project open the rows go inert and say why rather than
 * disappearing: the setting still exists, there is just nothing to write to.
 * The launch-project row is the exception — it is hidden outright below two
 * projects, because there is no choice to make and nothing to explain.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const state = require('./state');
const specDrivenHint = require('./specDrivenHint');
const projectListUI = require('./projectListUI');
const settingsOverlay = require('./settingsOverlay');

let overlay = null;
let specDrivenToggleEl = null;
let specDrivenNoteEl = null;
let gitSharingSelectEl = null;
let gitSharingWarningEl = null;
let removeFrameBtnEl = null;
let removeFrameNoteEl = null;
let defaultProjectRowEl = null;
let defaultProjectDescEl = null;
let defaultProjectChipEl = null;
let makeDefaultBtnEl = null;

function init() {
  specDrivenToggleEl = document.getElementById('settings-spec-driven-toggle');
  specDrivenNoteEl = document.getElementById('settings-spec-driven-note');
  gitSharingSelectEl = document.getElementById('settings-git-sharing');
  gitSharingWarningEl = document.getElementById('settings-git-sharing-warning');
  removeFrameBtnEl = document.getElementById('settings-remove-frame');
  removeFrameNoteEl = document.getElementById('settings-remove-frame-note');
  defaultProjectRowEl = document.getElementById('settings-default-project-row');
  defaultProjectDescEl = document.getElementById('settings-default-project-desc');
  defaultProjectChipEl = document.getElementById('settings-default-project-chip');
  makeDefaultBtnEl = document.getElementById('settings-make-default');

  overlay = settingsOverlay.create('project-settings-overlay', syncFromProject);
  if (!overlay) return;

  // Spec-Driven Development: per-project flag in .frame/config.json, not a
  // user preference — main writes the config and AGENTS.md section. On
  // failure we snap the switch back so it never lies about the on-disk state.
  if (specDrivenToggleEl) {
    specDrivenToggleEl.addEventListener('change', async () => {
      const projectPath = state.getProjectPath();
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
          // turn it back on for this project.
          if (!wanted) await specDrivenHint.markDismissed(projectPath);
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

  // Git sharing: per-project, like the spec-driven flag. Main applies the
  // mode (exclude block, .frame/.gitignore, which settings file the hooks
  // live in) and answers with the state we re-render from — including the
  // warning when .frame/ is already committed.
  if (gitSharingSelectEl) {
    gitSharingSelectEl.addEventListener('change', async () => {
      const projectPath = state.getProjectPath();
      const mode = gitSharingSelectEl.value;
      if (!projectPath) return;
      gitSharingSelectEl.disabled = true;
      try {
        const result = await ipcRenderer.invoke(IPC.SET_GIT_SHARING, { projectPath, mode });
        renderGitSharing(result);
      } catch (err) {
        setGitSharingWarning('Could not change this setting: ' + err.message);
      } finally {
        gitSharingSelectEl.disabled = false;
      }
    });
  }

  // Remove Frame: destructive and irreversible, so it confirms first and
  // says exactly what will be deleted. Main does the work and answers with a
  // list; the note reports it rather than a bare "done".
  if (removeFrameBtnEl) {
    removeFrameBtnEl.addEventListener('click', async () => {
      const projectPath = state.getProjectPath();
      if (!projectPath) {
        setRemoveFrameNote('Open a project first.');
        return;
      }
      const confirmed = window.confirm(
        'Remove Frame from this project?\n\n' +
        'This deletes .frame/ (including your specs, notes and tasks) and ' +
        '.claude/rules/frame.md, takes Frame\'s hook entries out of ' +
        '.claude/settings.json and settings.local.json — deleting either file ' +
        'if Frame\'s entries were all it held — takes Frame\'s block out of the ' +
        'pre-commit hook, and removes its block from .git/info/exclude. ' +
        'Anything you wrote is left where it is.\n\n' +
        'This cannot be undone.'
      );
      if (!confirmed) return;

      removeFrameBtnEl.disabled = true;
      try {
        const result = await ipcRenderer.invoke(IPC.REMOVE_FRAME_FROM_PROJECT, projectPath);
        if (result && result.errors && result.errors.length > 0) {
          setRemoveFrameNote('Removed, with problems: ' + result.errors.join('; '));
        } else {
          setRemoveFrameNote('Removed: ' + ((result && result.removed) || []).join(', '));
        }
        // The project is no longer a Frame project: say so, or the spec
        // panel keeps offering to write into a .frame/ that is gone.
        state.noteFrameRemoved(projectPath);
        await syncGitSharing();
        await syncSpecDrivenToggle();
      } catch (err) {
        setRemoveFrameNote('Could not remove Frame: ' + err.message);
      } finally {
        removeFrameBtnEl.disabled = false;
      }
    });
  }

  // Make Default: move this project to the front of the workspace list, which
  // is the whole of what "default" means (see projectListUI.isDefaultProject).
  if (makeDefaultBtnEl) {
    makeDefaultBtnEl.addEventListener('click', () => {
      const projectPath = state.getProjectPath();
      if (!projectPath) return;
      if (projectListUI.setDefaultProject(projectPath)) {
        // Re-paint rather than just hiding the button: the row now has
        // something different to say, and saying it is the confirmation.
        syncDefaultProject();
      }
    });
  }
}

async function syncFromProject() {
  syncDefaultProject();
  await syncSpecDrivenToggle();
  await syncGitSharing();
}

/**
 * The launch-project row. It is hidden outright below two projects: with one
 * project there is no choice to make, and a control that can only confirm what
 * is already true is furniture.
 *
 * Above that it has two states. Already first: the button is replaced by a
 * standing "Default" chip and the copy switches to the settled reading —
 * nothing else in Frame tells you which project launch will pick, so the row
 * has to say it plainly. Not first: the button is offered, and the copy asks.
 */
function syncDefaultProject() {
  if (!defaultProjectRowEl) return;
  const projectPath = state.getProjectPath();
  const projects = projectListUI.getProjects() || [];

  if (!projectPath || projects.length < 2) {
    defaultProjectRowEl.style.display = 'none';
    return;
  }
  defaultProjectRowEl.style.display = '';

  const isDefault = projectListUI.isDefaultProject(projectPath);
  if (makeDefaultBtnEl) makeDefaultBtnEl.style.display = isDefault ? 'none' : '';
  if (defaultProjectChipEl) defaultProjectChipEl.style.display = isDefault ? '' : 'none';
  if (defaultProjectDescEl) {
    defaultProjectDescEl.textContent = isDefault
      ? 'This project is your default. Frame opens it every time it launches.'
      : 'Frame opens your default project when it launches. Make this the default to land here every time.';
  }
}

/**
 * Reflect the current project's features.specDriven flag. With no project
 * open (or a folder that isn't a Frame project yet) there is nothing to
 * write, so the switch is disabled and says why.
 */
async function syncSpecDrivenToggle() {
  if (!specDrivenToggleEl) return;
  const projectPath = state.getProjectPath();
  if (!projectPath) {
    specDrivenToggleEl.checked = false;
    specDrivenToggleEl.disabled = true;
    setSpecDrivenNote('Open a project to change this — the setting lives in its .frame/config.json.');
    return;
  }
  try {
    const enabled = await ipcRenderer.invoke(IPC.IS_SPEC_DRIVEN_ENABLED, projectPath);
    specDrivenToggleEl.checked = enabled === true;
    specDrivenToggleEl.disabled = false;
    setSpecDrivenNote(null);
  } catch (err) {
    specDrivenToggleEl.disabled = true;
    setSpecDrivenNote('Could not read this project’s Frame config.');
  }
}

/**
 * Paint the sharing row from main's state object. `error` means the project
 * isn't a Frame project (or none is open) — the control goes inert rather
 * than showing a mode the project doesn't have.
 */
function renderGitSharing(stateObj) {
  if (!gitSharingSelectEl) return;
  if (!stateObj || stateObj.error) {
    gitSharingSelectEl.disabled = true;
    setGitSharingWarning(
      stateObj && stateObj.error === 'not a Frame project'
        ? 'Initialize this project with Frame to choose how its files relate to git.'
        : null
    );
    return;
  }
  gitSharingSelectEl.disabled = false;
  gitSharingSelectEl.value = stateObj.mode;
  setGitSharingWarning(stateObj.warning);
}

async function syncGitSharing() {
  if (!gitSharingSelectEl) return;
  const projectPath = state.getProjectPath();
  if (!projectPath) {
    renderGitSharing({ error: 'no project' });
    return;
  }
  try {
    renderGitSharing(await ipcRenderer.invoke(IPC.GET_GIT_SHARING_STATE, projectPath));
  } catch (err) {
    renderGitSharing({ error: err.message });
  }
}

function setRemoveFrameNote(message) {
  if (!removeFrameNoteEl) return;
  removeFrameNoteEl.textContent = message || '';
  removeFrameNoteEl.style.display = message ? '' : 'none';
}

function setGitSharingWarning(message) {
  if (!gitSharingWarningEl) return;
  gitSharingWarningEl.textContent = message || '';
  gitSharingWarningEl.style.display = message ? '' : 'none';
}

function setSpecDrivenNote(message) {
  if (!specDrivenNoteEl) return;
  specDrivenNoteEl.textContent = message || '';
  specDrivenNoteEl.style.display = message ? '' : 'none';
}

module.exports = {
  init,
  open: () => overlay && overlay.open(),
  close: () => overlay && overlay.close(),
  toggle: () => overlay && overlay.toggle()
};
