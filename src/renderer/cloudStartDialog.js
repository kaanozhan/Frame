/**
 * Cloud Start Work dialog (frame-cloud-brief-start spec)
 *
 * Begins one part of a shaped work brief on a branch of its own. Start Work
 * on a brief not started yet picks the part to begin (no choice when there is
 * one; Orchestrate shows, disabled, when there are several); Begin on a
 * started brief's part opens the same dialog for that part alone. The branch
 * row reads like a code host's new-branch control: the name as an editable
 * chip, prefilled with the suggestion, and "from <base> ⌄", the brief's
 * target unless the user picks another local or origin branch. The folder's
 * uncommitted changes are not asked about: the part opens in a workspace of
 * its own, and the main checkout is never switched or stashed
 * (frame-cloud-start-workspace). Under the branch row, the workspace's name
 * follows the branch as it is typed; with a server saved, a Location line
 * reads This Mac, with Server shown disabled as Coming soon (phase 2).
 *
 * Main prepares the view and does every check and write again: this module
 * sends a folder path, a brief number and the user's choices. Its words live
 * in cloudBriefsCopy.js; the panel handles what follows a start through
 * `onStarted` and `onPartial`.
 */

const { ipcRenderer } = require('electron');
const { GitBranch, Cloud, ChevronDown, Check } = require('lucide');
const { IPC } = require('../shared/ipcChannels');
const state = require('./state');
const dock = require('./dock');
const { escapeHtml } = require('./htmlUtils');
const copy = require('./cloudBriefsCopy');

const ICON = {
  branch: dock.lucideIcon(GitBranch, 14),
  local: dock.lucideIcon(GitBranch, 13),
  remote: dock.lucideIcon(Cloud, 13),
  chevron: dock.lucideIcon(ChevronDown, 13),
  check: dock.lucideIcon(Check, 12),
};

// The one open dialog: { el, id, number, partId, view, choice, edited, base,
// menuOpen, pending, done, onStarted, onPartial }.
let dialog = null;

function ref(name) {
  return dialog ? dialog.el.querySelector(`[data-ref="${name}"]`) : null;
}

/**
 * Open the dialog for brief `number`; `partId` names the part to begin on a
 * started brief (Begin). `onStarted(result)` runs after a part was begun (the
 * dialog is closed by then); `onPartial(result)` after one that failed past
 * the checks (the dialog stays, naming what is missing).
 */
function open({ number, partId = null, onStarted, onPartial }) {
  if (dialog) return;
  const el = document.createElement('div');
  el.className = 'cloud-briefs-dialog-backdrop';
  const id = `cloud-briefs-start-${number}`;
  el.innerHTML = `<div class="cloud-briefs-dialog cloud-briefs-start-dialog" role="dialog" aria-modal="true" aria-labelledby="${id}-title">
      <h3 id="${id}-title" data-ref="title">${escapeHtml(copy.startDialogTitle(number))}</h3>
      <div data-ref="body"><p class="cloud-briefs-muted">Loading…</p></div>
    </div>`;
  dialog = {
    el, id, number, partId, view: null, choice: null, edited: false, base: null,
    menuOpen: false, pending: false, done: false, onStarted, onPartial,
  };
  el.addEventListener('click', onClick);
  el.addEventListener('change', onChange);
  el.addEventListener('input', onInput);
  el.addEventListener('keydown', onKeydown);
  document.body.appendChild(el);
  prepare();
}

function close() {
  if (!dialog || dialog.pending) return;
  dialog.el.remove();
  dialog = null;
}

async function prepare() {
  const current = dialog;
  const path = state.getProjectPath();
  let view;
  try {
    view = path
      ? await ipcRenderer.invoke(IPC.CLOUD_BRIEF_START_PREPARE, path, current.number)
      : { ok: false, reason: 'notConnected' };
  } catch (err) {
    console.error('cloudStartDialog: could not prepare Start Work', err);
    view = { ok: false, reason: 'other' };
  }
  if (dialog !== current) return; // closed while main answered
  if (!view || !view.ok) {
    renderFailure(copy.startErrorMessage(view));
    return;
  }
  // Begin names its part; Start Work begins with the first part that can be.
  const wanted = current.partId && view.parts.find((p) => p.partId === current.partId);
  if (view.mode === 'begin' && (!wanted || !wanted.canBegin)) {
    renderFailure(copy.startErrorMessage({ reason: wanted && wanted.begunBranch ? 'alreadyBegun' : 'notStartable', detail: wanted && wanted.begunBranch }));
    return;
  }
  const first = view.parts.find((p) => p.canBegin) || view.parts[0];
  current.view = view;
  current.choice = (wanted || first).partId;
  current.base = view.base;
  if (view.mode === 'begin') ref('title').textContent = copy.beginDialogTitle(wanted.title);
  renderReady();
}

// ─── Rendering ────────────────────────────────────────────────

function renderFailure(message) {
  ref('body').innerHTML = `<p class="cloud-briefs-form-error">${escapeHtml(message)}</p>
    <div class="cloud-briefs-start-actions">
      <button type="button" class="cloud-briefs-web-btn" data-action="cancel">${escapeHtml(copy.CANCEL_LABEL)}</button>
    </div>`;
  ref('body').querySelector('[data-action="cancel"]').focus();
}

function chosenPart() {
  return dialog.view.parts.find((p) => p.partId === dialog.choice) || null;
}

function partChips(part) {
  return `<span class="cloud-briefs-chip">${escapeHtml(part.shape)}</span>
    <span class="cloud-briefs-chip">${escapeHtml(part.type)}</span>`;
}

function problemLine(part) {
  return part.problem
    ? `<span class="cloud-briefs-field-error">${escapeHtml(copy.partProblemMessage(part.title, part.problem))}</span>`
    : '';
}

/** Several parts on a brief not started yet: a choice each, and Orchestrate (not yet). */
function renderChoices() {
  const { view, id, choice } = dialog;
  const rows = view.parts.map((p) => {
    const disabled = !p.canBegin;
    return `<label class="cloud-briefs-start-choice${disabled ? ' disabled' : ''}">
        <input type="radio" name="${id}-choice" value="${escapeHtml(p.partId)}"${p.partId === choice ? ' checked' : ''}${disabled ? ' disabled' : ''}>
        <span class="cloud-briefs-start-choice-text">
          <span class="cloud-briefs-start-choice-label">${escapeHtml(p.title)} ${partChips(p)}</span>
          ${problemLine(p) || `<span class="cloud-briefs-field-hint">${escapeHtml(copy.beginHint(p.shape))}</span>`}
        </span>
      </label>`;
  }).join('');
  return `<fieldset class="cloud-briefs-field">
      <legend class="cloud-briefs-label">${escapeHtml(copy.START_CHOICE_TITLE)}</legend>
      <div class="cloud-briefs-start-choices">
        ${rows}
        <label class="cloud-briefs-start-choice disabled">
          <input type="radio" name="${id}-choice" value="" disabled>
          <span class="cloud-briefs-start-choice-text">
            <span class="cloud-briefs-start-choice-label">${escapeHtml(copy.ORCHESTRATE_LABEL)} <span class="cloud-briefs-start-soon">${escapeHtml(copy.COMING_SOON)}</span></span>
            <span class="cloud-briefs-field-hint">${escapeHtml(copy.ORCHESTRATE_HINT)}</span>
          </span>
        </label>
      </div>
    </fieldset>`;
}

/** One part (a single-part brief, or Begin): the part itself, no choice. */
function renderSinglePart() {
  const part = chosenPart();
  return `<div class="cloud-briefs-start-part">
      <span class="cloud-briefs-start-choice-label">${escapeHtml(part.title)} ${partChips(part)}</span>
      ${problemLine(part) || `<span class="cloud-briefs-field-hint">${escapeHtml(copy.beginHint(part.shape))}</span>`}
    </div>`;
}

/** The branch row: icon, the name as an editable chip, and "from <base> ⌄" with its menu. */
function renderBranchRow() {
  const { view, id } = dialog;
  const part = chosenPart();
  return `<div class="cloud-briefs-field">
      <label class="cloud-briefs-label" for="${id}-branch">${escapeHtml(copy.BRANCH_LABEL)}</label>
      <div class="cloud-briefs-branchrow">
        <span class="cloud-briefs-branchrow-icon">${ICON.branch}</span>
        <input id="${id}-branch" class="cloud-briefs-branchrow-name" data-ref="branch" spellcheck="false" autocomplete="off" value="${escapeHtml(view.suggestions[part.partId] || '')}">
        <span class="cloud-briefs-branchrow-from">${escapeHtml(copy.FROM_LABEL)}</span>
        <span class="cloud-briefs-branchrow-base-wrap">
          <button type="button" class="cloud-briefs-branchrow-base" data-action="toggle-base" data-ref="base" aria-haspopup="listbox" aria-expanded="false"></button>
          <div class="cloud-briefs-basemenu" data-ref="basemenu" hidden>
            <input class="cloud-briefs-input cloud-briefs-basemenu-filter" data-ref="basefilter" placeholder="${escapeHtml(copy.BASE_FILTER_PLACEHOLDER)}" spellcheck="false" autocomplete="off">
            <div class="cloud-briefs-basemenu-list" data-ref="baselist" role="listbox"></div>
          </div>
        </span>
      </div>
      <p class="cloud-briefs-field-error" data-ref="basemissing" hidden>${escapeHtml(copy.baseMissingLine(view.targetBranch))}</p>
      <div class="cloud-briefs-start-where">
        <span class="cloud-briefs-start-where-label">${escapeHtml(copy.WORKSPACE_LABEL)}</span>
        <span class="cloud-briefs-start-workspace" data-ref="wsname"></span>
      </div>
      ${renderLocation()}
    </div>`;
}

/**
 * Where the workspace is created: This Mac, the only place in phase 1, and a
 * server location shown disabled as Coming soon. Shown only once a server is
 * saved, as New Workspace's Location row is.
 */
function renderLocation() {
  if (savedServers().length === 0) return '';
  const name = `${dialog.id}-location`;
  return `<div class="cloud-briefs-start-where" role="radiogroup" aria-label="${escapeHtml(copy.LOCATION_LABEL)}">
      <span class="cloud-briefs-start-where-label">${escapeHtml(copy.LOCATION_LABEL)}</span>
      <label class="cloud-briefs-start-location">
        <input type="radio" name="${name}" value="" checked> ${escapeHtml(copy.THIS_MAC_LABEL)}
      </label>
      <label class="cloud-briefs-start-location disabled">
        <input type="radio" name="${name}" value="" disabled> ${escapeHtml(copy.SERVER_LOCATION_LABEL)}
        <span class="cloud-briefs-start-soon">${escapeHtml(copy.COMING_SOON)}</span>
      </label>
    </div>`;
}

/** The project's saved Frame Servers; none when the list cannot be read. */
function savedServers() {
  try {
    // Lazy-required, as New Workspace reaches it.
    return require('./serverConnect').getServers() || [];
  } catch (_) {
    return [];
  }
}

/**
 * The workspace name line: what workspaceManager.create will call a
 * workspace opened on this branch (an empty field begins on the
 * suggestion), against this Mac's loaded workspaces.
 */
function renderWorkspaceName() {
  const el = ref('wsname');
  if (!el) return;
  const typed = ref('branch').value.trim();
  const branch = typed || dialog.view.suggestions[dialog.choice] || '';
  let taken = [];
  try {
    taken = require('./workspaceSection').getWorkspaces()
      .filter((w) => w.location !== 'server')
      .map((w) => w.name);
  } catch (_) { /* the sidebar is not loaded: no names taken */ }
  el.textContent = copy.workspaceNameText(copy.beginWorkspaceName(branch, taken));
}

function renderReady() {
  const { view } = dialog;
  const choose = view.mode === 'start' && view.parts.length > 1;
  ref('body').innerHTML = `
    <p class="cloud-briefs-muted">${escapeHtml(view.mode === 'begin' ? copy.BEGIN_DIALOG_DESCRIPTION : copy.START_DIALOG_DESCRIPTION)}</p>
    ${choose ? renderChoices() : renderSinglePart()}
    ${renderBranchRow()}
    <p class="cloud-briefs-form-error" data-ref="error" hidden></p>
    <div class="cloud-briefs-start-actions" data-ref="actions">
      <button type="button" class="cloud-briefs-web-btn" data-action="cancel">${escapeHtml(copy.CANCEL_LABEL)}</button>
      <button type="button" class="cloud-briefs-primary-btn" data-action="confirm">${escapeHtml(copy.startSubmitLabel(false))}</button>
    </div>`;
  renderBase();
  renderWorkspaceName();
  const name = ref('branch');
  name.focus();
  name.select();
}

/**
 * The base button, the missing-base line and whether confirm can go. The
 * button carries the base's icon, local or origin, as its menu row does.
 */
function renderBase() {
  const { base } = dialog;
  const button = ref('base');
  const known = base ? dialog.view.bases.find((b) => b.name === base) : null;
  const icon = !base ? '' : (known ? known.remote : base.startsWith('origin/')) ? ICON.remote : ICON.local;
  button.innerHTML = `${icon}<span>${escapeHtml(base || copy.PICK_BASE_LABEL)}</span>${ICON.chevron}`;
  ref('basemissing').hidden = Boolean(base);
  syncConfirm();
}

function syncConfirm() {
  const confirm = ref('body').querySelector('[data-action="confirm"]');
  const part = chosenPart();
  if (confirm) confirm.disabled = dialog.pending || !dialog.base || !part || !part.canBegin;
}

function renderBaseList() {
  const filter = ref('basefilter').value.trim().toLowerCase();
  const options = dialog.view.bases.filter((b) => !filter || b.name.toLowerCase().includes(filter));
  const section = (title, rows) => (rows.length === 0 ? '' : `<div class="cloud-briefs-basemenu-title">${escapeHtml(title)}</div>${rows.map((b) => `
      <button type="button" class="cloud-briefs-basemenu-item${b.name === dialog.base ? ' current' : ''}" role="option" aria-selected="${b.name === dialog.base}" data-action="pick-base" data-base="${escapeHtml(b.name)}">
        ${b.remote ? ICON.remote : ICON.local}<span>${escapeHtml(b.name)}</span>${b.name === dialog.base ? ICON.check : ''}
      </button>`).join('')}`);
  const html = section(copy.BASE_LOCAL_TITLE, options.filter((b) => !b.remote))
    + section(copy.BASE_REMOTE_TITLE, options.filter((b) => b.remote));
  ref('baselist').innerHTML = html || `<p class="cloud-briefs-muted cloud-briefs-basemenu-empty">${escapeHtml(copy.NO_BASE_MATCH)}</p>`;
}

function setMenu(openIt) {
  dialog.menuOpen = openIt;
  ref('basemenu').hidden = !openIt;
  ref('base').setAttribute('aria-expanded', String(openIt));
  if (openIt) {
    ref('basefilter').value = '';
    renderBaseList();
    ref('basefilter').focus();
  }
}

function showError(message) {
  const errorEl = ref('error');
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function setPending(on) {
  dialog.pending = on;
  const confirm = ref('body').querySelector('[data-action="confirm"]');
  if (confirm) confirm.textContent = copy.startSubmitLabel(on);
  for (const input of dialog.el.querySelectorAll('input')) input.disabled = on || input.closest('.disabled') !== null;
  ref('base').disabled = on;
  syncConfirm();
}

// ─── Events ───────────────────────────────────────────────────

function onClick(e) {
  if (!dialog) return;
  if (e.target === dialog.el) {
    close();
    return;
  }
  const action = e.target.closest('[data-action]');
  if (dialog.menuOpen && !e.target.closest('.cloud-briefs-branchrow-base-wrap')) setMenu(false);
  if (!action) return;
  const name = action.dataset.action;
  if (name === 'cancel') close();
  else if (name === 'confirm') confirm();
  else if (name === 'toggle-base') {
    setMenu(!dialog.menuOpen);
  } else if (name === 'pick-base') {
    dialog.base = action.dataset.base;
    setMenu(false);
    renderBase();
    ref('branch').focus();
  }
}

function onChange(e) {
  if (!dialog || !dialog.view || e.target.type !== 'radio' || !e.target.value) return;
  if (e.target.name !== `${dialog.id}-choice`) return;
  dialog.choice = e.target.value;
  // The name follows the choice until the user types in it.
  if (!dialog.edited) ref('branch').value = dialog.view.suggestions[dialog.choice] || '';
  renderWorkspaceName();
  syncConfirm();
}

function onInput(e) {
  if (!dialog) return;
  if (e.target === ref('branch')) {
    dialog.edited = true;
    renderWorkspaceName();
  } else if (e.target === ref('basefilter')) renderBaseList();
}

function onKeydown(e) {
  if (e.key !== 'Escape' || !dialog) return;
  e.stopPropagation();
  // Esc closes the menu first, then the dialog.
  if (dialog.menuOpen) {
    setMenu(false);
    ref('base').focus();
  } else {
    close();
  }
}

async function confirm() {
  const current = dialog;
  if (!current || current.pending || current.done || !current.view) return;
  const part = chosenPart();
  if (!part || !part.canBegin || !current.base) return;
  const path = state.getProjectPath();
  const request = {
    number: current.number,
    beginPartId: part.partId,
    branch: ref('branch').value.trim(),
    base: current.base,
  };
  ref('error').hidden = true;
  setPending(true);
  let result;
  try {
    result = path
      ? await ipcRenderer.invoke(IPC.CLOUD_BRIEF_START, path, request)
      : { ok: false, reason: 'notConnected' };
  } catch (err) {
    console.error('cloudStartDialog: could not begin the part', err);
    result = { ok: false, reason: 'other' };
  }
  if (dialog !== current) return;
  setPending(false);

  if (result && result.ok) {
    close();
    if (current.onStarted) current.onStarted(result);
    return;
  }
  if (result && result.reason === 'partial') {
    // Past the checks: nothing to retry here, only what to finish by hand.
    current.done = true;
    showError(copy.partialMessage(result));
    const confirmBtn = ref('body').querySelector('[data-action="confirm"]');
    if (confirmBtn) confirmBtn.remove();
    for (const input of current.el.querySelectorAll('input')) input.disabled = true;
    ref('base').disabled = true;
    if (current.onPartial) current.onPartial(result);
    return;
  }
  showError(copy.startErrorMessage(result));
}

module.exports = { open };
