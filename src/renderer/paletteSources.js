/**
 * Palette Sources (palette-jump spec)
 *
 * Registers the command palette's dynamic jump targets as registry
 * providers: projects, terminals (across projects), the current project's
 * specs, and the workspace views. Items are computed at search time from
 * live state; the spec list is the one push-fed cache (SPEC_DATA), because
 * providers must stay synchronous.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const registry = require('./commandRegistry');
const state = require('./state');
const laneStatus = require('./laneStatus');

let multiTerminalUI = null;
let specs = []; // current project's specs, kept fresh by SPEC_DATA pushes

function basename(p) {
  return p ? (p.split('/').pop() || p.split('\\').pop() || p) : '';
}

function init(ui) {
  multiTerminalUI = ui;

  // Spec cache: the watcher pushes on project switch and file changes; one
  // warm fetch covers the window before the first push.
  ipcRenderer.on(IPC.SPEC_DATA, (event, { specs: incoming }) => {
    specs = incoming || [];
  });
  warmSpecs();
  state.onProjectChange(() => warmSpecs());

  registry.registerProvider(projectItems);
  registry.registerProvider(terminalItems);
  registry.registerProvider(specItems);
  registry.registerProvider(viewItems);
}

async function warmSpecs() {
  const projectPath = state.getProjectPath();
  if (!projectPath) { specs = []; return; }
  try {
    const fresh = await ipcRenderer.invoke(IPC.LIST_SPECS, projectPath);
    if (Array.isArray(fresh)) specs = fresh;
  } catch (_) { /* SPEC_DATA push will cover it */ }
}

// ─── Providers ──────────────────────────────────────────────

function projectItems() {
  const projectListUI = require('./projectListUI');
  const current = state.getProjectPath();
  return projectListUI.getProjects().map((p) => ({
    id: `jump.project:${p.path}`,
    title: p.name + (p.path === current ? ' (current)' : ''),
    category: 'Project',
    run: () => projectListUI.selectProject(p.path)
  }));
}

function terminalItems() {
  if (!multiTerminalUI) return [];
  let states = [];
  try {
    states = multiTerminalUI.getManager().getTerminalStates(true);
  } catch (_) { return []; }
  const current = state.getProjectPath();
  return states.map((t) => {
    const { agentName } = laneStatus.getStatus(t.id);
    const name = t.customName || t.name;
    const where = t.projectPath && t.projectPath !== current ? ` — ${basename(t.projectPath)}` : '';
    return {
      id: `jump.terminal:${t.id}`,
      title: `${name}${agentName ? ` · ${agentName}` : ''}${where}`,
      category: 'Terminal',
      run: () => {
        if (t.projectPath && t.projectPath !== state.getProjectPath()) {
          state.setProjectPath(t.projectPath);
        }
        multiTerminalUI.enterLane(t.id);
      }
    };
  });
}

function specItems() {
  if (!state.getProjectPath()) return [];
  return specs.map((s) => {
    const title = s.title || s.slug;
    return {
      id: `jump.spec:${s.slug}`,
      // Free-text spec titles can be paragraphs — keep palette rows sane
      title: title.length > 80 ? `${title.slice(0, 77)}…` : title,
      category: 'Spec',
      run: () => require('./specSection').open(s.slug)
    };
  });
}

function viewItems() {
  if (!multiTerminalUI || !state.getProjectPath()) return [];
  const ui = multiTerminalUI;
  const views = [
    ['terminals', 'Go to Terminals', () => ui.showTerminals()],
    ['specs', 'Go to Specs', () => ui.showSpecs()],
    ['tasks', 'Go to Tasks', () => ui.showTasksBoard()],
    ['decisions', 'Go to Decisions', () => ui.showDecisions()],
    ['structure', 'Open Structure Map', () => ui.showStructureMap()],
    ['github', 'Go to GitHub', () => ui.showPanel('github')],
    ['claude', 'Go to Claude', () => ui.showPanel('claude')],
    ['prompts', 'Go to Prompts', () => ui.showPanel('prompts')],
    ['history', 'Go to History', () => ui.showPanel('history')],
    ['activity', 'Go to Activity', () => ui.showPanel('activity')]
  ];
  return views.map(([key, title, run]) => ({
    id: `jump.view:${key}`,
    title,
    category: 'View',
    run
  }));
}

module.exports = { init };
