/**
 * Projects Section
 *
 * The Projects rail view: a thin wrapper over the project panel, which
 * `projectListUI` renders and owns. The active project is shown by the
 * switcher above.
 *
 * It used to pin an "Add new Project" CTA under the panel, shown only while
 * no project was selected. That went on 2026-09-16: the first-run screen and
 * Home's no-project state both carry the three ways into a project now, and a
 * third, differently-worded answer in the sidebar was one too many. What is
 * left in its place is the opposite move — with no project the panel has
 * nothing to show at all, so the sidebar collapses to its rail and gives the
 * width back to the screen that is actually asking the question.
 */

const projectListUI = require('./projectListUI');
const sidebarResize = require('./sidebarResize');
const state = require('./state');

// Did we collapse the sidebar ourselves? Only then may we re-open it — a user
// who collapsed it by hand keeps it collapsed when their project arrives.
let collapsedByUs = false;

/**
 * Move keyboard focus into the project list. Used by the "Focus Project List"
 * command.
 */
function focusList() {
  projectListUI.focus();
}

function init() {
  // Follows the project both ways: removing the last one hands projectListUI
  // a null path, and the sidebar folds away again.
  state.onProjectChange(syncSidebar);
  syncSidebar();
}

/**
 * No project means an empty panel, so collapse to the rail. Never persisted:
 * this is the app's rule, not the user's preference (sidebarResize's
 * `{ persist: false }`), and it is undone only if we were the ones who
 * applied it.
 */
function syncSidebar() {
  const hasProject = !!state.getProjectPath();
  if (!hasProject) {
    if (sidebarResize.isVisible()) {
      sidebarResize.hide({ persist: false });
      collapsedByUs = true;
    }
    return;
  }
  if (collapsedByUs) {
    sidebarResize.show({ persist: false });
    collapsedByUs = false;
  }
}

module.exports = {
  init,
  focusList
};
