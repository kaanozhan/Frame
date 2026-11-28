/**
 * Home Data Layer — the board's one and only subscription set.
 *
 * Every source Home reads lives here: `lanes`, `specs`, `tasks`, `git`,
 * `sessions`, `aiTool` and `milestone`. Widgets declare which of them they want and are
 * handed plain data; none of them ever sees `ipcRenderer` (D3, S6). That is
 * the structural half of the fix for the IPC storm measured 2026-08-20
 * (~100 round-trips/sec, 163% CPU): one listener set for the whole board,
 * installed once, no matter how many widgets read from it (C1).
 *
 * Init-once, like the board it serves. `init()` is idempotent and the
 * listener install is guarded, because a second board construction must not
 * stack a second set of listeners (C2) — the property `LaneBoard`'s
 * `_dataListenersBound` guard used to hold on its own.
 *
 * Two feeds, not one. Most sources arrive over IPC and this module owns them
 * end to end. `lanes` cannot: the terminal list belongs to the host's render
 * state, so the board pushes it in through `setHostState()` and this module
 * merges each terminal with its live `laneStatus` — the merge is here so that
 * `agentRows` downstream stays a pure function of plain data (C8).
 *
 * `milestone` is the open folder's started Frame Cloud milestone, for Home's
 * tracker (frame-cloud-milestones D12). It has two feeds too: a light
 * `milestone.list` read (CLOUD_MILESTONES_LIST) when the project, the cloud
 * state or the folder's Briefs availability changes, and on a Home visit or
 * window focus once the value is older than 30 s; and the Briefs board's
 * handoff (`setBoardMilestone`), whose counts already carry a held Move to
 * Done, so Home matches the strip with no request. No timers.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../../shared/ipcChannels');
const laneStatus = require('./../laneStatus');

/** Every source a widget may declare. An unknown name is a programming error. */
const SOURCES = ['lanes', 'specs', 'tasks', 'git', 'sessions', 'aiTool', 'milestone'];

const values = {
  // [{ terminal, status }] — the host's terminals merged with laneStatus.
  lanes: [],
  // Specs, already `!malformed` filtered (C3).
  specs: [],
  tasks: [],
  // { branch, projectPath } for the header, or null outside a repo.
  git: null,
  // Claude transcripts for this project, newest-first as main returns them.
  sessions: [],
  // { current, available } from the AI tool config.
  aiTool: { current: null, available: {} },
  // { path, milestone } — the open project's started cloud milestone — or
  // null: no started milestone, Briefs not available, or not read yet.
  milestone: null
};

const listeners = new Map(SOURCES.map(s => [s, new Set()]));

let bound = false;
let projectPath = null;
let terminals = [];

/** How old the milestone may be before a Home visit or focus reads it again. */
const MILESTONE_STALE_MS = 30 * 1000;
// When the milestone was last set (a read or the board's handoff); 0 = never.
let milestoneAt = 0;
// Every read and handoff takes a number; a read answering after a newer one
// (or after a handoff) is dropped.
let milestoneSeq = 0;
// The open folder's path, cloud project and Briefs availability, as the last
// cloud push left them: a push that moves none of them reads nothing.
let cloudKey = null;

// cloudBriefsPanel requires this module, so both sides require lazily.
function cloudBriefsPanel() {
  return require('./../cloudBriefsPanel');
}

function assertSource(source) {
  if (!listeners.has(source)) throw new Error(`homeData: unknown source "${source}"`);
}

function emit(source) {
  for (const cb of listeners.get(source)) {
    // One widget throwing must not stop the rest of the board from updating.
    try { cb(values[source]); } catch (err) { console.error(`homeData: ${source} listener failed`, err); }
  }
}

/**
 * A terminal on its own says nothing about what it is doing; a status on its
 * own has no name. Widgets want both, and want them without requiring
 * `laneStatus` themselves.
 */
function recomputeLanes() {
  values.lanes = terminals.map(t => ({ terminal: t, status: laneStatus.getStatus(t.id) }));
  emit('lanes');
}

/**
 * Install every subscription, once per renderer. Safe to call repeatedly —
 * the board calls it from its constructor, which runs once but is not
 * guaranteed to.
 */
function init() {
  if (bound) return;
  bound = true;

  // The branch comes from the git status watcher fileTreeUI already starts
  // per project — Home adds no watcher of its own.
  ipcRenderer.on(IPC.GIT_STATUS_DATA, (event, payload) => {
    values.git = payload.isRepo ? { branch: payload.branch, projectPath: payload.projectPath } : null;
    emit('git');
  });

  ipcRenderer.on(IPC.SPEC_DATA, (event, { specs }) => {
    values.specs = filterSpecs(specs);
    emit('specs');
  });

  ipcRenderer.on(IPC.TASKS_DATA, (event, { tasks }) => {
    values.tasks = (tasks && Array.isArray(tasks.tasks)) ? tasks.tasks : [];
    emit('tasks');
  });

  // A lane's status changes far more often than the lane list does, and both
  // have to reach a widget as one merged value.
  laneStatus.onChange(() => recomputeLanes());

  // The spec and task activity dots track the agents in their assigned
  // terminals — a lane-status change under a different name.
  const dispatch = require('./../agentDispatch');
  dispatch.onSpecLaneActivity(() => emit('specs'));
  dispatch.onTaskLaneActivity(() => emit('tasks'));

  ipcRenderer.on(IPC.AI_TOOL_CHANGED, (event, tool) => {
    values.aiTool = { current: tool, available: values.aiTool.available };
    emit('aiTool');
  });

  refresh('aiTool');

  // The tracker follows the connection: sign-in, sign-out, a folder linked or
  // unlinked, a role change.
  const cloudHub = require('./../cloudHub');
  cloudHub.onProjects(onCloudChange);
  cloudHub.onSession(onCloudChange);
}

/** `${path}\n${cloud project id}\n${available}` for the open folder. */
function currentCloudKey() {
  const { path, folder } = require('./../cloudProjectMark').openFolder();
  const projectId = folder && folder.project ? folder.project.id : '';
  return `${path || ''}\n${projectId}\n${cloudBriefsPanel().isAvailable() ? 1 : 0}`;
}

function onCloudChange() {
  const key = currentCloudKey();
  if (key === cloudKey) return;
  cloudKey = key;
  refresh('milestone');
}

/**
 * A spec whose folder cannot be read is not an active spec, it is a broken
 * one. The filter lives here so that no widget can forget it (C3).
 */
function filterSpecs(specs) {
  return (specs || []).filter(s => !s.malformed);
}

/**
 * The host's render state, pushed in on every board update. Only the board
 * calls this; widgets read `lanes` like any other source.
 *
 * A project change invalidates everything project-scoped, so the stale data
 * is dropped before the fetches go out — a widget must never paint the
 * previous project's specs while this one's are in flight.
 */
function setHostState(state) {
  const nextProject = state.currentProjectPath || null;
  terminals = state.terminals || [];

  if (nextProject !== projectPath) {
    projectPath = nextProject;
    values.specs = [];
    values.tasks = [];
    values.sessions = [];
    emit('specs');
    emit('tasks');
    emit('sessions');
    setMilestone(null, 0);
    if (projectPath) {
      refresh('specs');
      refresh('tasks');
      refresh('sessions');
      refresh('milestone');
    }
  }

  recomputeLanes();
}

/** The project every project-scoped source is currently reading. */
function getProjectPath() {
  return projectPath;
}

function get(source) {
  assertSource(source);
  return values[source];
}

/** Subscribe to one source. Returns the unsubscribe. */
function subscribe(source, cb) {
  assertSource(source);
  listeners.get(source).add(cb);
  return () => listeners.get(source).delete(cb);
}

/**
 * Ask a source to re-read. `lanes` and `git` are push-only — they arrive
 * when they change and there is nothing to pull — so refreshing them is a
 * no-op rather than an error.
 */
function refresh(source) {
  assertSource(source);

  if (source === 'specs') {
    if (!projectPath) return Promise.resolve();
    return ipcRenderer.invoke(IPC.LIST_SPECS, projectPath)
      .then((fresh) => {
        if (!Array.isArray(fresh)) return;
        values.specs = filterSpecs(fresh);
        emit('specs');
      })
      .catch(() => { /* the SPEC_DATA push will cover it */ });
  }

  if (source === 'tasks') {
    // Fire and forget: main answers on TASKS_DATA, which is already wired.
    if (projectPath) ipcRenderer.send(IPC.LOAD_TASKS, projectPath);
    return Promise.resolve();
  }

  if (source === 'sessions') {
    if (!projectPath) return Promise.resolve();
    return loadSessions(IPC.LOAD_CLAUDE_SESSIONS);
  }

  if (source === 'milestone') {
    return loadMilestone();
  }

  if (source === 'aiTool') {
    return ipcRenderer.invoke(IPC.GET_AI_TOOL_CONFIG)
      .then((config) => {
        if (!config) return;
        values.aiTool = { current: config.activeTool, available: config.availableTools || {} };
        emit('aiTool');
      })
      .catch(() => { /* leave the last known tool in place */ });
  }

  return Promise.resolve();
}

/**
 * The milestone source's value. `at` is when it was read (0 marks it stale).
 * Emits only when the value changed, so a re-read with the same answer
 * repaints nothing.
 */
function setMilestone(value, at = Date.now()) {
  milestoneAt = at;
  if (JSON.stringify(value) === JSON.stringify(values.milestone)) return;
  values.milestone = value;
  emit('milestone');
}

/** The refusals after which the folder has no tracker at all, rather than a stale one. */
const MILESTONE_GONE = new Set(['notConnected', 'unauthorized', 'roleForbidden']);

/**
 * Read the open project's milestones (one `milestone.list`) and keep its
 * started one. Nothing is read while the folder's Briefs are not available —
 * a viewer, an unconnected folder (frame-cloud-roles D2). A late answer for
 * another project, or one overtaken by a newer read or a handoff, is dropped;
 * a failed read keeps the last value unless the folder lost its connection.
 */
function loadMilestone() {
  const forProject = projectPath;
  const seq = ++milestoneSeq;
  if (!forProject || !cloudBriefsPanel().isAvailable()) {
    setMilestone(null);
    return Promise.resolve();
  }
  return ipcRenderer.invoke(IPC.CLOUD_MILESTONES_LIST, forProject)
    .then((result) => {
      if (seq !== milestoneSeq || forProject !== projectPath) return;
      if (result && result.ok) {
        const started = require('./../cloudBriefsCopy').startedMilestone(result.milestones);
        setMilestone(started ? { path: forProject, milestone: started } : null);
        return;
      }
      if (result && MILESTONE_GONE.has(result.reason)) setMilestone(null);
    })
    .catch(() => { /* leave the last milestone in place; the next visit reads again */ });
}

/** Read the milestone again only when it is older than MILESTONE_STALE_MS — a Home visit, a window focus. */
function refreshMilestoneIfStale() {
  if (Date.now() - milestoneAt < MILESTONE_STALE_MS) return Promise.resolve();
  return refresh('milestone');
}

/**
 * The Briefs board's started milestone, its `briefs` counted from the board
 * (held moves included), or null when the board has none. Only for the
 * project Home is reading; it overtakes any read still in flight (D12).
 */
function setBoardMilestone(path, milestone) {
  if (!path || path !== projectPath) return;
  milestoneSeq += 1;
  setMilestone(milestone ? { path, milestone } : null);
}

/**
 * Re-scan the transcripts rather than serving the cache — what the panel's
 * refresh button does, for a widget that wants the same guarantee.
 */
function reloadSessions() {
  if (!projectPath) return Promise.resolve();
  return loadSessions(IPC.REFRESH_CLAUDE_SESSIONS);
}

function loadSessions(channel) {
  const forProject = projectPath;
  return ipcRenderer.invoke(channel, forProject)
    .then((result) => {
      // A late answer for the project you just left is not this project's
      // session list.
      if (forProject !== projectPath) return;
      // Main returns { sessions, reason }; tolerate the legacy plain array.
      values.sessions = Array.isArray(result) ? result : ((result && result.sessions) || []);
      emit('sessions');
    })
    .catch(() => {
      if (forProject !== projectPath) return;
      values.sessions = [];
      emit('sessions');
    });
}

/**
 * Switch the active AI tool. Lives here rather than in the widget because a
 * widget has no `ipcRenderer` (S6); the reply arrives back over
 * `AI_TOOL_CHANGED` like any other tool change, whoever made it.
 */
function setAiTool(toolId) {
  return ipcRenderer.invoke(IPC.SET_AI_TOOL, toolId);
}

module.exports = {
  SOURCES,
  init,
  get,
  subscribe,
  refresh,
  setHostState,
  getProjectPath,
  reloadSessions,
  setAiTool,
  refreshMilestoneIfStale,
  setBoardMilestone
};
