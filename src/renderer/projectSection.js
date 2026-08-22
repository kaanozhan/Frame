/**
 * Projects Section
 *
 * The Projects rail view. It is a thin wrapper: a "Projects" header above the
 * workspace list (rendered/owned by `projectListUI`, drag-to-reorder) and an
 * "Add new Project" button below that opens the Open Project modal. The active
 * project is shown by list highlight (no separate summary row).
 */

const openProjectModal = require('./openProjectModal');
const projectListUI = require('./projectListUI');

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
  } else {
    console.error('projectSection: #project-add-btn not found — Add new Project will not work');
  }
}

module.exports = {
  init,
  focusList
};
