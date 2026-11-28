/**
 * Cloud Briefs Panel
 *
 * The open folder's Frame Cloud briefs (frame-cloud-briefs-read-only spec),
 * and New brief (frame-cloud-briefs-create spec). Reached from the sidebar's
 * Context → Briefs row, which exists only while the open folder is connected
 * to a cloud project; hosted in the center by `multiTerminalUI` the way
 * Sessions is (`PANEL_REGISTRY.cloudBriefs`).
 *
 * The renderer sends a folder path and nothing else — main resolves the
 * connected project and holds the token. Creating a brief is one write, and
 * its form lives in cloudBriefsForm.js; the drawer shows either a brief or
 * that form. Discuss (frame-cloud-brief-discussions spec) opens a lane on an
 * open proposal, and Shape (frame-cloud-brief-shape spec) one on open,
 * unshaped work; their agents write through main, never through this panel.
 * Start Work (frame-cloud-brief-start spec) opens cloudStartDialog.js on
 * open, shaped work, and main writes its parts into the folder.
 * Move to Done and Move back to Active (frame-cloud-brief-manual-done spec)
 * move started work between Active and Done with a button, never a drag
 * (FrameCloud D3/D4, overturning the page's "drag the card"): a move that
 * needs a reason, and every move back, asks for it in a dialog. A move with
 * nothing to explain shows the card in Done at once with a "Moved #N to
 * Done" toast offering Undo; main holds it for those 5 seconds and sends it
 * then, when another move starts, or when Frame quits.
 * GitHub tracking (frame-cloud-github-tracking spec) shows what the cloud
 * learns from GitHub, in the web's words: a part's pull request on its row,
 * with "PR #N" opening the server's URL in the browser; the card's attention
 * line; and, when the project has no GitHub or tracking is off, the web's box
 * above the columns leading to the project's Settings. Frame never asks
 * GitHub itself and never changes the setting.
 * Milestones (frame-cloud-milestones spec): while the project has a started
 * milestone, a strip between the tracking box and the columns shows it in the
 * web's words — its name (which opens its page on the web), Overdue, the end
 * date, its own target branch and "N of M done" with a bar — counted from the
 * board's own briefs, held moves included. Frame never changes a milestone.
 * The strip is also the board's one filter (FrameCloud board-active-milestone
 * D3): "Show only this milestone" narrows the columns, Closed and the count to
 * its briefs, "All briefs" widens them again. The narrowing lives in the panel
 * and is cleared by hide() and a change of folder. Every board draw hands
 * the started milestone, counted the same way, to Home's tracker (homeData),
 * so Home matches the strip with no request of its own.
 *
 * Names are `cloudBriefs*` / `cloud-briefs`, not `briefs`: the local briefs
 * of brief-capture-and-shaping own those, and the two must meet in one tree.
 *
 * Host contract, the same as every center-hosted panel: `show()` adds
 * `.visible` and loads, `hide()` drops `.visible` — which is what the host's
 * MutationObserver watches to route back to the terminals view.
 */

const { ipcRenderer, shell } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const { HOLD_MS } = require('../shared/cloudMoveHold');
const state = require('./state');
const cloudProjectMark = require('./cloudProjectMark');
const { escapeHtml } = require('./htmlUtils');
const copy = require('./cloudBriefsCopy');
const cloudBriefsForm = require('./cloudBriefsForm');
const cloudStartDialog = require('./cloudStartDialog');
const agentDispatch = require('./agentDispatch');
const aiToolSelector = require('./aiToolSelector');
const notify = require('./notify');

// homeData requires this module, so it is required lazily.
function homeData() {
  return require('./home/homeData');
}

let hub = null;
let panelElement = null;
let contentElement = null;
let countElement = null;
let showClosedInput = null;
let refreshButton = null;
let webButton = null;
let newButton = null;
let detailElement = null;
let detailContentElement = null;
let detailRefreshButton = null;
let visible = false;

// The board's last answer and the folder it belongs to. A refresh of the same
// folder keeps the board on screen and spins the button; another folder
// starts from the loading state.
let board = null; // { path, result }
let showClosed = false;
// A sentence above the columns after a create whose links did not all attach.
// It stays until dismissed, a change of folder or hide().
let notice = null;
// Every load takes a number; an answer whose number is no longer the latest
// (another project, a toggle, a second refresh) is dropped.
let loadSeq = 0;

// What the drawer shows: null (closed), 'detail' (a brief) or 'new' (the
// New brief form).
let drawerMode = null;
// The brief open in the drawer: { number, tab, result } — result is null
// while it loads. Its loads are numbered the same way as the board's.
let detail = null;
let detailSeq = 0;
// The brief number whose Discuss or Shape lane is starting, so a second click waits.
let starting = null;
// Moves to Done without a dialog that are on their way (held for Undo, then
// sent), by `${folder}\0${number}` (D17): the board shows those briefs in
// Done, their control reads "Moving to Done…" and is disabled, and the entry
// leaves when main answers — sent, undone or refused.
const moving = new Set();
// A brief to open once the panel mounts (a brief lane's chip was clicked).
let pendingOpen = null;
// The milestone id the board is narrowed to, or null for every brief. It
// counts only while it names the board's started milestone (D8); otherwise
// the board shows every brief. Cleared by hide() and a change of folder (D5).
let narrowedTo = null;
// A milestone to narrow to once the panel mounts (Home's tracker was clicked).
let pendingNarrow = null;
// The open folder's specs (by slug) and tasks (by id), for a started brief's
// part rows. Filled on show() and kept live by SPEC_DATA / TASKS_DATA.
let local = { path: null, specs: new Map(), tasks: new Map() };

const TABS = [
  { key: 'description', label: 'Description' },
  { key: 'parts', label: 'Parts' },
  { key: 'comments', label: 'Comments' },
  { key: 'history', label: 'History' },
];

function init(cloudHub) {
  hub = cloudHub;
  panelElement = document.getElementById('cloud-briefs-panel');
  contentElement = document.getElementById('cloud-briefs-content');
  if (!panelElement || !contentElement) {
    console.error('cloudBriefsPanel: #cloud-briefs-panel not found — Briefs will not open');
    return;
  }

  countElement = document.getElementById('cloud-briefs-count');
  showClosedInput = document.getElementById('cloud-briefs-show-closed');
  refreshButton = document.getElementById('cloud-briefs-refresh');
  webButton = document.getElementById('cloud-briefs-open-web');
  newButton = document.getElementById('cloud-briefs-new');
  detailElement = document.getElementById('cloud-briefs-detail');
  detailContentElement = detailElement && detailElement.querySelector('.cloud-briefs-detail-content');

  if (showClosedInput) {
    showClosedInput.addEventListener('change', () => {
      showClosed = showClosedInput.checked;
      load();
    });
  }
  if (refreshButton) refreshButton.addEventListener('click', refresh);
  if (webButton) webButton.addEventListener('click', () => openOnWeb());
  if (newButton) newButton.addEventListener('click', openNewBrief);
  contentElement.addEventListener('click', onContentClick);
  if (detailElement) {
    const back = detailElement.querySelector('.specs-dashboard-detail-back');
    if (back) back.addEventListener('click', leaveDrawer);
    // The drawer covers the panel header, so it carries its own Refresh.
    detailRefreshButton = document.getElementById('cloud-briefs-detail-refresh');
    if (detailRefreshButton) detailRefreshButton.addEventListener('click', refresh);
  }
  if (detailContentElement) detailContentElement.addEventListener('click', onDetailClick);
  // Esc closes the drawer, and only the drawer: the board itself has no Esc.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && visible && drawerMode) {
      e.preventDefault();
      leaveDrawer();
    }
  });

  // The Briefs row follows the connection: sign-in, sign-out, a folder
  // connected or disconnected, a project switch.
  hub.onProjects(onCloudChange);
  hub.onSession(onCloudChange);
  state.onProjectChange(onCloudChange);
  // Coming back to Frame from elsewhere (the web board, say) re-reads what
  // is on screen. In-app navigation needs nothing: the host's show() loads.
  window.addEventListener('focus', onWindowFocus);

  // A brief lane's activity moves the dots and the header button; a record
  // or a shape that landed reloads the brief it belongs to.
  agentDispatch.onBriefLaneActivity(renderLaneSlots);
  // A started brief's part rows follow the folder's specs and tasks and
  // their lanes.
  ipcRenderer.on(IPC.SPEC_DATA, (event, { projectPath, specs }) => onLocalData(projectPath, { specs }));
  ipcRenderer.on(IPC.TASKS_DATA, (event, { projectPath, tasks }) => onLocalData(projectPath, { tasks }));
  agentDispatch.onSpecLaneActivity(() => renderPartSlots());
  agentDispatch.onTaskLaneActivity(() => renderPartSlots());
  // ...and the workspaces the rows name: created, renamed or archived.
  require('./workspaceSection').onChange(() => renderPartSlots());
  ipcRenderer.on(IPC.CLOUD_BRIEF_DISCUSSION_RECORDED, (event, payload) => onBriefWritten(payload));
  ipcRenderer.on(IPC.CLOUD_BRIEF_SHAPED, (event, payload) => onBriefShaped(payload));
  ipcRenderer.on(IPC.CLOUD_BRIEFS_CHANGED, (event, payload) => onBriefsChanged(payload));
}

// What the open board was loaded against: the folder, its cloud project and
// the project list it came from. The hub pushes on every projects change —
// candidate lookups included — so the board reloads only when this moves.
let loadedKey = null;
// When the panel last asked for its board. Focus and project-list pushes
// inside FOCUS_THROTTLE_MS of it do not ask again.
let lastLoadAt = 0;
const FOCUS_THROTTLE_MS = 30 * 1000;

function onWindowFocus() {
  if (!visible) return;
  if (!isAvailable()) {
    hide();
    return;
  }
  if (Date.now() - lastLoadAt < FOCUS_THROTTLE_MS) return;
  refresh();
}

function onCloudChange() {
  try {
    require('./projectListUI').updateWorkspaceNav();
  } catch (err) {
    console.error('cloudBriefsPanel: could not refresh the nav', err);
  }
  if (!visible) return;
  // The folder stopped being connected — a disconnect, a sign-out, a switch
  // to an unconnected project: leave. Dropping .visible is what routes the
  // host back to the terminals view.
  if (!isAvailable()) {
    hide();
    return;
  }
  const key = currentKey();
  if (key === loadedKey) return;
  const [path, projectId] = key.split('\n');
  const [loadedPath, loadedProjectId] = (loadedKey || '').split('\n');
  const sameProject = loadedKey !== null && path === loadedPath && projectId === loadedProjectId;
  // Only the list time moved, and the board is fresh: this is the project
  // list's own focus refresh landing right after ours — skip the repeat.
  if (sameProject && Date.now() - lastLoadAt < FOCUS_THROTTLE_MS) {
    loadedKey = key;
    return;
  }
  // Another folder: its board, not the last one's brief, form, notice or narrowing.
  if (path !== loadedPath) {
    closeDrawer();
    notice = null;
    narrowedTo = null;
  }
  load();
  if (detail) loadDetail();
}

/** `${path}\n${cloud project id}\n${list time}` for the open folder. */
function currentKey() {
  const { path, folder, projects } = cloudProjectMark.openFolder();
  const projectId = folder && folder.project ? folder.project.id : '';
  return `${path || ''}\n${projectId}\n${(projects && projects.lastUpdated) || ''}`;
}

/** True while the open folder is connected to a cloud project — the same test as the Connected mark. */
function isAvailable() {
  if (!hub) return false;
  const { folder, projects } = cloudProjectMark.openFolder();
  // A viewer has no cloud surface in Frame (frame-cloud-roles D2): no row,
  // and an open panel leaves on the projects push that carries the new role.
  const canWork = Boolean(projects && projects.permissions && projects.permissions.work);
  return Boolean(folder && folder.connected && folder.project && canWork);
}

/** Show the panel and load the board — the host calls this on mount. Show closed starts off each time. */
function show() {
  if (!panelElement) return;
  panelElement.classList.add('visible');
  visible = true;
  showClosed = false;
  if (showClosedInput) showClosedInput.checked = false;
  // The board opens on every brief, unless Home's tracker asked for its milestone (D5).
  narrowedTo = pendingNarrow;
  pendingNarrow = null;
  load();
  loadLocal();
  if (pendingOpen !== null) {
    const number = pendingOpen;
    pendingOpen = null;
    openDetail(number);
  }
}

/**
 * Open the Briefs panel on one brief — the route a Discuss lane's chip
 * takes. The host mounts the panel (show() then opens the drawer); when it
 * is already on screen, the drawer opens directly.
 */
function openBrief(number) {
  if (!Number.isInteger(number) || number < 1) return;
  if (!isAvailable()) {
    notify.error(copy.reasonMessage('notConnected'));
    return;
  }
  const ui = require('./terminal').getMultiTerminalUI();
  if (visible) {
    if (ui) ui.showPanel('cloudBriefs');
    openDetail(number);
    return;
  }
  pendingOpen = number;
  if (ui) ui.showPanel('cloudBriefs');
  if (pendingOpen !== null && !visible) pendingOpen = null; // the host did not mount it
}

/**
 * Open the Briefs panel narrowed to a milestone — the route Home's tracker
 * takes. The host mounts the panel (show() then narrows the first draw); when
 * it is already on screen, the board narrows directly. The narrowing counts
 * only while the id names the board's started milestone (D8).
 */
function openMilestone(milestoneId) {
  if (typeof milestoneId !== 'string' || !milestoneId) return;
  if (!isAvailable()) {
    notify.error(copy.reasonMessage('notConnected'));
    return;
  }
  const ui = require('./terminal').getMultiTerminalUI();
  if (visible) {
    if (ui) ui.showPanel('cloudBriefs');
    narrowedTo = milestoneId;
    if (board && board.path === state.getProjectPath()) renderBoard();
    return;
  }
  pendingNarrow = milestoneId;
  if (ui) ui.showPanel('cloudBriefs');
  if (pendingNarrow !== null && !visible) pendingNarrow = null; // the host did not mount it
}

function hide() {
  if (!panelElement) return;
  panelElement.classList.remove('visible');
  visible = false;
  loadSeq += 1; // an answer still in flight lands nowhere
  loadedKey = null;
  notice = null;
  narrowedTo = null;
  closeDrawer();
}

/** Refresh re-reads the board, and the open brief with it. The New brief form is left as it is. */
function refresh() {
  load();
  if (detail) loadDetail();
}

// ─── Loading ──────────────────────────────────────────────────

async function load() {
  if (!contentElement) return;
  const path = state.getProjectPath();
  const seq = ++loadSeq;
  loadedKey = currentKey();
  lastLoadAt = Date.now();
  if (!path) {
    board = null;
    renderMessage('No project is open.');
    return;
  }
  const sameFolder = board && board.path === path;
  if (!sameFolder) {
    board = null;
    renderLoading();
  }
  setRefreshing(true);
  let result;
  try {
    result = await ipcRenderer.invoke(IPC.CLOUD_BRIEFS_LIST, path, { includeClosed: showClosed });
  } catch (err) {
    console.error('cloudBriefsPanel: could not load briefs', err);
    result = { ok: false, reason: 'other' };
  }
  if (seq !== loadSeq) return;
  setRefreshing(false);
  if (result && result.ok) {
    board = { path, result };
    renderBoard();
    return;
  }
  board = null;
  const reason = result && result.reason;
  // Signed out: the session push hides the row and the panel; draw nothing new.
  if (reason === 'unauthorized') {
    renderMessage('');
    return;
  }
  renderError(reason);
}

function setRefreshing(on) {
  if (!refreshButton) return;
  refreshButton.classList.toggle('spinning', on);
  refreshButton.disabled = on;
}

/**
 * The project on the web, one brief by number, the project's Settings for
 * `'settings'`, or a milestone's page for `{ milestoneId }`; main builds the URL.
 */
function openOnWeb(target) {
  const path = state.getProjectPath();
  if (!path) return;
  const args = target === undefined ? [path] : [path, target];
  ipcRenderer.invoke(IPC.CLOUD_BRIEFS_OPEN_ON_WEB, ...args).catch((err) => {
    console.error('cloudBriefsPanel: could not open Frame Cloud on the web', err);
  });
}

/** A milestone's page on the web. */
function openMilestoneOnWeb(milestoneId) {
  if (typeof milestoneId === 'string' && milestoneId) openOnWeb({ milestoneId });
}

function onContentClick(event) {
  const actionEl = event.target.closest('[data-action]');
  if (!actionEl || !contentElement.contains(actionEl)) return;
  const action = actionEl.dataset.action;
  if (action === 'retry') load();
  else if (action === 'open-web') openOnWeb();
  else if (action === 'open-settings-web') openOnWeb('settings');
  else if (action === 'open-milestone-web') openMilestoneOnWeb(actionEl.dataset.milestoneId);
  else if (action === 'toggle-milestone') toggleMilestone(actionEl.dataset.milestoneId);
  else if (action === 'new-brief') openNewBrief();
  else if (action === 'dismiss-notice') {
    notice = null;
    const el = contentElement.querySelector('.cloud-briefs-notice');
    if (el) el.remove();
  }
  else if (action === 'open-brief') {
    const number = Number(actionEl.dataset.number);
    if (Number.isInteger(number) && number > 0) openDetail(number);
  }
  else if (action === 'discuss-card') {
    const brief = boardBrief(Number(actionEl.dataset.number));
    if (brief) discuss(brief);
  }
  else if (action === 'shape-card') {
    const brief = boardBrief(Number(actionEl.dataset.number));
    if (brief) shape(brief);
  }
  else if (action === 'start-card') {
    const brief = boardBrief(Number(actionEl.dataset.number));
    if (brief) startWork(brief);
  }
  else if (action === 'move-to-work-card') {
    const brief = boardBrief(Number(actionEl.dataset.number));
    if (brief) openMoveToWork(brief);
  }
  else if (action === 'move-card') {
    const brief = boardBrief(Number(actionEl.dataset.number));
    if (brief) moveBrief(brief);
  }
  else if (action === 'open-comments') {
    const number = Number(actionEl.dataset.number);
    if (Number.isInteger(number) && number > 0) openDetail(number, 'comments');
  }
  else if (action === 'go-to-lane') {
    agentDispatch.enterBriefLane(Number(actionEl.dataset.number));
  }
  else onPartAction(actionEl);
}

// ─── Rendering: the board ─────────────────────────────────────

function setHeader({ count, canOpenWeb }) {
  if (countElement) {
    countElement.textContent = count === null ? '' : `${count} brief${count === 1 ? '' : 's'}`;
  }
  if (webButton) webButton.hidden = !canOpenWeb;
}

function renderBoard() {
  const { milestones, canOpenWeb } = board.result;
  const briefs = shownBriefs();
  const started = copy.startedMilestone(milestones);
  // Narrowed only while narrowedTo names the started milestone (D8).
  const narrowed = Boolean(started) && narrowedTo === started.id;
  const listed = narrowed ? copy.briefsInMilestone(briefs, started.id) : briefs;
  const groups = copy.groupByColumn(listed);
  const openCount = groups.backlog.length + groups.active.length + groups.done.length;
  setHeader({ count: showClosed ? listed.length : openCount, canOpenWeb });
  // Cards name their milestone; the started one's name is a badge (D9).
  const milestoneIndex = {
    byId: new Map((milestones || []).map((m) => [m.id, m])),
    startedId: started ? started.id : null,
  };

  const open = openCount > 0
    ? `<div class="cloud-briefs-columns">${copy.COLUMNS.map((column) => `
        <section class="cloud-briefs-column" aria-label="${escapeHtml(column.title)}">
          <h3 class="cloud-briefs-column-title">
            <span>${escapeHtml(column.title)}</span>
            <span class="cloud-briefs-column-count">${groups[column.status].length}</span>
          </h3>
          ${column.hint ? `<p class="cloud-briefs-column-hint">${escapeHtml(column.hint)}</p>` : ''}
          ${renderCards(groups[column.status], milestoneIndex)}
        </section>`).join('')}
      </div>`
    : narrowed ? renderNarrowedEmpty() : renderEmpty(canOpenWeb);

  const closed = showClosed
    ? `<section class="cloud-briefs-closed" aria-label="Closed">
        <h3 class="cloud-briefs-closed-title">Closed</h3>
        ${groups.closed.length > 0
          ? renderCards(groups.closed, milestoneIndex)
          : '<p class="cloud-briefs-muted">No closed briefs.</p>'}
      </section>`
    : '';

  // The tracking box states the project's tracking, so it reads the whole
  // board's Active column, not the narrowed one (D22).
  const anyActive = briefs.some((b) => b.status === 'active');
  const tracking = anyActive ? renderTrackingNotice(board.result.mergeTracking, canOpenWeb) : '';
  const strip = started ? renderMilestoneStrip(started, briefs, canOpenWeb, narrowed) : '';
  contentElement.innerHTML = renderNotice() + tracking + strip + open + closed;
  handOffMilestone(started, briefs);
}

/**
 * Home's tracker takes the board's started milestone with the board's counts
 * (held moves included), so it matches the strip without a read (D12).
 */
function handOffMilestone(started, briefs) {
  try {
    homeData().setBoardMilestone(board.path, started ? { ...started, briefs: copy.countsWithBriefs(started, briefs) } : null);
  } catch (err) {
    console.error('cloudBriefsPanel: could not hand the milestone to Home', err);
  }
}

/** "Show only this milestone" or "All briefs": narrow the board to the started milestone, or widen it again. */
function toggleMilestone(milestoneId) {
  if (!board || !board.result) return;
  const started = copy.startedMilestone(board.result.milestones);
  if (!started || started.id !== milestoneId) return;
  narrowedTo = narrowedTo === started.id ? null : started.id;
  renderBoard();
}

/** A narrowed board with nothing open (D7). */
function renderNarrowedEmpty() {
  return `<div class="cloud-briefs-state cloud-briefs-narrowed-empty">
      <p>${escapeHtml(copy.NARROWED_EMPTY_LABEL)}</p>
    </div>`;
}

/**
 * The project's started milestone above the columns (FrameCloud
 * board-active-milestone D10): "Milestone", its name — a button to its page
 * on the web when the project has a web link, plain text otherwise —
 * Overdue, the end date, its own target branch, and a bar with "N of M done".
 * The numbers come from `briefs`, the board as shown, so a held Move to Done
 * moves them at once and Undo moves them back. A milestone from an older
 * server reads as its name alone (D11). Read-only, as on the web; its one
 * control is the board's filter, pressed while `narrowed`.
 */
function renderMilestoneStrip(started, briefs, canOpenWeb, narrowed) {
  const summary = copy.milestoneSummary({ ...started, briefs: copy.countsWithBriefs(started, briefs) }, copy.localToday());
  const name = canOpenWeb
    ? `<button type="button" class="cloud-briefs-milestone-name" data-action="open-milestone-web" data-milestone-id="${escapeHtml(summary.id)}" title="${escapeHtml(copy.OPEN_ON_WEB_LABEL)}" tabindex="-1">${escapeHtml(summary.name)}</button>`
    : `<span class="cloud-briefs-milestone-name">${escapeHtml(summary.name)}</span>`;
  const facts = [];
  if (summary.ends) facts.push(`<span>${escapeHtml(summary.ends)}</span>`);
  if (summary.target) facts.push(`<span class="cloud-briefs-milestone-target">${escapeHtml(summary.target)}</span>`);
  if (summary.progress) facts.push(renderMilestoneProgress(summary.name, summary.progress));
  facts.push(`<button type="button" class="cloud-briefs-web-btn cloud-briefs-milestone-toggle" data-action="toggle-milestone" data-milestone-id="${escapeHtml(summary.id)}" aria-pressed="${narrowed ? 'true' : 'false'}" tabindex="-1">${escapeHtml(narrowed ? copy.ALL_BRIEFS_LABEL : copy.SHOW_ONLY_MILESTONE_LABEL)}</button>`);
  return `<section class="cloud-briefs-milestone-strip" aria-label="${escapeHtml(copy.STARTED_MILESTONE_LABEL)}">
      <div class="cloud-briefs-milestone-head">
        <span class="cloud-briefs-milestone-label">${escapeHtml(copy.MILESTONE_LABEL)}</span>
        ${name}
        ${summary.overdue ? renderOverdue() : ''}
      </div>
      <div class="cloud-briefs-milestone-facts">${facts.join('')}</div>
    </section>`;
}

/** The milestone's bar and "N of M done". */
function renderMilestoneProgress(name, progress) {
  const percent = Number(progress.percent) || 0;
  return `<span class="cloud-briefs-milestone-progress">
      <span class="cloud-briefs-progress" role="progressbar" aria-label="${escapeHtml(copy.milestoneProgressLabel(name))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span class="cloud-briefs-progress-fill" style="width: ${percent}%"></span></span>
      <span class="cloud-briefs-progress-label">${escapeHtml(progress.label)}</span>
    </span>`;
}

function renderOverdue() {
  return `<span class="cloud-briefs-overdue">${escapeHtml(copy.OVERDUE_LABEL)}</span>`;
}

/**
 * The project's pull requests and merges are not tracked — no GitHub, or
 * tracking turned off — so an Active brief's parts never reach merged: say
 * so above the columns in the web's box, with "Open on web" leading to the
 * project's Settings at its GitHub section, where either changes. The
 * board's `mergeTracking` picks the box (`needs_github` wins, S4). Not
 * dismissible: it states the project's state, and leaves once that changes.
 */
function renderTrackingNotice(mergeTracking, canOpenWeb) {
  const warning = copy.trackingWarning(mergeTracking);
  if (!warning) return '';
  return `<div class="cloud-briefs-tracking" role="status">
      <div class="cloud-briefs-tracking-text">
        <p class="cloud-briefs-tracking-title">${escapeHtml(warning.title)}</p>
        <p>${escapeHtml(warning.description)}</p>
      </div>
      ${canOpenWeb ? `<button type="button" class="cloud-briefs-web-btn" data-action="open-settings-web" tabindex="-1">${escapeHtml(copy.OPEN_ON_WEB_LABEL)}</button>` : ''}
    </div>`;
}

function renderNotice() {
  if (!notice) return '';
  return `<div class="cloud-briefs-notice" role="status">
      <p>${escapeHtml(notice)}</p>
      <button type="button" class="cloud-briefs-icon-btn" data-action="dismiss-notice" aria-label="Dismiss" title="Dismiss" tabindex="-1">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>`;
}

/** `milestoneIndex`: `{ byId, startedId }` — the board's milestones by id, and the started one's id or null. */
function renderCards(briefs, milestoneIndex) {
  if (briefs.length === 0) return '';
  return `<ul class="cloud-briefs-cards">${briefs.map((brief) => `
    <li>${renderCard(brief, milestoneIndex)}</li>`).join('')}
  </ul>`;
}

/** A card's milestone name: a badge for the started milestone, plain text for a planned or closed one (D9). */
function renderCardMilestone(milestone, startedId) {
  if (!milestone || !milestone.name) return '';
  const cls = milestone.id === startedId ? 'cloud-briefs-milestone-badge' : 'cloud-briefs-milestone';
  return `<span class="${cls}">${escapeHtml(milestone.name)}</span>`;
}

function renderCard(brief, milestoneIndex) {
  const milestone = brief.milestoneId ? milestoneIndex.byId.get(brief.milestoneId) : null;
  const milestoneHtml = renderCardMilestone(milestone, milestoneIndex.startedId);
  const kind = copy.KIND_COPY[brief.kind] || copy.KIND_COPY.proposal;
  const priority = brief.kind === 'work' && brief.priority ? copy.priorityLabel(brief.priority) : '';
  const ending = copy.endingLine(brief);
  const meta = priority || milestoneHtml
    ? `<span class="cloud-briefs-card-meta">
        ${priority ? `<span class="cloud-briefs-priority"><span class="cloud-briefs-priority-dot ${escapeHtml(brief.priority)}" aria-hidden="true"></span>${escapeHtml(priority)}</span>` : ''}
        ${milestoneHtml}
      </span>`
    : '';
  const records = copy.discussionCountLabel(brief.discussionCount);
  const parts = copy.partCountLabel(brief.partCounts);
  // A started brief lists its parts where they run instead of counting them.
  const started = Boolean(brief.startedAt) && Array.isArray(brief.parts) && brief.parts.length > 0;
  // Every live part counts on a tracked project: the brief waits for a person
  // to move it to Done (manual Done). Only while tracking is ready (D15): not
  // without GitHub, and not with tracking turned off.
  const ready = brief.status === 'active' && brief.readyForDone === true && brief.mergeTracking === 'ready';
  // The card is a container, not a button: its controls (Discuss, Shape, the
  // live lane) sit beside the open-brief button rather than inside it.
  return `<div class="cloud-briefs-card">
      <button type="button" class="cloud-briefs-card-open" data-action="open-brief" data-number="${brief.number}" tabindex="-1">
        <span class="cloud-briefs-card-head">
          <span class="cloud-briefs-number">#${brief.number}</span>
          <span class="cloud-briefs-kind ${escapeHtml(brief.kind)}">${escapeHtml(kind.badge)}</span>
          ${ready ? `<span class="cloud-briefs-ready">${escapeHtml(copy.READY_FOR_DONE_LABEL)}</span>` : ''}
        </span>
        <span class="cloud-briefs-card-title">${escapeHtml(brief.title)}</span>
        ${meta}
        ${records ? `<span class="cloud-briefs-card-records">${escapeHtml(records)}</span>` : ''}
        ${parts && !started ? `<span class="cloud-briefs-card-records">${escapeHtml(parts)}</span>` : ''}
        ${ending ? `<span class="cloud-briefs-ending">${escapeHtml(ending)}</span>` : ''}
      </button>
      ${started ? `<div class="cloud-briefs-card-parts" data-card-parts="${brief.number}">${renderCardParts(brief)}</div>` : ''}
      <div class="cloud-briefs-card-actions" data-card-actions="${brief.number}">${renderCardActions(brief)}</div>
    </div>`;
}

/**
 * A card's controls. An open brief lane of either purpose comes first — one
 * lane per brief — as "Discussing in <lane>" or "Shaping in <lane>", which
 * enters it. Otherwise, by the proposal's stage:
 *   discuss    → primary Discuss (nothing recorded yet)
 *   decide     → primary Move to Work, secondary Discuss — and, when someone
 *                commented after the latest record, "N new comments" first,
 *                which opens the Comments tab
 * and for work, primary Shape while it is open and unshaped; Move to Done on
 * Active work and Move back to Active on Done work, beside an open lane's
 * link rather than instead of it (D9); nothing for a shaped, unstarted or an
 * ended brief.
 */
function renderCardActions(brief) {
  const lane = agentDispatch.getBriefLaneInfo(brief.number);
  const n = brief.number;
  if (copy.workStage({ brief, laneOpen: Boolean(lane) }) === 'start') return startWorkButton(n, 'start-card');
  const move = moveButton(brief, 'move-card');
  if (lane) {
    return `<button type="button" class="cloud-briefs-lane-link" data-action="go-to-lane" data-number="${n}" title="${escapeHtml(goToLaneLabel(lane))}" tabindex="-1">${agentDispatch.briefStatusDotHtml(n)}<span>${escapeHtml(copy.laneLabel(lane.purpose, lane.name))}</span></button>${move}`;
  }
  if (move) return move;
  if (copy.workStage({ brief, laneOpen: false }) === 'shape') return shapeButton(n, 'shape-card');
  const stage = copy.proposalStage({ brief, laneOpen: false, discussionCount: brief.discussionCount });
  if (stage === 'discuss') return discussButton(n, 'primary', 'discuss-card');
  if (stage !== 'decide') return '';
  const fresh = copy.newCommentsLabel(brief.newCommentCount);
  return `${fresh ? `<button type="button" class="cloud-briefs-new-comments" data-action="open-comments" data-number="${n}" tabindex="-1">${escapeHtml(fresh)}</button>` : ''}
    ${moveToWorkButton(n, 'move-to-work-card')}
    ${discussButton(n, 'secondary', 'discuss-card')}`;
}

/** "Go to discussion" or "Go to shaping", by the open lane's purpose. */
function goToLaneLabel(lane) {
  return lane.purpose === 'shape' ? copy.GO_TO_SHAPING_LABEL : copy.GO_TO_DISCUSSION_LABEL;
}

/** Discuss as the stage's primary or secondary button; "Discuss…" while it starts. */
function discussButton(number, weight, action, label = copy.DISCUSS_LABEL, hint = copy.DISCUSS_HINT) {
  const pending = starting === number;
  const cls = weight === 'primary' ? 'cloud-briefs-primary-btn' : 'cloud-briefs-web-btn';
  return `<button type="button" class="${cls} cloud-briefs-discuss-btn" data-action="${action}" data-number="${number}" title="${escapeHtml(hint)}" tabindex="-1"${pending ? ' disabled' : ''}>${escapeHtml(pending ? `${label}…` : label)}</button>`;
}

/** Shape as a primary button; "Shape…" while its lane starts. */
function shapeButton(number, action) {
  const pending = starting === number;
  const label = copy.SHAPE_LABEL;
  return `<button type="button" class="cloud-briefs-primary-btn cloud-briefs-discuss-btn" data-action="${action}" data-number="${number}" title="${escapeHtml(copy.SHAPE_HINT)}" tabindex="-1"${pending ? ' disabled' : ''}>${escapeHtml(pending ? `${label}…` : label)}</button>`;
}

/** Start Work as a primary button, where Shape was. */
function startWorkButton(number, action) {
  return `<button type="button" class="cloud-briefs-primary-btn cloud-briefs-discuss-btn" data-action="${action}" data-number="${number}" title="${escapeHtml(copy.START_WORK_HINT)}" tabindex="-1">${escapeHtml(copy.START_WORK_LABEL)}</button>`;
}

function moveToWorkButton(number, action) {
  return `<button type="button" class="cloud-briefs-primary-btn" data-action="${action}" data-number="${number}" tabindex="-1">${escapeHtml(copy.MOVE_TO_WORK_LABEL)}</button>`;
}

/**
 * The board's briefs as the panel shows them: a brief whose move to Done is
 * held reads Done already, without "Ready for Done" (D17).
 */
function shownBriefs() {
  const briefs = board && board.result ? board.result.briefs : [];
  return briefs.map((b) => (b.status === 'active' && isMoving(b.number)
    ? { ...b, status: 'done', readyForDone: false }
    : b));
}

/** The board's brief with this number, as shown, or null. */
function boardBrief(number) {
  return shownBriefs().find((b) => b.number === number) || null;
}

function renderEmpty(canOpenWeb) {
  return `<div class="cloud-briefs-state cloud-briefs-empty">
      <h3>No briefs yet</h3>
      <p>Nothing in this project is proposed or decided yet.</p>
      <div class="cloud-briefs-empty-actions">
        <button type="button" class="cloud-briefs-primary-btn" data-action="new-brief" tabindex="-1">New brief</button>
        ${canOpenWeb ? '<button type="button" class="cloud-briefs-web-btn" data-action="open-web" tabindex="-1">Open on web</button>' : ''}
      </div>
    </div>`;
}

// ─── Rendering: states ────────────────────────────────────────

function renderLoading() {
  setHeader({ count: null, canOpenWeb: false });
  contentElement.innerHTML = '<div class="cloud-briefs-state cloud-briefs-loading">Loading briefs…</div>';
}

function renderMessage(text) {
  setHeader({ count: null, canOpenWeb: false });
  contentElement.innerHTML = text ? `<div class="cloud-briefs-state"><p>${escapeHtml(text)}</p></div>` : '';
}

function renderError(reason) {
  setHeader({ count: null, canOpenWeb: false });
  contentElement.innerHTML = `<div class="cloud-briefs-state cloud-briefs-error">
      <p>${escapeHtml(copy.reasonMessage(reason))}</p>
      <button type="button" class="cloud-briefs-web-btn" data-action="retry" tabindex="-1">Retry</button>
    </div>`;
}

function isVisible() {
  return visible;
}


// ─── Detail drawer ────────────────────────────────────────────

/** Slide the drawer in, in `mode`. The drawer's Refresh belongs to a brief, not to the form. */
function showDrawer(mode) {
  drawerMode = mode;
  detailContentElement.scrollTop = 0;
  if (detailRefreshButton) detailRefreshButton.hidden = mode !== 'detail';
  detailElement.classList.add('has-selection');
  detailElement.setAttribute('aria-hidden', 'false');
}

function openDetail(number, tab = 'description') {
  if (!detailElement || !detailContentElement) return;
  cloudBriefsForm.close();
  detail = { number, tab, result: null };
  detailContentElement.innerHTML = '<div class="cloud-briefs-detail-body"><div class="cloud-briefs-state cloud-briefs-loading">Loading brief…</div></div>';
  showDrawer('detail');
  loadDetail();
}

/** The New brief form in the drawer, empty each time it opens. */
function openNewBrief() {
  if (!detailElement || !detailContentElement || !visible) return;
  if (drawerMode === 'new' && cloudBriefsForm.isPending()) return;
  detailSeq += 1; // a brief still loading lands nowhere
  detail = null;
  showDrawer('new');
  cloudBriefsForm.open(detailContentElement, { onCreated: onBriefCreated });
}

/** A brief was created: back to the board, which reloads to show it. A link that failed leaves a notice. */
function onBriefCreated({ number, attachmentError }) {
  closeDrawer();
  notice = attachmentError ? copy.attachmentNotice(number, attachmentError) : null;
  load();
}

/** Back and Esc: close the drawer, unless a create is still running. */
function leaveDrawer() {
  if (drawerMode === 'new' && cloudBriefsForm.isPending()) return;
  closeDrawer();
}

/** Close the drawer in either mode. An unsent form is discarded. */
function closeDrawer() {
  detailSeq += 1;
  detail = null;
  if (drawerMode === 'new') cloudBriefsForm.close();
  drawerMode = null;
  if (!detailElement) return;
  if (detailRefreshButton) detailRefreshButton.hidden = false;
  detailElement.classList.remove('has-selection');
  detailElement.setAttribute('aria-hidden', 'true');
}

async function loadDetail() {
  if (!detail) return;
  const path = state.getProjectPath();
  const number = detail.number;
  const seq = ++detailSeq;
  let result;
  try {
    result = path
      ? await ipcRenderer.invoke(IPC.CLOUD_BRIEF_GET, path, number)
      : { ok: false, reason: 'notConnected' };
  } catch (err) {
    console.error('cloudBriefsPanel: could not load the brief', err);
    result = { ok: false, reason: 'other' };
  }
  if (seq !== detailSeq || !detail || detail.number !== number) return;
  if (result && result.ok) {
    detail.result = result;
    renderDetail();
    return;
  }
  detail.result = null;
  const reason = result && result.reason;
  if (reason === 'unauthorized') return; // the session push takes the view away
  const message = reason === 'notFound'
    ? 'This brief is no longer on Frame Cloud. It may have been removed.'
    : copy.reasonMessage(reason);
  detailContentElement.innerHTML = `<div class="cloud-briefs-detail-body">
      <div class="cloud-briefs-state cloud-briefs-error">
        <p>${escapeHtml(message)}</p>
        <button type="button" class="cloud-briefs-web-btn" data-action="retry-detail" tabindex="-1">Retry</button>
      </div>
    </div>`;
}

function onDetailClick(event) {
  if (drawerMode !== 'detail') return; // the form wires its own events
  const actionEl = event.target.closest('[data-action]');
  if (!actionEl || !detailContentElement.contains(actionEl)) return;
  const action = actionEl.dataset.action;
  if (action === 'tab') {
    if (!detail || !detail.result) return;
    detail.tab = actionEl.dataset.tab;
    renderDetail();
  } else if (action === 'retry-detail') {
    loadDetail();
  } else if (action === 'open-brief-web') {
    if (detail) openOnWeb(detail.number);
  } else if (action === 'open-milestone-web') {
    openMilestoneOnWeb(actionEl.dataset.milestoneId);
  } else if (action === 'discuss') {
    if (detail && detail.result) discuss(detail.result.brief);
  } else if (action === 'shape') {
    if (detail && detail.result) shape(detail.result.brief);
  } else if (action === 'start-work') {
    if (detail && detail.result) startWork(detail.result.brief);
  } else if (action === 'move-to-work') {
    if (detail && detail.result) openMoveToWork(detail.result.brief);
  } else if (action === 'move') {
    if (detail && detail.result) moveBrief(detail.result.brief);
  } else if (onPartAction(actionEl)) {
    // a part row: open, run or enter its lane
  } else if (action === 'go-to-brief-lane') {
    if (detail) agentDispatch.enterBriefLane(detail.number);
  } else if (action === 'link') {
    event.preventDefault();
    const url = actionEl.dataset.url || '';
    if (isWebUrl(url)) shell.openExternal(url);
  }
}

/** Open a started part's spec or task; a task this folder does not hold (another branch, another machine) says so. */
function openPart(shape, ref) {
  if (!ref) return;
  if (shape === 'spec') {
    agentDispatch.showSpec(ref);
  } else if (!agentDispatch.showTask(ref)) {
    notify.info(copy.partNotHereMessage(ref));
  }
}

/** Only http(s) links leave Frame, and only through the system browser. */
function isWebUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

function renderDetail() {
  const { brief, events, meId, canOpenWeb } = detail.result;
  const kind = copy.KIND_COPY[brief.kind] || copy.KIND_COPY.proposal;
  // A Done brief's reason and date sit where a closed brief's ending does (D4).
  const ending = copy.endingLine(brief) || copy.doneLine(brief);
  const tab = TABS.some((t) => t.key === detail.tab) ? detail.tab : 'description';

  detailContentElement.innerHTML = `<div class="cloud-briefs-detail-body">
      <header class="cloud-briefs-detail-header">
        <div class="cloud-briefs-detail-heading">
          <span class="cloud-briefs-card-head">
            <span class="cloud-briefs-number">#${brief.number}</span>
            <span class="cloud-briefs-kind ${escapeHtml(brief.kind)}">${escapeHtml(kind.badge)}</span>
            <span class="cloud-briefs-status ${escapeHtml(brief.status)}">${escapeHtml(copy.statusLabel(brief.status))}</span>
          </span>
          <h2 class="cloud-briefs-detail-title">${escapeHtml(brief.title)}</h2>
          ${ending ? `<p class="cloud-briefs-ending">${escapeHtml(ending)}</p>` : ''}
        </div>
        <div class="cloud-briefs-detail-actions">
          <span class="cloud-briefs-discuss-slot">${renderDiscussAction(brief, events)}</span>
          ${canOpenWeb ? '<button type="button" class="cloud-briefs-web-btn" data-action="open-brief-web" tabindex="-1">Open on web</button>' : ''}
        </div>
      </header>
      ${renderMeta(brief, events, meId, canOpenWeb)}
      <div class="cloud-briefs-tabs" role="tablist">
        ${TABS.map((t) => `<button type="button" role="tab" class="cloud-briefs-tab${t.key === tab ? ' active' : ''}" aria-selected="${t.key === tab}" data-action="tab" data-tab="${t.key}" tabindex="-1">${escapeHtml(t.label)}${tabCount(t.key, brief, events)}</button>`).join('')}
      </div>
      <div class="cloud-briefs-tab-body" role="tabpanel">${renderTab(tab, brief, events, meId)}</div>
    </div>`;
}

function tabCount(key, brief, events) {
  const n = key === 'parts' ? brief.parts.length
    : key === 'comments' ? brief.comments.length
      : key === 'history' ? events.length
        : 0;
  return n > 0 ? ` <span class="cloud-briefs-tab-count">${n}</span>` : '';
}

function renderMeta(brief, events, meId, canOpenWeb) {
  const milestones = board && board.result ? board.result.milestones || [] : [];
  const milestone = brief.milestoneId ? milestones.find((m) => m.id === brief.milestoneId) : null;
  const created = events.find((e) => e.event === 'created');
  const createdDate = copy.formatDate(brief.createdAt);
  const creator = created ? copy.actorLabel(created.actorId, meId) : '';
  const rows = [];
  if (brief.kind === 'work' && brief.priority) {
    rows.push(['Priority', `<span class="cloud-briefs-priority"><span class="cloud-briefs-priority-dot ${escapeHtml(brief.priority)}" aria-hidden="true"></span>${escapeHtml(copy.priorityLabel(brief.priority))}</span>`]);
  }
  rows.push(['Milestone', milestone && milestone.name
    ? renderMilestoneRow(milestone, canOpenWeb)
    : '<span class="cloud-briefs-muted">None</span>']);
  if (brief.targetBranch) rows.push(['Target branch', `<code>${escapeHtml(brief.targetBranch)}</code>`]);
  if (createdDate) rows.push(['Created', escapeHtml(creator ? `${createdDate} by ${creator}` : createdDate)]);
  return `<dl class="cloud-briefs-meta">${rows.map(([label, value]) => `
      <div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`).join('')}
    </dl>`;
}

/**
 * The detail's Milestone row: the name — a button to its page on the web when
 * the brief has a web link — then its status and, while open, its end date
 * ("Started · Ends Nov 20, 2026"), then Overdue when it is the started
 * milestone and the board counts it overdue, the same count as the strip.
 * Read-only: a brief's milestone changes on the web (D1).
 */
function renderMilestoneRow(milestone, canOpenWeb) {
  const name = canOpenWeb
    ? `<button type="button" class="cloud-briefs-milestone-name" data-action="open-milestone-web" data-milestone-id="${escapeHtml(milestone.id)}" title="${escapeHtml(copy.OPEN_ON_WEB_LABEL)}" tabindex="-1">${escapeHtml(milestone.name)}</button>`
    : `<span class="cloud-briefs-milestone-name">${escapeHtml(milestone.name)}</span>`;
  const facts = copy.milestoneRowFacts(milestone);
  const started = board && board.result ? copy.startedMilestone(board.result.milestones) : null;
  const overdue = Boolean(started) && started.id === milestone.id
    && copy.isOverdue({ ...started, briefs: copy.countsWithBriefs(started, shownBriefs()) }, copy.localToday());
  return `<span class="cloud-briefs-milestone-row">
      ${name}
      ${facts ? `<span class="cloud-briefs-milestone-row-facts">${escapeHtml(facts)}</span>` : ''}
      ${overdue ? renderOverdue() : ''}
    </span>`;
}

// ─── A started brief's parts ──────────────────────────────────

/**
 * Where one started part stands: its local record, its lane, and partStatus's
 * reading of both against its brief's target (a merge counts only into it).
 * A Done brief's rows keep their words but lose Begin and Run (D7) until it
 * moves back to Active.
 */
function partFacts(part, brief) {
  const ref = part.recordRef;
  const isSpec = part.shape === 'spec';
  const record = ref ? (isSpec ? local.specs.get(ref) : local.tasks.get(ref)) : null;
  const lane = ref ? (isSpec ? agentDispatch.getSpecLaneInfo(ref) : agentDispatch.getTaskLaneInfo(ref)) : null;
  const status = copy.partStatus({
    part,
    spec: isSpec ? record || undefined : undefined,
    task: isSpec ? undefined : record || undefined,
    lane,
    target: brief ? brief.targetBranch : undefined,
    tracking: brief ? brief.mergeTracking : undefined,
    done: Boolean(brief) && brief.status === 'done',
    setup: ref && settingUp.has(ref) ? { host: settingUp.get(ref) } : null,
  });
  return { record, lane, status };
}

/**
 * The parts whose new workspace this window is still setting up, by ref →
 * the server's host, or null on this Mac (frame-cloud-start-places D19): from
 * the moment Begin opens the workspace until its lane opens.
 */
const settingUp = new Map();

function markSettingUp(ref, host) {
  if (!ref) return;
  if (host === undefined) settingUp.delete(ref);
  else settingUp.set(ref, host);
  renderPartSlots();
}

/**
 * "PR #N" on a part row: a button that opens the server's pull request URL,
 * or plain text without one. Frame never builds the URL (C3). A Done brief
 * keeps the link: it is a pointer, not an action.
 */
function renderPrLink(pr, attrs) {
  const label = escapeHtml(copy.prLabel(pr.number));
  if (!isWebUrl(pr.url)) return `<span class="cloud-briefs-prow-pr">${label}</span>`;
  return `<button type="button" class="cloud-briefs-prow-pr" data-action="open-pr" ${attrs} data-url="${escapeHtml(pr.url)}" title="${escapeHtml(pr.url)}" tabindex="-1">${label}</button>`;
}

/**
 * A part row's status words. A PR row puts its number first and then
 * "· state" for an open pull request, or the label and then the number for
 * one merged into another base, as the web draws it.
 */
function renderPartStatusText(status, attrs) {
  const pr = status.pr;
  if (!pr) return escapeHtml(status.label);
  const prefix = `${copy.prLabel(pr.number)} · `;
  if (status.label.startsWith(prefix)) {
    return `${renderPrLink(pr, attrs)}<span>· ${escapeHtml(status.label.slice(prefix.length))}</span>`;
  }
  return `<span>${escapeHtml(status.label)}</span>${renderPrLink(pr, attrs)}`;
}

/** The project's active workspaces as the sidebar last loaded them; none before it has. */
function loadedWorkspaces() {
  try {
    // Lazy-required, as openBeginLane reaches it.
    return require('./workspaceSection').getWorkspaces();
  } catch (_) {
    return [];
  }
}

/**
 * The chip naming the workspace a part is in, which selects it
 * (frame-cloud-start-workspace); '' when it is in none. A server part's chip
 * reads `name · host` (frame-cloud-start-on-server D3); while that server is
 * offline it reads `· offline` and cannot be clicked. A part begun in the
 * project checkout reads "project checkout · <branch>" instead, as text
 * (frame-cloud-start-places D10); a workspace on its branch still wins.
 */
function renderPartWorkspace(part, attrs) {
  const ws = copy.partWorkspace(part, loadedWorkspaces());
  if (!ws && part.begunPlace === 'checkout' && part.begunBranch) {
    return `<span class="cloud-briefs-prow-ws checkout" title="${escapeHtml(copy.checkoutRowHint(part.begunBranch))}">${escapeHtml(copy.checkoutRowLabel(part.begunBranch))}</span>`;
  }
  if (!ws) return '';
  const chip = copy.partWorkspaceChip(ws);
  const where = ws.location === 'server' ? ' server' : '';
  if (chip.offline) {
    return `<span class="cloud-briefs-prow-ws${where} offline" title="${escapeHtml(chip.hint)}">${escapeHtml(chip.label)}</span>`;
  }
  return `<button type="button" class="cloud-briefs-prow-ws${where}" data-action="select-part-workspace" ${attrs} data-ws-id="${escapeHtml(ws.id)}" title="${escapeHtml(chip.hint)}" tabindex="-1">${escapeHtml(chip.label)}</button>`;
}

/** Select the workspace a part row's chip names, if it is still listed. */
function selectPartWorkspace(id) {
  const ws = loadedWorkspaces().find((w) => w.id === id);
  if (ws) require('./workspaceSection').select(ws);
}

/**
 * One part of a started `brief`: its shape, its title (which opens its spec
 * or task when this folder holds it), where it stands and the workspace on
 * this Mac it is in, and either its live lane, Run for its next step, or
 * Begin while it waits on the brief.
 */
function renderPartRow(part, brief) {
  const number = brief.number;
  const { record, status } = partFacts(part, brief);
  const attrs = `data-shape="${escapeHtml(part.shape)}" data-ref="${escapeHtml(part.recordRef)}" data-number="${number}" data-part-id="${escapeHtml(part.id)}"`;
  const openLabel = part.shape === 'spec' ? copy.OPEN_SPEC_LABEL : copy.OPEN_TASK_LABEL;
  const title = record
    ? `<button type="button" class="cloud-briefs-prow-title" data-action="open-part" ${attrs} title="${escapeHtml(`${openLabel} · ${part.recordRef}`)}" tabindex="-1">${escapeHtml(part.title)}</button>`
    : `<span class="cloud-briefs-prow-title" title="${escapeHtml(part.recordRef)}">${escapeHtml(part.title)}</span>`;
  const dot = part.shape === 'spec' ? agentDispatch.specStatusDotHtml(part.recordRef) : agentDispatch.taskStatusDotHtml(part.recordRef);
  let action = '';
  if (status.laneName !== null) {
    action = `<button type="button" class="cloud-briefs-prow-lane" data-action="enter-part-lane" ${attrs} tabindex="-1">${dot}<span>${escapeHtml(copy.laneLine(status.laneName))}</span></button>`;
  } else if (status.run) {
    action = `<button type="button" class="cloud-briefs-prow-run${status.run === 'begin' ? ' begin' : ''}" data-action="run-part" data-run="${escapeHtml(status.run)}" ${attrs} title="${escapeHtml(copy.runHint(status.run))}" tabindex="-1">${escapeHtml(copy.runLabel(status.run))}</button>`;
  }
  return `<div class="cloud-briefs-prow tone-${escapeHtml(status.tone)}">
      <span class="cloud-briefs-chip">${escapeHtml(part.shape)}</span>
      ${title}
      <span class="cloud-briefs-prow-status"><span class="cloud-briefs-prow-dot" aria-hidden="true"></span>${renderPartStatusText(status, attrs)}${renderPartWorkspace(part, attrs)}</span>
      <span class="cloud-briefs-prow-action">${action}</span>
    </div>`;
}

/**
 * A started brief's card body: a row per part, a summary line when there is
 * more than one, and on an Active card the first part a person should look
 * at (the web's K2 attention row, D14).
 */
function renderCardParts(brief) {
  const parts = brief.parts.filter((p) => p.recordRef);
  const statuses = parts.map((p) => partFacts(p, brief).status);
  const summary = copy.partsSummary(statuses, brief.mergeTracking);
  const attention = brief.status === 'active'
    ? copy.partAttention(parts.map((p, i) => ({ title: p.title, status: statuses[i] })), brief.targetBranch)
    : '';
  return `<ul class="cloud-briefs-prows">${parts.map((p) => `<li>${renderPartRow(p, brief)}</li>`).join('')}</ul>
    ${summary ? `<p class="cloud-briefs-prows-summary">${escapeHtml(summary)}</p>` : ''}
    ${attention ? `<p class="cloud-briefs-prows-attention">${escapeHtml(attention)}</p>` : ''}`;
}

/** Redraw every part row on screen: the cards' and the open detail's. */
function renderPartSlots() {
  if (!visible) return;
  for (const el of contentElement.querySelectorAll('[data-card-parts]')) {
    const brief = boardBrief(Number(el.dataset.cardParts));
    if (brief && brief.parts) el.innerHTML = renderCardParts(brief);
  }
  if (drawerMode !== 'detail' || !detail || !detail.result) return;
  for (const el of detailContentElement.querySelectorAll('[data-part-row]')) {
    const part = detail.result.brief.parts.find((p) => p.id === el.dataset.partRow);
    if (part) el.innerHTML = renderPartRow(part, detail.result.brief);
  }
}

/** Read the open folder's specs and tasks; the answers arrive as SPEC_DATA-shaped lists and a TASKS_DATA push. */
async function loadLocal() {
  const path = state.getProjectPath();
  if (!path) return;
  if (local.path !== path) local = { path, specs: new Map(), tasks: new Map() };
  ipcRenderer.send(IPC.LOAD_TASKS, path);
  try {
    const specs = await ipcRenderer.invoke(IPC.LIST_SPECS, path);
    onLocalData(path, { specs });
  } catch (err) {
    console.error('cloudBriefsPanel: could not list the folder\'s specs', err);
  }
}

/** A specs list or a tasks.json for `projectPath`: keep it when it is the open folder's, and redraw the rows. */
function onLocalData(projectPath, { specs, tasks }) {
  const path = state.getProjectPath();
  if (!path || projectPath !== path) return;
  if (local.path !== path) local = { path, specs: new Map(), tasks: new Map() };
  if (specs !== undefined) {
    local.specs = new Map((Array.isArray(specs) ? specs : []).filter((sp) => sp && sp.slug).map((sp) => [sp.slug, sp]));
  }
  if (tasks !== undefined) {
    const rows = tasks && Array.isArray(tasks.tasks) ? tasks.tasks : [];
    local.tasks = new Map(rows.filter((t) => t && t.id).map((t) => [t.id, t]));
  }
  renderPartSlots();
}

/** Run a part's next step through the path a spec or a task runs by today. */
function runPart({ shape, ref, run, number, partId }) {
  if (run === 'begin') {
    const n = Number(number);
    if (Number.isInteger(n) && partId) openStartDialog(n, partId);
    return;
  }
  if (shape === 'spec') {
    const spec = local.specs.get(ref);
    const { status } = partFacts({ shape, recordRef: ref });
    if (!spec || !status.run) return;
    agentDispatch.dispatchSpecCommand({ slug: ref, title: spec.title, command: status.run });
    return;
  }
  const task = local.tasks.get(ref);
  if (task) require('./tasksPanel').openRunFlow(task);
}

/** Enter a part's live lane. */
function enterPartLane(shape, ref) {
  const lane = shape === 'spec' ? agentDispatch.getSpecLaneInfo(ref) : agentDispatch.getTaskLaneInfo(ref);
  if (lane) agentDispatch.enterLane(lane.terminalId);
}

/** A part row's click, on a card or in the detail. → handled? */
function onPartAction(actionEl) {
  const { action, shape, ref } = actionEl.dataset;
  if (!ref) return false;
  if (action === 'open-part') openPart(shape, ref);
  else if (action === 'run-part') {
    const { run, number, partId } = actionEl.dataset;
    runPart({ shape, ref, run, number, partId });
  }
  else if (action === 'enter-part-lane') enterPartLane(shape, ref);
  else if (action === 'select-part-workspace') selectPartWorkspace(actionEl.dataset.wsId);
  else if (action === 'open-pr') {
    const url = actionEl.dataset.url || '';
    if (isWebUrl(url)) shell.openExternal(url);
  }
  else return false;
  return true;
}

function renderTab(tab, brief, events, meId) {
  if (tab === 'parts') {
    if (brief.parts.length === 0) return '<p class="cloud-briefs-muted">Parts appear once the brief is shaped.</p>';
    // A definition is network content: escaped plain text, pre-wrapped, never markdown.
    const summary = brief.startedAt
      ? copy.partsSummary(brief.parts.filter((p) => p.recordRef).map((p) => partFacts(p, brief).status), brief.mergeTracking)
      : '';
    const since = [copy.shapedLine(brief.shapedAt), copy.startedLine(brief.startedAt), summary].filter(Boolean).join(' · ');
    return `${since ? `<p class="cloud-briefs-muted cloud-briefs-shaped">${escapeHtml(since)}</p>` : ''}
      <ol class="cloud-briefs-parts">${brief.parts.map((part) => `
        <li>
          ${brief.startedAt && part.recordRef ? `<div class="cloud-briefs-prow-slot" data-part-row="${escapeHtml(part.id)}">${renderPartRow(part, brief)}</div>` : `
          <span class="cloud-briefs-part-head">
            <span class="cloud-briefs-part-title">${escapeHtml(part.title)}</span>
            <span class="cloud-briefs-chip">${escapeHtml(part.shape)}</span>
            <span class="cloud-briefs-chip">${escapeHtml(part.type)}</span>
          </span>`}
          ${part.definition ? `<details class="cloud-briefs-part-definition">
            <summary>${escapeHtml(copy.PART_DEFINITION_LABEL)}</summary>
            <p class="cloud-briefs-text">${escapeHtml(part.definition)}</p>
          </details>` : ''}
        </li>`).join('')}
      </ol>`;
  }
  if (tab === 'comments') {
    if (brief.comments.length === 0) return '<p class="cloud-briefs-muted">No comments yet.</p>';
    const fresh = copy.newCommentIds(brief.comments, events, meId);
    return `<div class="cloud-briefs-rediscuss-slot">${renderRediscuss(brief, events, meId)}</div>
      <ul class="cloud-briefs-comments">${brief.comments.map((c) => `
        <li${fresh.has(c.id) ? ' class="new"' : ''}>
          <span class="cloud-briefs-byline">${escapeHtml(copy.actorLabel(c.authorId, meId))} · ${escapeHtml(copy.formatDate(c.createdAt))}${fresh.has(c.id) ? ' <span class="cloud-briefs-new-tag">New</span>' : ''}</span>
          <p class="cloud-briefs-text">${escapeHtml(c.text)}</p>
        </li>`).join('')}
      </ul>`;
  }
  if (tab === 'history') {
    if (events.length === 0) return '<p class="cloud-briefs-muted">No history yet.</p>';
    return `<ol class="cloud-briefs-history">${events.map((e) => {
      const line = copy.eventSentence(e, meId);
      return `<li><span>${escapeHtml(line.sentence)}</span> <span class="cloud-briefs-muted">${escapeHtml(line.date)}</span></li>`;
    }).join('')}
      </ol>`;
  }
  // Description: the body as plain text (never markdown — this is network
  // content), the discussions held on it, then the attachments as links.
  const body = brief.body
    ? `<p class="cloud-briefs-text">${escapeHtml(brief.body)}</p>`
    : '<p class="cloud-briefs-muted">No description.</p>';
  const attachments = brief.attachments.length > 0
    ? `<section class="cloud-briefs-attachments" aria-label="Attachments">
        <h3>AI conversations &amp; links</h3>
        <ul>${brief.attachments.map((a) => `
          <li>${isWebUrl(a.url)
            ? `<a href="#" data-action="link" data-url="${escapeHtml(a.url)}" title="${escapeHtml(a.url)}">${escapeHtml(a.title || a.url)}</a>`
            : `<span title="${escapeHtml(a.url)}">${escapeHtml(a.title || a.url)}</span>`}</li>`).join('')}
        </ul>
      </section>`
    : '';
  return body + renderDiscussions(events, meId, brief.attachments) + attachments;
}

/** The discussion records, newest first; absent rather than empty when none was recorded, as on the web. */
function renderDiscussions(events, meId, attachments) {
  const records = copy.discussionRecords(events, meId, attachments);
  if (records.length === 0) return '';
  return `<section class="cloud-briefs-discussions" aria-label="${escapeHtml(copy.DISCUSSIONS_TITLE)}">
      <h3>${escapeHtml(copy.DISCUSSIONS_TITLE)}</h3>
      <ul>${records.map((r) => `
        <li>
          <span class="cloud-briefs-byline">
            ${escapeHtml(r.date ? `${r.date} · ${r.actor}` : r.actor)}
            ${r.provider ? `<span class="cloud-briefs-chip">${escapeHtml(r.provider)}</span>` : ''}
          </span>
          <p class="cloud-briefs-text">${escapeHtml(r.summary)}</p>
          ${r.inLinks
            ? `<span class="cloud-briefs-muted">${escapeHtml(copy.WRITE_UP_IN_LINKS)}</span>`
            : r.url ? `<a href="#" data-action="link" data-url="${escapeHtml(r.url)}" title="${escapeHtml(r.url)}">${escapeHtml(copy.WRITE_UP_LABEL)}</a>` : ''}
        </li>`).join('')}
      </ul>
    </section>`;
}

// ─── Discuss ──────────────────────────────────────────────────

/**
 * The detail header's controls, by the same stages as the card: Go to
 * discussion or Go to shaping while a lane is open (whatever the brief has
 * become since), Discuss before any record, Move to Work + Discuss after one,
 * Shape on open unshaped work, Start Work on open shaped work (even while its
 * Shape lane is still open), Move to Done or Move back to Active on started
 * work (beside an open lane's button), nothing for an ended brief.
 */
function renderDiscussAction(brief, events) {
  const lane = agentDispatch.getBriefLaneInfo(brief.number);
  if (copy.workStage({ brief, laneOpen: Boolean(lane) }) === 'start') return startWorkButton(brief.number, 'start-work');
  const move = moveButton(brief, 'move');
  if (lane) {
    return `<button type="button" class="cloud-briefs-web-btn cloud-briefs-discuss-btn" data-action="go-to-brief-lane" title="${escapeHtml(copy.laneLabel(lane.purpose, lane.name))}" tabindex="-1">${agentDispatch.briefStatusDotHtml(brief.number)}${escapeHtml(goToLaneLabel(lane))}</button>${move}`;
  }
  if (move) return move;
  if (copy.workStage({ brief, laneOpen: false }) === 'shape') return shapeButton(brief.number, 'shape');
  const discussionCount = copy.discussionRecords(events).length;
  const stage = copy.proposalStage({ brief, laneOpen: false, discussionCount });
  if (stage === 'discuss') return discussButton(brief.number, 'primary', 'discuss');
  if (stage === 'decide') return `${moveToWorkButton(brief.number, 'move-to-work')}${discussButton(brief.number, 'secondary', 'discuss')}`;
  return '';
}

/**
 * Above the comments, when someone commented after the latest record and no
 * lane is open: how many are new, and Re-discuss — a Discuss whose prompt
 * opens on them.
 */
function renderRediscuss(brief, events, meId) {
  const lane = agentDispatch.getBriefLaneInfo(brief.number);
  const stage = copy.proposalStage({ brief, laneOpen: Boolean(lane), discussionCount: copy.discussionRecords(events).length });
  const count = copy.newCommentIds(brief.comments, events, meId).size;
  if (stage !== 'decide' || count === 0) return '';
  return `<div class="cloud-briefs-rediscuss">
      <span>${escapeHtml(copy.newCommentsLabel(count))} since the last discussion.</span>
      ${discussButton(brief.number, 'primary', 'discuss', copy.REDISCUSS_LABEL, copy.REDISCUSS_HINT)}
    </div>`;
}

// ─── Move to Work ─────────────────────────────────────────────

let decideDialog = null; // { el, number, pending }

/** A confirm with a priority (Medium by default), as the web's Transform to Work. */
function openMoveToWork(brief) {
  if (decideDialog) return;
  const el = document.createElement('div');
  el.className = 'cloud-briefs-dialog-backdrop';
  const id = `cloud-briefs-decide-${brief.number}`;
  el.innerHTML = `<div class="cloud-briefs-dialog" role="dialog" aria-modal="true" aria-labelledby="${id}-title">
      <h3 id="${id}-title">${escapeHtml(`${copy.MOVE_TO_WORK_LABEL} · #${brief.number}`)}</h3>
      <p class="cloud-briefs-muted">${escapeHtml(copy.MOVE_TO_WORK_DESCRIPTION)}</p>
      <div class="cloud-briefs-field">
        <label class="cloud-briefs-label" for="${id}-priority">Priority</label>
        <select id="${id}-priority" class="cloud-briefs-input cloud-briefs-select" data-ref="priority">
          ${['high', 'medium', 'low'].map((p) => `<option value="${p}"${p === 'medium' ? ' selected' : ''}>${escapeHtml(copy.priorityLabel(p))}</option>`).join('')}
        </select>
      </div>
      <p class="cloud-briefs-form-error" data-ref="error" hidden></p>
      <div class="cloud-briefs-form-actions">
        <button type="button" class="cloud-briefs-web-btn" data-ref="cancel">Cancel</button>
        <button type="button" class="cloud-briefs-primary-btn" data-ref="confirm">${escapeHtml(copy.MOVE_TO_WORK_LABEL)}</button>
      </div>
    </div>`;
  decideDialog = { el, number: brief.number, pending: false };
  const ref = (name) => el.querySelector(`[data-ref="${name}"]`);
  el.addEventListener('click', (e) => {
    if (e.target === el || e.target === ref('cancel')) closeMoveToWork();
    else if (e.target === ref('confirm')) confirmMoveToWork(ref('priority').value);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeMoveToWork();
    }
  });
  document.body.appendChild(el);
  ref('priority').focus();
}

function closeMoveToWork() {
  if (!decideDialog || decideDialog.pending) return;
  decideDialog.el.remove();
  decideDialog = null;
}

async function confirmMoveToWork(priority) {
  const dialog = decideDialog;
  if (!dialog || dialog.pending) return;
  const path = state.getProjectPath();
  const confirmBtn = dialog.el.querySelector('[data-ref="confirm"]');
  const errorEl = dialog.el.querySelector('[data-ref="error"]');
  dialog.pending = true;
  confirmBtn.disabled = true;
  confirmBtn.textContent = `${copy.MOVE_TO_WORK_LABEL}…`;
  errorEl.hidden = true;
  let result;
  try {
    result = path
      ? await ipcRenderer.invoke(IPC.CLOUD_BRIEF_DECIDE, path, dialog.number, priority)
      : { ok: false, reason: 'notConnected' };
  } catch (err) {
    console.error('cloudBriefsPanel: could not move the proposal to work', err);
    result = { ok: false, reason: 'other' };
  }
  dialog.pending = false;
  if (result && result.ok) {
    closeMoveToWork();
    load();
    if (detail && detail.number === dialog.number) loadDetail();
    return;
  }
  confirmBtn.disabled = false;
  confirmBtn.textContent = copy.MOVE_TO_WORK_LABEL;
  errorEl.textContent = copy.decideErrorMessage(result && result.reason);
  errorEl.hidden = false;
}

// ─── Move to Done and back (manual Done) ──────────────────────

/** The server's limit on a reason (FrameCloud `BRIEF_TEXT_MAX`). */
const REASON_MAX = 10000;

/**
 * The refusals that say the panel's view was stale: the sentence is shown and
 * the board read again, never the move retried (D21). A failure to reach the
 * cloud leaves the board as it is.
 */
const STALE_MOVE_REASONS = new Set(['alreadyDone', 'notDone', 'notStarted', 'alreadyClosed', 'notWork', 'notFound', 'reasonRequired']);

/** Where a brief's move goes: 'done' for Active work, 'active' for Done work, null for anything else. */
function moveDirection(brief) {
  const b = brief || {};
  if (b.kind !== 'work' || !b.startedAt) return null;
  if (b.status === 'active') return 'done';
  if (b.status === 'done') return 'active';
  return null;
}

/**
 * Move to Done on Active work, Move back to Active on Done work, and the
 * disabled "Moving to Done…" while a move is on its way; '' for a backlog,
 * proposal or closed brief.
 */
function moveButton(brief, action) {
  const to = moveDirection(brief);
  if (!to) return '';
  const n = brief.number;
  if (isMoving(n)) {
    return `<button type="button" class="cloud-briefs-web-btn cloud-briefs-move-btn" disabled tabindex="-1">${escapeHtml(copy.MOVING_TO_DONE_LABEL)}</button>`;
  }
  const label = to === 'done' ? copy.MOVE_TO_DONE_LABEL : copy.MOVE_BACK_LABEL;
  return `<button type="button" class="cloud-briefs-web-btn cloud-briefs-move-btn" data-action="${action}" data-number="${n}" tabindex="-1">${escapeHtml(label)}</button>`;
}

function movingKey(path, number) {
  return `${path}\0${number}`;
}

/** Whether brief `number` of the open folder (or of `path`) has a move to Done on its way. */
function isMoving(number, path = state.getProjectPath()) {
  return Boolean(path) && moving.has(movingKey(path, number));
}

/**
 * A move button was pressed. The panel decides from its last read (D5): a
 * move to Done with nothing to explain is held for Undo without a dialog;
 * one that leaves a part unmerged on a tracked project, and every move back,
 * asks for a reason first and is sent at once.
 */
function moveBrief(brief) {
  const to = moveDirection(brief);
  if (!to || isMoving(brief.number) || moveDialog) return;
  if (to === 'active' || copy.needsReason(brief)) {
    openMoveDialog({ brief, to });
    return;
  }
  holdMoveToDone(brief);
}

async function invokeMove(path, number, options) {
  if (!path) return { ok: false, reason: 'notConnected' };
  try {
    return await ipcRenderer.invoke(IPC.CLOUD_BRIEF_MOVE, path, number, options);
  } catch (err) {
    console.error('cloudBriefsPanel: could not move the brief', err);
    return { ok: false, reason: 'other' };
  }
}

/**
 * A move to Done with nothing to explain (D1, D3, D17, D18): the card shows
 * in Done at once, a "Moved #N to Done" toast offers Undo for exactly
 * HOLD_MS, and main holds the move that long — sending it when the time
 * passes, when another move starts, or when Frame quits. The invoke answers
 * once the move was sent (or undone), whatever view is on screen by then.
 */
async function holdMoveToDone(brief) {
  const n = brief.number;
  const path = state.getProjectPath();
  if (!path) return;
  const key = movingKey(path, n);
  moving.add(key);
  redrawMove(path, n);
  notify.success(copy.movedNotice(n), {
    action: { label: copy.UNDO_LABEL, onClick: () => undoHeldMove(path, n) },
    visibleMs: HOLD_MS,
  });
  const result = await invokeMove(path, n, { to: 'done', hold: true });
  moving.delete(key);
  // Home's tracker last heard counts that held this move. Left behind with
  // the panel gone, it reads the milestone again now that the move settled (D20).
  if (!visible) homeData().refresh('milestone');
  if (result && result.ok) {
    // Main says it is Done: keep the card there until the re-read lands, so
    // a redraw in between cannot flash it back to Active.
    markDone(path, n);
    reloadAfterMove(path, n);
    return;
  }
  const reason = (result && result.reason) || 'other';
  redrawMove(path, n);
  if (reason === 'undone' || reason === 'unauthorized') return; // Undo says nothing; a sign-out takes the view away
  if (reason === 'reasonRequired') {
    reaskWithReason(path, n);
    return;
  }
  notify.error(copy.moveErrorMessage(reason));
  if (STALE_MOVE_REASONS.has(reason)) reloadAfterMove(path, n);
}

/** Undo on the toast: main cancels the held move, whose invoke then answers `undone`. */
function undoHeldMove(path, number) {
  ipcRenderer.invoke(IPC.CLOUD_BRIEF_MOVE_UNDO, path, number).catch((err) => {
    console.error('cloudBriefsPanel: could not undo the move', err);
  });
}

/**
 * A move sent without a reason came back `REASON_REQUIRED`: the panel's view
 * was stale (a part it thought merged is not). Read the brief again and ask
 * for the reason on its fresh parts (D8), unless the user has moved on to
 * another folder or another dialog.
 */
async function reaskWithReason(path, number) {
  let result;
  try {
    result = await ipcRenderer.invoke(IPC.CLOUD_BRIEF_GET, path, number);
  } catch (err) {
    console.error('cloudBriefsPanel: could not read the brief again', err);
    result = { ok: false, reason: 'other' };
  }
  reloadAfterMove(path, number);
  if (path !== state.getProjectPath()) return;
  if (!result || !result.ok) {
    if (!result || result.reason !== 'unauthorized') notify.error(copy.moveErrorMessage(result && result.reason));
    return;
  }
  if (moveDirection(result.brief) !== 'done') return; // it moved meanwhile; the reload shows where
  if (moveDialog) {
    notify.error(copy.moveErrorMessage('reasonRequired'));
    return;
  }
  openMoveDialog({ brief: result.brief, to: 'done' });
}

/** Redraw what a held move changes: the board (its overlay) and the brief's controls. */
function redrawMove(path, number) {
  if (!visible || path !== state.getProjectPath()) return;
  if (board && board.path === path) renderBoard();
  renderLaneSlots(number);
}

/** The cached board brief is Done now (main said so); the re-read confirms it. */
function markDone(path, number) {
  if (!board || board.path !== path) return;
  const brief = board.result.briefs.find((b) => b.number === number);
  if (brief && brief.status === 'active') {
    brief.status = 'done';
    brief.readyForDone = false;
  }
}

/** A move landed or was refused as stale: the board, and the brief when it is the one on screen, read again. */
function reloadAfterMove(path, number) {
  if (!visible || path !== state.getProjectPath()) return;
  load();
  if (drawerMode === 'detail' && detail && detail.number === number) loadDetail();
}

let moveDialog = null; // { el, number, to, label, pending }

/** "2 parts not merged into main.", then each missing part with its row's status. */
function renderMissingParts(brief, missing) {
  if (missing.length === 0) return '';
  return `<div class="cloud-briefs-move-missing">
      <p>${escapeHtml(copy.missingPartsLine(missing.length, brief.targetBranch))}</p>
      <ul aria-label="Parts not merged">${missing.map((part) => `
        <li>
          <span class="cloud-briefs-move-missing-title">${escapeHtml(part.title)}</span>
          <span class="cloud-briefs-move-missing-status">${escapeHtml(partFacts(part, brief).status.label)}</span>
        </li>`).join('')}
      </ul>
    </div>`;
}

/**
 * The reason dialog, for both directions (D20), built like Move to Work's:
 * a move to Done that leaves parts unmerged lists them under "N parts not
 * merged into <target>."; a move back says what it reopens. Confirm waits
 * for a reason, and the move is sent at once, with no Undo.
 */
function openMoveDialog({ brief, to }) {
  if (moveDialog) return;
  const n = brief.number;
  const toDone = to === 'done';
  const label = toDone ? copy.MOVE_TO_DONE_ANYWAY_LABEL : copy.MOVE_BACK_LABEL;
  const el = document.createElement('div');
  el.className = 'cloud-briefs-dialog-backdrop';
  const id = `cloud-briefs-move-${n}`;
  el.innerHTML = `<div class="cloud-briefs-dialog" role="dialog" aria-modal="true" aria-labelledby="${id}-title" aria-describedby="${id}-description">
      <h3 id="${id}-title">${escapeHtml(toDone ? copy.moveToDoneTitle(n) : copy.moveBackTitle(n))}</h3>
      <p id="${id}-description" class="cloud-briefs-muted">${escapeHtml(toDone ? copy.moveToDoneDescription(brief.targetBranch) : copy.MOVE_BACK_DESCRIPTION)}</p>
      ${toDone ? renderMissingParts(brief, copy.missingParts(brief)) : ''}
      <div class="cloud-briefs-field">
        <label class="cloud-briefs-label" for="${id}-reason">${escapeHtml(copy.REASON_LABEL)}</label>
        <textarea id="${id}-reason" class="cloud-briefs-input cloud-briefs-move-reason" rows="3" maxlength="${REASON_MAX}" data-ref="reason"></textarea>
      </div>
      <p class="cloud-briefs-form-error" data-ref="error" hidden></p>
      <div class="cloud-briefs-form-actions">
        <button type="button" class="cloud-briefs-web-btn" data-ref="cancel">${escapeHtml(copy.CANCEL_LABEL)}</button>
        <button type="button" class="cloud-briefs-primary-btn" data-ref="confirm" disabled>${escapeHtml(label)}</button>
      </div>
    </div>`;
  moveDialog = { el, number: n, to, label, pending: false };
  const ref = (name) => el.querySelector(`[data-ref="${name}"]`);
  const reason = () => ref('reason').value.trim();
  el.addEventListener('click', (e) => {
    if (e.target === el || e.target === ref('cancel')) closeMoveDialog();
    else if (e.target === ref('confirm')) confirmMove(reason());
  });
  el.addEventListener('input', () => {
    if (moveDialog && !moveDialog.pending) ref('confirm').disabled = reason() === '';
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeMoveDialog();
    }
  });
  document.body.appendChild(el);
  ref('reason').focus();
}

function closeMoveDialog() {
  if (!moveDialog || moveDialog.pending) return;
  moveDialog.el.remove();
  moveDialog = null;
}

async function confirmMove(reason) {
  const dialog = moveDialog;
  if (!dialog || dialog.pending || !reason) return;
  const confirmBtn = dialog.el.querySelector('[data-ref="confirm"]');
  const errorEl = dialog.el.querySelector('[data-ref="error"]');
  dialog.pending = true;
  confirmBtn.disabled = true;
  confirmBtn.textContent = `${dialog.label}…`;
  errorEl.hidden = true;
  const path = state.getProjectPath();
  const result = await invokeMove(path, dialog.number, { to: dialog.to, reason });
  dialog.pending = false;
  const failure = result && result.ok ? null : (result && result.reason) || 'other';
  if (!failure || failure === 'unauthorized') {
    closeMoveDialog();
    if (!failure) reloadAfterMove(path, dialog.number);
    return;
  }
  confirmBtn.disabled = dialog.el.querySelector('[data-ref="reason"]').value.trim() === '';
  confirmBtn.textContent = dialog.label;
  errorEl.textContent = copy.moveErrorMessage(failure);
  errorEl.hidden = false;
  if (STALE_MOVE_REASONS.has(failure)) reloadAfterMove(path, dialog.number);
}

// ─── Start Work ───────────────────────────────────────────────

/** Open the Start Work dialog on open, shaped, unstarted work. */
function startWork(brief) {
  openStartDialog(brief.number, null);
}

/** The Start Work dialog, or Begin on part `partId` of a started brief. */
function openStartDialog(number, partId) {
  cloudStartDialog.open({
    number,
    partId,
    onStarted: (result) => {
      notify.success(copy.startedNotice(result));
      const fetchNote = copy.fetchFailedNotice(result);
      if (fetchNote) notify.info(fetchNote);
      const sentNote = copy.sentNotice(result);
      if (sentNote) notify.info(sentNote);
      reloadAfterStart(number);
      openBeginLane(result);
    },
    onPartial: () => reloadAfterStart(number),
  });
}

/**
 * Begin: a lane on the chosen part, in the workspace Start Work created for
 * it (frame-cloud-start-workspace). The workspace is listed and selected; on
 * a Frame Server, Send files is offered first (frame-cloud-start-on-server
 * T12); its setup script runs to the end (as New Workspace runs it, without
 * an agent), and it is selected again, since the user may have moved during setup.
 * Meanwhile the part's row reads "Setting up…" (frame-cloud-start-places D19).
 * A part begun in the project checkout has no workspace and no setup: the
 * checkout is selected and git status refreshed, since its branch just
 * changed (D20).
 * Then the lane opens through the paths a spec or a task runs by today:
 * `/spec.plan` for a spec, the task run for a task, which names the main
 * checkout's tasks.json and then goes in progress there. Frame opened the
 * workspace (or switched the checkout) on the part's branch, so the task
 * stays on it.
 */
async function openBeginLane(result) {
  const begin = result && result.begin;
  if (!begin) return;
  const path = state.getProjectPath();
  if (!path) return;
  if (result.place === 'checkout') {
    require('./workspaceSection').selectSpecWorkspace(null);
    ipcRenderer.send(IPC.REFRESH_GIT_STATUS);
  } else if (result.workspace) {
    const ref = result.part && result.part.ref;
    markSettingUp(ref, result.workspace.location === 'server' ? (result.workspace.host || null) : null);
    let opened;
    try {
      opened = await selectBegunWorkspace(path, result.workspace, result.setupScript);
    } finally {
      markSettingUp(ref, undefined);
    }
    if (!opened) return; // another project now: the lane is not opened anywhere
  }
  if (begin.shape === 'spec') {
    await agentDispatch.dispatchSpecCommand({ slug: begin.slug, title: begin.title, command: 'spec.plan' });
    return;
  }
  if (!begin.task) return;
  // Lazy-required: tasksPanel reaches agentDispatch lazily too, and neither needs the other at load.
  const ok = await require('./tasksPanel').runTaskWithOptions(begin.task, {
    branchMode: 'current',
    tasksPath: begin.tasksPath || undefined,
  });
  if (!ok) return;
  ipcRenderer.send(IPC.UPDATE_TASK, { projectPath: path, taskId: begin.task.id, updates: { status: 'in_progress' } });
}

/**
 * Select the begun part's new workspace, wait for its setup script, and
 * select it again. → false when the project changed meanwhile.
 */
async function selectBegunWorkspace(path, workspace, setupScript) {
  // Lazy-required, as agentDispatch reaches them: neither is needed at load.
  const section = require('./workspaceSection');
  const pick = () => {
    const listed = section.getWorkspaces().find((w) => w.id === workspace.id);
    section.select(listed || workspace);
  };
  await section.load();
  if (state.getProjectPath() !== path) return false;
  pick();
  // A server workspace has only what git carries: offer the files git leaves
  // out before setup runs, as New Workspace does (server-copy-files, T12).
  if (workspace.location === 'server') {
    const listed = section.getWorkspaces().find((w) => w.id === workspace.id) || workspace;
    try {
      const sendFiles = require('./sendFilesModal');
      const picked = await sendFiles.open({ projectPath: path, workspace: listed, context: 'create' });
      if (picked && picked.sent) notify.info(sendFiles.summary(picked.sent));
    } catch (err) {
      console.error('cloudBriefsPanel: could not offer files for the server workspace', err);
    }
    if (state.getProjectPath() !== path) return false;
  }
  if (setupScript) {
    try {
      await require('./newWorkspaceModal').runSetupThenAgent({ setupScript, openAgent: false });
    } catch (err) {
      console.error('cloudBriefsPanel: the setup script of the begun workspace failed', err);
    }
    if (state.getProjectPath() !== path) return false;
    pick();
  }
  return true;
}

/** The brief is started in the cloud: reload the board (the card moves to Active) and the brief when it is on screen. */
function reloadAfterStart(number) {
  if (!visible) return;
  load();
  if (drawerMode === 'detail' && detail && detail.number === number) loadDetail();
}

/**
 * Open a lane with the current AI tool and hand it main's prompt for
 * `purpose` ('discuss' or 'shape'). One lane per brief: an open one, of
 * either purpose, is entered instead.
 */
async function startLane(brief, { purpose, channel, errorMessage }) {
  const number = brief.number;
  if (starting !== null) return;
  if (agentDispatch.enterBriefLane(number)) return;
  const path = state.getProjectPath();
  const tool = aiToolSelector.getCurrentTool();
  const toolId = tool ? tool.id : null;
  if (!path) return;
  starting = number;
  renderLaneSlots(number);
  try {
    let result;
    try {
      result = await ipcRenderer.invoke(channel, path, number, toolId);
    } catch (err) {
      console.error(`cloudBriefsPanel: could not start the ${purpose} lane`, err);
      result = { ok: false, reason: 'other' };
    }
    if (!result || !result.ok) {
      if (!result || result.reason !== 'unauthorized') notify.error(errorMessage(result && result.reason));
      return;
    }
    // Another click may have opened the lane while main answered.
    if (agentDispatch.enterBriefLane(number)) return;
    await agentDispatch.dispatch({
      createNew: true,
      toolId,
      prompt: result.prompt,
      assignment: { kind: 'brief', purpose, label: `brief #${number}: ${brief.title}`, ref: number },
    });
  } finally {
    starting = null;
    renderLaneSlots(number);
  }
}

/** Discuss an open proposal in a new lane. */
function discuss(brief) {
  return startLane(brief, { purpose: 'discuss', channel: IPC.CLOUD_BRIEF_DISCUSS, errorMessage: copy.discussErrorMessage });
}

/** Shape open, unshaped work in a new lane. */
function shape(brief) {
  return startLane(brief, { purpose: 'shape', channel: IPC.CLOUD_BRIEF_SHAPE, errorMessage: copy.shapeErrorMessage });
}

/** Redraw the cards' lane controls and the detail's Discuss / Shape / Go to the lane. `number` null means any brief. */
function renderLaneSlots(number) {
  if (!visible) return;
  for (const el of contentElement.querySelectorAll('[data-card-actions]')) {
    const brief = boardBrief(Number(el.dataset.cardActions));
    if (brief && (number == null || brief.number === number)) el.innerHTML = renderCardActions(brief);
  }
  if (drawerMode !== 'detail' || !detail || !detail.result) return;
  if (number != null && detail.number !== number) return;
  const slot = detailContentElement.querySelector('.cloud-briefs-discuss-slot');
  if (slot) slot.innerHTML = renderDiscussAction(detail.result.brief, detail.result.events);
  const rediscuss = detailContentElement.querySelector('.cloud-briefs-rediscuss-slot');
  if (rediscuss) rediscuss.innerHTML = renderRediscuss(detail.result.brief, detail.result.events, detail.result.meId);
}

/**
 * A Shape landed. For the open folder, a toast says so wherever the user is —
 * usually in the Shape lane — with Open brief; then the board reloads as for
 * any write.
 */
function onBriefShaped(payload) {
  const { folderPath, number, count } = payload || {};
  if (!folderPath || folderPath !== state.getProjectPath() || !Number.isInteger(number)) return;
  notify.success(copy.shapedNotice(number, count), {
    action: { label: copy.OPEN_BRIEF_LABEL, onClick: () => openBrief(number) },
  });
  onBriefWritten(payload);
}

/** A record or a shape landed: reload the board (its counts and buttons) and the brief when it is the one on screen. */
function onBriefWritten(payload) {
  const { folderPath, number } = payload || {};
  if (!visible || folderPath !== state.getProjectPath()) return;
  load();
  if (drawerMode === 'detail' && detail && detail.number === number) loadDetail();
}

/**
 * Main reported a part's branch or finish to the cloud (frame-cloud-brief-done):
 * reload the board and the open brief, which now read the cloud's answer.
 */
function onBriefsChanged(payload) {
  const { folderPath } = payload || {};
  if (!visible || !folderPath || folderPath !== state.getProjectPath()) return;
  load();
  if (drawerMode === 'detail' && detail) loadDetail();
}

module.exports = {
  init,
  show,
  hide,
  isVisible,
  isAvailable,
  openBrief,
  openMilestone,
};
