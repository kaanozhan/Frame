/**
 * queueView — the Queue center view (work-queue spec, T05).
 *
 * The project's queues as one ordered list: this Mac's items first, then
 * each server's, every row with its state, host, worktree/branch and the
 * terminal working it. Rows reorder by drag (within their own machine —
 * main splits an order per home), and carry the actions their state allows:
 * Remove, Open source, Done (review), Continue (needs you), Reset, and for a
 * spec the flow mode (full auto by default, step by step).
 *
 * Mounted inline by multiTerminalUI like the Specs and Tasks dashboards
 * (`mountInline` / `isInlineMounted` / `notifyDetached`). The element is
 * built here; nothing lives in index.html. It also owns the queue's data
 * for the renderer: QUEUE_DATA pushes land here, and `count()` /
 * `onChange()` feed the sidebar row.
 *
 * Drag sources (task tiles, spec cards — T06/T07) put a JSON source under
 * SOURCE_MIME; `acceptDrops(el)` makes any element a drop target that adds
 * it to the queue.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const state = require('./state');
const notify = require('./notify');
const { moveId } = require('./dnd/reorder');

const SOURCE_MIME = 'application/x-frame-queue-source';
const ITEM_MIME = 'application/x-frame-queue-item';

const STATE_LABELS = {
  queued: 'Queued',
  running: 'Running',
  'needs-you': 'Needs you',
  review: 'Review',
  done: 'Done',
  failed: 'Failed',
  interrupted: 'Interrupted',
  missing: 'Missing'
};

let payload = { projectPath: null, items: [], parallel: 9, parallels: { mac: 9, servers: {} }, serverNotes: [] };
let rootEl = null;
let mounted = false;
const listeners = new Set();
let initialized = false;

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ─── data ───────────────────────────────────────────────────

function init() {
  if (initialized) return;
  initialized = true;
  ipcRenderer.on(IPC.QUEUE_DATA, (event, data) => {
    if (!data || data.projectPath !== state.getProjectPath()) return;
    apply(data);
  });
  state.onProjectChange((projectPath) => {
    payload = { ...payload, projectPath: projectPath || null, items: [], serverNotes: [] };
    emit();
    if (mounted) render();
    if (projectPath) load();
  });
  if (state.getProjectPath()) load();
}

function apply(data) {
  payload = {
    projectPath: data.projectPath,
    items: Array.isArray(data.items) ? data.items : [],
    parallel: data.parallel || 9,
    parallels: data.parallels || { mac: data.parallel || 9, servers: {} },
    serverNotes: Array.isArray(data.serverNotes) ? data.serverNotes : []
  };
  emit();
  if (mounted) render();
}

async function load() {
  const projectPath = state.getProjectPath();
  if (!projectPath) return;
  try {
    const data = await ipcRenderer.invoke(IPC.QUEUE_LOAD, { projectPath });
    if (data && data.projectPath === state.getProjectPath()) apply(data);
  } catch (err) {
    console.error('queueView: load failed', err);
  }
}

function emit() {
  for (const fn of listeners) {
    try { fn(payload); } catch (_) { /* a listener's problem */ }
  }
}

/** Subscribe to queue changes (the sidebar row's count, the Chief lane). */
function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Items not done: the sidebar count. */
function count() {
  return payload.items.filter((it) => it.state !== 'done').length;
}

function items() {
  return payload.items.slice();
}

function current() {
  return payload;
}

/** A task as a queue source: its id, the facts the rules check, and its home. */
function sourceForTask(task) {
  return {
    kind: 'task',
    ref: task.id,
    title: task.title || task.id,
    status: task.status,
    source: task.source || null,
    home: task.location === 'server' ? { location: 'server', serverKey: task.serverKey, serverProjectPath: task.serverProjectPath, host: task.host } : null
  };
}

/** A spec as a queue source; a spec in a server workspace is queued on that server. */
function sourceForSpec(spec) {
  const ws = spec.workspace || null;
  const onServer = ws && ws.serverKey && ws.serverProjectPath;
  return {
    kind: 'spec',
    ref: spec.slug,
    title: spec.title || spec.slug,
    phase: spec.phase,
    malformed: !!spec.malformed,
    home: onServer ? { location: 'server', serverKey: ws.serverKey, serverProjectPath: ws.serverProjectPath, host: ws.host } : null
  };
}

/** Whether a task id / spec slug is queued (not done) — the spec card's icon. */
function isQueued(kind, ref) {
  return payload.items.some((it) => it.kind === kind && it.ref === ref && it.state !== 'done');
}

// ─── actions ────────────────────────────────────────────────

/**
 * Adds a source: `{ kind, ref, title, status?, source?, phase?, malformed?, home? }`.
 * Toasts the outcome; resolves to the main process's reply.
 */
async function addSource(source) {
  const projectPath = state.getProjectPath();
  if (!projectPath || !source) return { ok: false };
  let res;
  try {
    res = await ipcRenderer.invoke(IPC.QUEUE_ADD, { projectPath, source });
  } catch (err) {
    res = { ok: false, error: err.message };
  }
  if (res && res.ok) notify.success(`Queued: ${source.title || source.ref}`);
  else if (res && res.reason === 'duplicate') notify.info(`${source.title || source.ref} is already in the queue`);
  else notify.error((res && res.error) || 'Could not add it to the queue');
  return res || { ok: false };
}

async function call(channel, args, failText) {
  const projectPath = state.getProjectPath();
  if (!projectPath) return { ok: false };
  try {
    const res = await ipcRenderer.invoke(channel, { projectPath, ...args });
    if (res && res.ok === false) notify.error(res.error || failText);
    return res || { ok: false };
  } catch (err) {
    notify.error(err.message || failText);
    return { ok: false };
  }
}

const removeItem = (itemId) => call(IPC.QUEUE_REMOVE, { itemId }, 'Could not remove it');
const setItem = (itemId, action, mode = null) => call(IPC.QUEUE_SET, { itemId, action, mode }, 'Could not change it');
const reorder = (ids) => call(IPC.QUEUE_REORDER, { ids }, 'Could not reorder the queue');
/** One machine's parallel limit (Chief screen): the Mac's, or a server's by key. */
const setParallel = (parallel, serverKey = null) => call(IPC.QUEUE_PARALLEL, { parallel, serverKey }, 'Could not change the limit');

function ui() {
  try { return require('./terminal').getMultiTerminalUI(); } catch (_) { return null; }
}

function openSource(item) {
  const host = ui();
  if (!host) return;
  if (item.kind === 'task') {
    host.showTasksBoard();
    setTimeout(() => { try { require('./tasksDashboard').openTask(item.ref); } catch (_) { /* gone */ } }, 0);
  } else {
    host.showSpecs();
    setTimeout(() => { try { require('./specsDashboard').openSpec(item.ref); } catch (_) { /* gone */ } }, 0);
  }
}

function openTerminal(item) {
  const host = ui();
  if (host && item.terminalId && typeof host.enterLane === 'function') host.enterLane(item.terminalId);
}

// ─── drop targets ───────────────────────────────────────────

/** True when a drag carries a queue source (task tile / spec card). */
function carriesSource(e) {
  const types = e.dataTransfer && e.dataTransfer.types;
  return !!(types && Array.from(types).includes(SOURCE_MIME));
}

/** Put a queue source on a drag (T06/T07 call this from their dragstart). */
function setDragSource(e, source) {
  try {
    e.dataTransfer.setData(SOURCE_MIME, JSON.stringify(source));
    e.dataTransfer.setData('text/plain', source.title || source.ref || '');
    e.dataTransfer.effectAllowed = 'copy';
  } catch (_) { /* a drag without data is just a no-op */ }
}

/** Makes `el` a drop target that queues a dragged task or spec. */
function acceptDrops(el) {
  if (!el || el.dataset.queueDrop) return;
  el.dataset.queueDrop = '1';
  let depth = 0;
  el.addEventListener('dragenter', (e) => {
    if (!carriesSource(e)) return;
    e.preventDefault();
    depth++;
    el.classList.add('queue-drop-over');
  });
  el.addEventListener('dragover', (e) => {
    if (!carriesSource(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  el.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) el.classList.remove('queue-drop-over');
  });
  el.addEventListener('drop', (e) => {
    if (!carriesSource(e)) return;
    e.preventDefault();
    e.stopPropagation();
    depth = 0;
    el.classList.remove('queue-drop-over');
    let source = null;
    try { source = JSON.parse(e.dataTransfer.getData(SOURCE_MIME)); } catch (_) { source = null; }
    if (source) addSource(source);
  });
}

// ─── mounting ───────────────────────────────────────────────

function mountInline(container) {
  if (!container) return;
  init();
  if (!rootEl) {
    rootEl = document.createElement('div');
    rootEl.className = 'queue-view inline';
    rootEl.addEventListener('click', onClick);
    rootEl.addEventListener('dragstart', onDragStart);
    rootEl.addEventListener('dragover', onDragOver);
    rootEl.addEventListener('drop', onDrop);
    rootEl.addEventListener('dragend', clearDropMarks);
    acceptDrops(rootEl);
  }
  container.appendChild(rootEl);
  mounted = true;
  render();
  load();
}

function notifyDetached() {
  if (!mounted) return;
  mounted = false;
  if (rootEl && rootEl.parentNode) rootEl.parentNode.removeChild(rootEl);
}

// ─── render ─────────────────────────────────────────────────

const QUEUE_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><polyline points="3 5 4.5 6.5 3 8"/><polyline points="3 11 4.5 12.5 3 14"/><polyline points="3 17 4.5 18.5 3 20"/></svg>';

function render() {
  if (!rootEl) return;
  const list = payload.items;
  const open = count();
  const running = list.filter((it) => it.state === 'running').length;
  const notes = payload.serverNotes.map((n) => `<div class="queue-note">${escapeHtml(n.host || 'A server')} ${n.kind === 'update' ? 'needs a Frame Server update to hold a queue.' : 'is offline — its items are shown as last seen and cannot be changed.'}</div>`).join('');
  rootEl.innerHTML = `
    <div class="view-header">
      <div class="view-header-title">
        <span class="view-header-mark" aria-hidden="true">${QUEUE_ICON}</span>
        <h2>Queue</h2>
        <span class="queue-summary">${open ? `${open} open${running ? ` · ${running} running` : ''}` : ''}</span>
      </div>
      <div class="view-header-actions">
        <span class="queue-hint">Start it from the Chief</span>
      </div>
    </div>
    ${notes ? `<div class="queue-notes">${notes}</div>` : ''}
    <div class="queue-body">
      ${list.length ? `<ol class="queue-list">${list.map(renderRow).join('')}</ol>` : renderEmpty()}
    </div>`;
}

function renderEmpty() {
  return `
    <div class="queue-empty">
      <div class="queue-empty-title">The queue is empty</div>
      <p>Drag a task or a spec here or onto Queue in the sidebar. You can also use <b>Add to queue</b> in a task's Run dialog, or the queue icon on a spec card.</p>
      <p>Each item runs in its own git worktree when you press <b>Start queue</b> on the Chief.</p>
    </div>`;
}

function actionsFor(it) {
  if (it.offline) return [];
  const a = [];
  if (it.state === 'review') a.push(['done', 'Done', true]);
  if (it.state === 'needs-you') a.push(['continue', 'Continue', true]);
  if (['failed', 'interrupted', 'needs-you', 'review', 'done'].includes(it.state)) a.push(['reset', 'Reset']);
  if (it.terminalId) a.push(['terminal', 'Open terminal']);
  if (it.state !== 'missing') a.push(['source', it.kind === 'spec' ? 'Open spec' : 'Open task']);
  if (it.state !== 'running') a.push(['remove', 'Remove']);
  return a;
}

function renderRow(it, i) {
  const st = it.state || 'queued';
  const draggable = !it.offline && st !== 'running';
  const host = it.location === 'server' ? `<span class="queue-chip host">${escapeHtml(it.offline ? `${it.host} · offline` : it.host)}</span>` : '';
  const kind = `<span class="queue-chip kind ${it.kind}">${it.kind === 'spec' ? 'Spec' : 'Task'}</span>`;
  const mode = it.kind === 'spec' ? renderMode(it) : '';
  const meta = [];
  if (it.worktree && it.worktree.branch) meta.push(`<span class="queue-meta-branch" title="${escapeHtml(it.worktree.path || '')}">⎇ ${escapeHtml(it.worktree.branch)}</span>`);
  if (it.note) meta.push(`<span class="queue-meta-note">${escapeHtml(it.note)}</span>`);
  if (st === 'missing') meta.push(`<span class="queue-meta-note">Its ${it.kind} no longer exists.</span>`);
  const actions = actionsFor(it).map(([act, label, primary]) => `<button type="button" class="queue-act${primary ? ' primary' : ''}" data-act="${act}">${label}</button>`).join('');
  return `
    <li class="queue-row state-${st}${it.offline ? ' offline' : ''}" data-id="${escapeHtml(it.id)}" data-home="${escapeHtml(it.location === 'server' ? it.serverKey : 'mac')}" draggable="${draggable}">
      <span class="queue-grip" aria-hidden="true">${draggable ? '⋮⋮' : ''}</span>
      <span class="queue-index">${i + 1}</span>
      <div class="queue-main">
        <div class="queue-line">
          ${kind}
          <span class="queue-title">${escapeHtml(it.title || it.ref)}</span>
          ${host}
          <span class="queue-chip state ${st}">${STATE_LABELS[st] || st}</span>
        </div>
        ${meta.length ? `<div class="queue-meta">${meta.join('')}</div>` : ''}
      </div>
      ${mode}
      <div class="queue-actions">${actions}</div>
    </li>`;
}

function renderMode(it) {
  const locked = it.offline || it.state === 'running';
  const m = it.flowMode === 'step-by-step' ? 'step-by-step' : 'full-auto';
  const seg = (value, label, title) => `<button type="button" class="queue-mode-seg${m === value ? ' on' : ''}" data-act="mode" data-mode="${value}" aria-pressed="${m === value}" title="${title}"${locked ? ' disabled' : ''}>${label}</button>`;
  return `<div class="queue-mode" role="group" aria-label="Flow mode">${seg('full-auto', 'Full auto', 'Runs the rest of the spec in one go')}${seg('step-by-step', 'Step', 'Runs one phase, then waits for you')}</div>`;
}

function itemOf(el) {
  const row = el && el.closest('.queue-row');
  return row ? payload.items.find((it) => it.id === row.dataset.id) || null : null;
}

function onClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn || btn.disabled) return;
  const it = itemOf(btn);
  if (!it) return;
  switch (btn.dataset.act) {
    case 'done': setItem(it.id, 'done'); break;
    case 'continue': setItem(it.id, 'continue'); break;
    case 'reset': setItem(it.id, 'reset'); break;
    case 'remove': removeItem(it.id); break;
    case 'source': openSource(it); break;
    case 'terminal': openTerminal(it); break;
    case 'mode': if (btn.dataset.mode !== it.flowMode) setItem(it.id, 'flowMode', btn.dataset.mode); break;
    default: break;
  }
}

// Row reorder: a row drags its id; a drop lands it before or after the row
// under the pointer. Main splits the order per machine, so a row never moves
// to another machine's queue.

let dragId = null;

function onDragStart(e) {
  const row = e.target.closest && e.target.closest('.queue-row');
  if (!row || row.getAttribute('draggable') !== 'true') return;
  dragId = row.dataset.id;
  e.dataTransfer.setData(ITEM_MIME, dragId);
  e.dataTransfer.effectAllowed = 'move';
  row.classList.add('dragging');
}

function onDragOver(e) {
  if (!dragId) return;
  const row = e.target.closest && e.target.closest('.queue-row');
  if (!row) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  clearDropMarks(false);
  const after = e.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
  row.classList.add(after ? 'drop-after' : 'drop-before');
}

function onDrop(e) {
  if (!dragId) return;
  const row = e.target.closest && e.target.closest('.queue-row');
  const moving = dragId;
  clearDropMarks();
  if (!row || row.dataset.id === moving) return;
  e.preventDefault();
  e.stopPropagation();
  const ids = payload.items.map((it) => it.id);
  const after = e.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
  const target = ids.indexOf(row.dataset.id);
  const from = ids.indexOf(moving);
  let to = after ? target + 1 : target;
  if (from < to) to -= 1;
  const next = moveId(ids, moving, to);
  // Optimistic: show the new order now; the push that follows confirms it.
  const byId = new Map(payload.items.map((it) => [it.id, it]));
  payload = { ...payload, items: next.map((id) => byId.get(id)) };
  render();
  reorder(next);
}

function clearDropMarks(endDrag = true) {
  if (!rootEl) return;
  rootEl.querySelectorAll('.drop-before, .drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
  if (endDrag !== false) {
    rootEl.querySelectorAll('.queue-row.dragging').forEach((el) => el.classList.remove('dragging'));
    dragId = null;
  }
}

module.exports = {
  SOURCE_MIME,
  init,
  load,
  mountInline,
  notifyDetached,
  isInlineMounted: () => mounted,
  onChange,
  count,
  items,
  current,
  isQueued,
  sourceForTask,
  sourceForSpec,
  addSource,
  removeItem,
  setItem,
  setParallel,
  setDragSource,
  acceptDrops
};
