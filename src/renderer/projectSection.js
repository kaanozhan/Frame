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
  section = document.getElementById('project-section');
  if (!section) return;

  require('./supervisor-ui/sidebarEntry').mount(section); // supervisor-mod

  const addBtn = document.getElementById('project-add-btn');
  if (addBtn) addBtn.addEventListener('click', () => openProjectModal.open());
}

module.exports = {
  init,
  focusList
};
