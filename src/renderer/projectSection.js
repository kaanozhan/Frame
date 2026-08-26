/**
 * Projects Section
 *
 * The Projects rail view. It is a thin wrapper over the workspace panel
 * (rendered/owned by `projectListUI`) plus the "Add new Project" button
 * pinned below it. The active project is shown by the switcher above.
 *
 * That button belongs to the empty sidebar only. With a project selected the
 * switcher already carries "+ Add a project…", and the panel below it is that
 * project's own navigation — an accent-filled CTA at its foot is the loudest
 * thing in the sidebar, pulling toward the one action the user is demonstrably
 * not taking. With no project there is nothing else to click, so it is the
 * whole point of the view.
 */

const openProjectModal = require('./openProjectModal');
const projectListUI = require('./projectListUI');
const state = require('./state');

let section = null;

/**
 * Move keyboard focus into the project list. Used by the "Focus Project List"
 * command.
 */
function focusList() {
  projectListUI.focus();
}

function init() {
  // The old #project-section wrapper is gone (project-dropdown spec); only
  // the bottom-pinned Add button remains to wire.
  //
  // The `else` is not defensive noise: during the project-rail spec this
  // init early-returned on a container that had been removed, silently
  // leaving Add new Project dead until a user found it. A control that
  // fails to bind must say so (audit-q3-ux-error-feedback discipline).
  const addBtn = document.getElementById('project-add-btn');
  if (addBtn) {
    addBtn.addEventListener('click', () => openProjectModal.open());

    // Follows the project, both ways: removing the last project hands
    // projectListUI a null path, and the button has to come back — that is
    // the state where it is the only way forward.
    const syncAddBtn = () => {
      addBtn.style.display = state.getProjectPath() ? 'none' : '';
    };
    state.onProjectChange(syncAddBtn);
    syncAddBtn();
  } else {
    console.error('projectSection: #project-add-btn not found — Add new Project will not work');
  }
}

module.exports = {
  init,
  focusList
};
