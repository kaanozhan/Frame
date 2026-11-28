/**
 * Cloud Start Work dialog (frame-cloud-brief-start spec)
 *
 * Begins one part of a shaped work brief on a branch of its own, in two
 * steps (frame-cloud-start-places): Start Work on a brief not started yet
 * first asks what to work on — every part, and Orchestrate, disabled — then,
 * after Next, where to work. Begin on a started brief's part opens on the
 * second step for that part alone. Back returns to the first step and keeps
 * every choice.
 *
 * Where to work is three equal cards, none picked when the dialog opens and
 * nothing remembered between dialogs (overturning frame-cloud-start-on-server
 * D2): the project checkout (its path and branch; locked, with the reason,
 * while a begun part is unfinished on its branch or it has uncommitted
 * changes — it is never stashed), a new workspace on This Mac, and a server
 * workspace (the connected hosts; a Server select with two or more; offline
 * with Connect; "No server yet" with Add a server…; disabled in local mode).
 * Connect and Add a server… open the Servers dialog and hide this one until
 * it closes; a server that came back connected is then picked
 * (serverConnect.open's `onClose`). Each place keeps its own base, from main's
 * defaults; a server's menu offers origin's branches only.
 *
 * The branch row appears once a place is picked, set up for it: "Branch · in
 * the project checkout / for the new workspace / for the workspace on
 * <host>", then a code host's new-branch control — the name as an editable
 * chip, prefilled with the suggestion and kept across places, and "from
 * <base> ⌄" — and one line saying where it is cut from and what will happen:
 * the checkout switching branches, the new workspace's name and folder, or
 * the workspace on the server, the project sent there if missing, and the
 * uncommitted changes staying here. Start names the place.
 *
 * Main prepares the view and does every check and write again: this module
 * sends a folder path, a brief number and the user's choices. Its words live
 * in cloudBriefsCopy.js; the panel handles what follows a start through
 * `onStarted` and `onPartial`.
 */

const { ipcRenderer } = require('electron');
const { GitBranch, Cloud, ChevronDown, Check, Folder, FolderPlus, Server, CircleAlert } = require('lucide');
const { IPC } = require('../shared/ipcChannels');
const state = require('./state');
const dock = require('./dock');
const notify = require('./notify');
const { escapeHtml } = require('./htmlUtils');
const copy = require('./cloudBriefsCopy');

const ICON = {
  branch: dock.lucideIcon(GitBranch, 14),
  local: dock.lucideIcon(GitBranch, 13),
  remote: dock.lucideIcon(Cloud, 13),
  chevron: dock.lucideIcon(ChevronDown, 13),
  check: dock.lucideIcon(Check, 12),
  checkout: dock.lucideIcon(Folder, 14),
  workspace: dock.lucideIcon(FolderPlus, 14),
  server: dock.lucideIcon(Server, 14),
  alert: dock.lucideIcon(CircleAlert, 13),
};

// The one open dialog: { el, id, number, partId, view, step (1: what to work
// on, 2: where to work), choice, edited, branchText (the branch name as
// typed, kept across steps), place (null until picked: 'checkout',
// 'workspace' or 'server'), serverKey (the server picked on the server card),
// bases ({ checkout, workspace, server }: each place's base), away (while the
// Servers dialog is open: { known, wanted }), unsubscribe, serverSig (what the
// server card last showed), menuOpen, pending, done, onStarted, onPartial }.
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
    el, id, number, partId, view: null, step: 1, choice: null, edited: false, branchText: '',
    place: null, serverKey: null, bases: { checkout: null, workspace: null, server: null },
    away: null, unsubscribe: null, serverSig: '',
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
  if (dialog.unsubscribe) dialog.unsubscribe();
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
  current.branchText = view.suggestions[current.choice] || '';
  current.bases = { checkout: null, workspace: null, server: null, ...(view.placeBases || {}) };
  // Begin knows its part: it opens on where to work.
  current.step = view.mode === 'begin' ? 2 : 1;
  if (view.mode === 'begin') ref('title').textContent = copy.beginDialogTitle(wanted.title);
  // The server card follows the servers while the dialog is open.
  try {
    current.unsubscribe = require('./serverConnect').onServersChange(() => onServersChanged(current));
  } catch (_) { /* no Servers module: the card reads the list once */ }
  renderStep();
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

/** Step 1 on a brief not started yet: a choice per part, and Orchestrate (not yet). */
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

/**
 * Step 2's first line: the part chosen, and on Start Work a Change link back
 * to step 1.
 */
function renderPicked() {
  const part = chosenPart();
  const change = dialog.view.mode === 'start'
    ? `<button type="button" class="cloud-briefs-start-change" data-action="back">${escapeHtml(copy.CHANGE_LABEL)}</button>`
    : '';
  return `<div class="cloud-briefs-start-picked">
      <span class="cloud-briefs-start-picked-what">${escapeHtml(copy.PART_LABEL)}</span>
      <span class="cloud-briefs-start-choice-label">${escapeHtml(part.title)} ${partChips(part)}</span>
      ${change}
    </div>
    ${problemLine(part)}`;
}

/** Start Work's step counter, left of the buttons; Begin has one step and none. */
function renderStepper() {
  if (dialog.view.mode !== 'start') return '';
  const two = dialog.step === 2;
  return `<span class="cloud-briefs-start-stepper">
      <span class="cloud-briefs-start-pips" aria-hidden="true"><span class="cloud-briefs-start-pip on"></span><span class="cloud-briefs-start-pip${two ? ' on' : ''}"></span></span>
      ${escapeHtml(copy.stepLabel(dialog.step))}
    </span>`;
}

// ─── Where to work: the three places ──────────────────────────

/** The project's saved Frame Servers; none when the list cannot be read. */
function savedServers() {
  try {
    // Lazy-required, as New Workspace reaches it.
    return require('./serverConnect').getServers() || [];
  } catch (_) {
    return [];
  }
}

function isConnected(srv) {
  return Boolean(srv && srv.status && srv.status.state === 'connected');
}

/** The server card's state: localMode, none, offline or ready, with the connected and offline servers. */
function serverState() {
  return copy.serverCardState(savedServers(), { localMode: Boolean(dialog.view.localMode) });
}

/** What the server card shows, as one string: a status change that changes none of it draws nothing. */
function serverSignature(srv) {
  return `${srv.kind}|${srv.connected.map((s) => `${s.key}=${s.host}`).join(',')}|${srv.offline.map((s) => `${s.key}=${s.host}`).join(',')}`;
}

/** The connected server picked on the server card, or null. */
function chosenServer() {
  if (!dialog || dialog.place !== 'server' || !dialog.serverKey) return null;
  const srv = savedServers().find((s) => s.key === dialog.serverKey);
  return isConnected(srv) ? srv : null;
}

/** Why the project checkout card is locked, or null (D1, D6). */
function checkoutLock() {
  return dialog.view.checkout ? copy.checkoutLock(dialog.view.checkout) : null;
}

/** One card's inside: its head (ring, icon, title), meta line and three facts. */
function cardBody(place, meta, { ring = true } = {}) {
  const checkout = dialog.view.checkout || {};
  const facts = copy.placeFacts(place, { branch: checkout.branch });
  return `<span class="cloud-briefs-place-head">${ring ? '<span class="cloud-briefs-place-ring" aria-hidden="true"></span>' : ''}${ICON[place]}<span>${escapeHtml(copy.PLACE_LABELS[place])}</span></span>
      <span class="cloud-briefs-place-meta">${escapeHtml(meta)}</span>
      <ul class="cloud-briefs-place-facts">${facts.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>`;
}

/** A line saying why a card cannot be picked. */
function lockLine(text) {
  return `<span class="cloud-briefs-place-lock">${ICON.alert}<span>${escapeHtml(text)}</span></span>`;
}

/** A card that can be picked: a radio in `<id>-place`, disabled with `lock`'s reason. */
function choiceCard(place, meta, lock = null) {
  const on = dialog.place === place;
  return `<label class="cloud-briefs-place${on ? ' on' : ''}${lock ? ' off' : ''}">
      <input type="radio" name="${dialog.id}-place" value="${place}"${on ? ' checked' : ''}${lock ? ' disabled' : ''}>
      ${cardBody(place, meta)}
      ${lock ? lockLine(lock) : ''}
    </label>`;
}

/**
 * The server card by its state: ready (a choice, the connected hosts),
 * offline (each server not connected, with Connect), none ("No server yet"
 * and Add a server…) or local mode (disabled with the reason, D8).
 */
function renderServerCard(srv) {
  if (srv.kind === 'ready') return choiceCard('server', copy.serverCardMeta(srv.connected.map((s) => s.host)));
  if (srv.kind === 'localMode') {
    return `<div class="cloud-briefs-place off">${cardBody('server', '', { ring: false })}${lockLine(copy.LOCAL_MODE_LOCATION_HINT)}</div>`;
  }
  if (srv.kind === 'offline') {
    const lines = srv.offline.map((s) => `<span class="cloud-briefs-place-lock">${ICON.alert}<span>${escapeHtml(copy.serverOfflineLine(s.host))}</span>
        <button type="button" class="cloud-briefs-place-link" data-action="connect-server" data-key="${escapeHtml(s.key)}">${escapeHtml(copy.CONNECT_LABEL)}</button></span>`).join('');
    return `<div class="cloud-briefs-place off">${cardBody('server', copy.serverCardMeta(srv.offline.map((s) => s.host)), { ring: false })}${lines}</div>`;
  }
  return `<div class="cloud-briefs-place notice">
      <span class="cloud-briefs-place-head">${ICON.server}<span>${escapeHtml(copy.PLACE_LABELS.server)}</span><span class="cloud-briefs-place-tag">${escapeHtml(copy.NO_SERVER_TAG)}</span></span>
      <span class="cloud-briefs-field-hint">${escapeHtml(copy.NO_SERVER_TEXT)}</span>
      <ul class="cloud-briefs-place-facts">${copy.NO_SERVER_FACTS.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
      <button type="button" class="cloud-briefs-web-btn cloud-briefs-place-add" data-action="add-server">${escapeHtml(copy.ADD_SERVER_LABEL)}</button>
    </div>`;
}

/** With the server card picked and two or more servers connected: which one, under the cards. */
function renderServerSelect(srv) {
  if (dialog.place !== 'server' || srv.kind !== 'ready' || srv.connected.length < 2) return '';
  const id = `${dialog.id}-server`;
  const options = savedServers().map((s) => {
    const offline = !isConnected(s);
    return `<option value="${escapeHtml(s.key)}"${s.key === dialog.serverKey ? ' selected' : ''}${offline ? ' disabled' : ''}>${escapeHtml(copy.serverOptionLabel(s.host, { offline }))}</option>`;
  }).join('');
  return `<div class="cloud-briefs-place-server">
      <label class="cloud-briefs-label" for="${id}">${escapeHtml(copy.SERVER_SELECT_LABEL)}</label>
      <select id="${id}" class="cloud-briefs-input cloud-briefs-place-select" data-ref="server">${options}</select>
    </div>`;
}

/** Step 2's places: three cards, none picked until the user picks one (C1). */
function renderPlaces() {
  const checkout = dialog.view.checkout || {};
  const srv = serverState();
  dialog.serverSig = serverSignature(srv);
  return `<fieldset class="cloud-briefs-field">
      <legend class="cloud-briefs-label">${escapeHtml(copy.PLACE_TITLE)}</legend>
      <div class="cloud-briefs-places">
        ${choiceCard('checkout', copy.checkoutMeta(checkout.path, checkout.branch), dialog.view.checkout ? checkoutLock() : '')}
        ${choiceCard('workspace', copy.THIS_MAC_LABEL)}
        ${renderServerCard(srv)}
      </div>
      ${renderServerSelect(srv)}
    </fieldset>`;
}

/**
 * Pick `place`. The server card picks its connected server: the one picked
 * before while it is still connected, else the first connected one.
 */
function setPlace(place) {
  dialog.place = place;
  if (place === 'server') {
    const up = savedServers().filter(isConnected);
    if (!up.some((s) => s.key === dialog.serverKey)) dialog.serverKey = up[0] ? up[0].key : null;
  }
  renderStepTwo({ focusPlace: true });
}

/**
 * The servers changed while the dialog is open: a picked server that is no
 * longer connected leaves no place picked, and the cards are drawn again.
 * Nothing is drawn while the Servers dialog has the screen.
 */
function onServersChanged(current) {
  if (dialog !== current || !current.view || current.step !== 2 || current.away || current.pending || current.done) return;
  const dropped = current.place === 'server' && !chosenServer();
  if (!dropped && serverSignature(serverState()) === current.serverSig) return;
  if (dropped) {
    current.place = null;
    current.serverKey = null;
  }
  renderStepTwo({ keepFocus: true });
}

/**
 * Connect (`key`) or Add a server… (`add`): the Servers dialog, with this one
 * hidden until it closes (D3). It comes back with the server it added — or
 * the one Connect was for — picked once connected. When Servers closed to
 * hand the screen to a terminal, this dialog closes too and says so.
 */
async function openServers({ key = null, add = false }) {
  const current = dialog;
  if (!current || current.pending || current.done) return;
  current.away = { known: new Set(savedServers().map((s) => s.key)), wanted: key };
  // The backdrop is display: flex, which the hidden attribute alone does not beat.
  current.el.style.display = 'none';
  try {
    await require('./serverConnect').open({ key, add, onClose: ({ handoff }) => backFromServers(current, handoff) });
  } catch (err) {
    console.error('cloudStartDialog: could not open Servers', err);
  }
  // The Servers dialog did not open: come back now rather than stay hidden.
  const servers = document.getElementById('server-connect-modal');
  if (!servers || !servers.classList.contains('visible')) backFromServers(current, false);
}

function backFromServers(current, handoff) {
  if (dialog !== current || !current.away) return;
  const { known, wanted } = current.away;
  current.away = null;
  if (handoff) {
    close();
    notify.info(copy.SERVER_HANDOFF_NOTICE);
    return;
  }
  current.el.style.display = '';
  const up = savedServers().filter(isConnected);
  const picked = up.find((s) => !known.has(s.key)) || (wanted ? up.find((s) => s.key === wanted) : null);
  if (picked && !current.view.localMode) {
    current.place = 'server';
    current.serverKey = picked.key;
  } else if (current.place === 'server' && !chosenServer()) {
    current.place = null;
    current.serverKey = null;
  }
  renderStepTwo({ focusPlace: true });
}

// ─── The branch row ───────────────────────────────────────────

/** The base of the picked place, or null before one is picked. */
function currentBase() {
  return dialog.place ? dialog.bases[dialog.place] || null : null;
}

/**
 * The branch section. Before a place is picked, only what it will be set up
 * from; then the row — icon, the name as an editable chip, and "from <base>
 * ⌄" with its menu — under a label naming the place, and the line saying
 * what will happen.
 */
function renderBranchRow() {
  const { view, id, place } = dialog;
  if (!place) {
    return `<div class="cloud-briefs-field">
        <span class="cloud-briefs-label">${escapeHtml(copy.BRANCH_LABEL)}</span>
        <p class="cloud-briefs-field-hint">${escapeHtml(copy.placePendingLine(view.targetBranch))}</p>
      </div>`;
  }
  const srv = chosenServer();
  return `<div class="cloud-briefs-field">
      <label class="cloud-briefs-label" for="${id}-branch">${escapeHtml(copy.BRANCH_LABEL)} <span class="cloud-briefs-label-sub">· ${escapeHtml(copy.branchPlaceLabel(place, srv ? srv.host : ''))}</span></label>
      <div class="cloud-briefs-branchrow">
        <span class="cloud-briefs-branchrow-icon">${ICON.branch}</span>
        <input id="${id}-branch" class="cloud-briefs-branchrow-name" data-ref="branch" spellcheck="false" autocomplete="off" value="${escapeHtml(dialog.branchText)}">
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
      <p class="cloud-briefs-field-hint" data-ref="branchline"></p>
    </div>`;
}

/** What the base menu offers: every base, but origin's alone on a server (start-on-server D15). */
function basesFor() {
  const bases = dialog.view.bases || [];
  return dialog.place === 'server' ? bases.filter((b) => b.remote) : bases;
}

/**
 * The line under the branch row (copy.placeBranchLine): where the branch is
 * cut from, and what starting there will do. A workspace's name is what
 * workspaceManager.create will call one opened on this branch (an empty
 * field begins on the suggestion), against the loaded workspaces of the
 * picked place — this Mac's, or that server's.
 */
function renderBranchLine() {
  const el = ref('branchline');
  if (!el || !dialog.place) return;
  const checkout = dialog.view.checkout || {};
  const srv = chosenServer();
  const branch = dialog.branchText.trim() || dialog.view.suggestions[dialog.choice] || '';
  const here = dialog.place === 'server'
    ? (w) => w.location === 'server' && w.serverKey === dialog.serverKey
    : (w) => w.location !== 'server';
  let taken = [];
  try {
    taken = require('./workspaceSection').getWorkspaces()
      .filter(here)
      .map((w) => w.name);
  } catch (_) { /* the sidebar is not loaded: no names taken */ }
  el.textContent = copy.placeBranchLine(dialog.place, {
    base: currentBase(),
    branch,
    from: checkout.branch,
    path: checkout.path,
    name: copy.beginWorkspaceName(branch, taken),
    folder: dialog.view.workspaceFolder,
    host: srv ? srv.host : '',
    changes: checkout.changes,
  });
}

/** Start, naming the picked place: "Start in project checkout", "Start on <host>"; "Starting…" while it runs. */
function startLabel() {
  const srv = chosenServer();
  return copy.startPlaceLabel(dialog.place, { host: srv ? srv.host : '', pending: dialog.pending });
}

// ─── Steps ────────────────────────────────────────────────────

function renderStep() {
  if (dialog.menuOpen) dialog.menuOpen = false;
  if (dialog.step === 1) renderStepOne();
  else renderStepTwo();
}

/**
 * Step 1 · What to work on (Start Work only, D5): every part, even when
 * there is one, and Orchestrate, disabled. Next goes on with the chosen
 * part when it can be begun.
 */
function renderStepOne() {
  ref('body').innerHTML = `
    <p class="cloud-briefs-muted">${escapeHtml(copy.START_DIALOG_DESCRIPTION)}</p>
    ${renderChoices()}
    <p class="cloud-briefs-form-error" data-ref="error" hidden></p>
    <div class="cloud-briefs-start-actions" data-ref="actions">
      ${renderStepper()}
      <button type="button" class="cloud-briefs-web-btn" data-action="cancel">${escapeHtml(copy.CANCEL_LABEL)}</button>
      <button type="button" class="cloud-briefs-primary-btn" data-action="next">${escapeHtml(copy.NEXT_LABEL)}</button>
    </div>`;
  syncNext();
  const picked = dialog.el.querySelector(`input[name="${dialog.id}-choice"]:checked`) || ref('body').querySelector('[data-action="next"]');
  if (picked) picked.focus();
}

/**
 * Step 2 · Where to work: the part chosen, the three places, then the
 * branch, and Start. Back (Cancel on Begin) leaves it. `focusPlace` puts the
 * focus on the picked card; `keepFocus` leaves it where it was.
 */
function renderStepTwo({ focusPlace = false, keepFocus = false } = {}) {
  const { view } = dialog;
  const focused = keepFocus ? document.activeElement : null;
  const typing = focused && focused === ref('branch');
  if (dialog.menuOpen) dialog.menuOpen = false;
  const leave = view.mode === 'start'
    ? `<button type="button" class="cloud-briefs-web-btn" data-action="back">${escapeHtml(copy.BACK_LABEL)}</button>`
    : `<button type="button" class="cloud-briefs-web-btn" data-action="cancel">${escapeHtml(copy.CANCEL_LABEL)}</button>`;
  ref('body').innerHTML = `
    ${view.mode === 'begin' ? `<p class="cloud-briefs-muted">${escapeHtml(copy.BEGIN_DIALOG_DESCRIPTION)}</p>` : ''}
    ${renderPicked()}
    ${renderPlaces()}
    ${renderBranchRow()}
    <p class="cloud-briefs-form-error" data-ref="error" hidden></p>
    <div class="cloud-briefs-start-actions" data-ref="actions">
      ${renderStepper()}
      ${leave}
      <button type="button" class="cloud-briefs-primary-btn" data-action="confirm">${escapeHtml(startLabel())}</button>
    </div>`;
  renderBase();
  if (typing && ref('branch')) {
    const name = ref('branch');
    name.focus();
    name.setSelectionRange(name.value.length, name.value.length);
    return;
  }
  if (keepFocus) return;
  const card = focusPlace && dialog.el.querySelector(`input[name="${dialog.id}-place"]:checked`);
  const first = card || dialog.el.querySelector(`input[name="${dialog.id}-place"]:not([disabled])`) || ref('body').querySelector('[data-action="confirm"]');
  if (first) first.focus();
}

/** Step 1's Next: only for a part that can be begun. */
function syncNext() {
  const next = ref('body').querySelector('[data-action="next"]');
  const part = chosenPart();
  if (next) next.disabled = !part || !part.canBegin;
}

function goToStep(step) {
  if (!dialog || dialog.pending || dialog.done) return;
  if (step === 2) {
    const part = chosenPart();
    if (!part || !part.canBegin) return;
  }
  dialog.step = step;
  renderStep();
}

/**
 * The base button, the missing-base line and whether confirm can go. The
 * button carries the base's icon, local or origin, as its menu row does.
 */
function renderBase() {
  const base = currentBase();
  const button = ref('base');
  if (button) {
    const known = base ? dialog.view.bases.find((b) => b.name === base) : null;
    const icon = !base ? '' : (known ? known.remote : base.startsWith('origin/')) ? ICON.remote : ICON.local;
    button.innerHTML = `${icon}<span>${escapeHtml(base || copy.PICK_BASE_LABEL)}</span>${ICON.chevron}`;
    button.disabled = dialog.pending;
    ref('basemissing').hidden = Boolean(base);
    renderBranchLine();
  }
  syncConfirm();
}

/** Start goes once a place is picked and can take the part, with a base and a part that can be begun. */
function syncConfirm() {
  const confirm = ref('body').querySelector('[data-action="confirm"]');
  if (!confirm) return;
  const part = chosenPart();
  const placeOk = dialog.place === 'checkout' ? !checkoutLock()
    : dialog.place === 'server' ? Boolean(chosenServer()) && !dialog.view.localMode
      : dialog.place === 'workspace';
  confirm.disabled = dialog.pending || !placeOk || !currentBase() || !part || !part.canBegin;
}

function renderBaseList() {
  const filter = ref('basefilter').value.trim().toLowerCase();
  const base = currentBase();
  const options = basesFor().filter((b) => !filter || b.name.toLowerCase().includes(filter));
  const section = (title, rows) => (rows.length === 0 ? '' : `<div class="cloud-briefs-basemenu-title">${escapeHtml(title)}</div>${rows.map((b) => `
      <button type="button" class="cloud-briefs-basemenu-item${b.name === base ? ' current' : ''}" role="option" aria-selected="${b.name === base}" data-action="pick-base" data-base="${escapeHtml(b.name)}">
        ${b.remote ? ICON.remote : ICON.local}<span>${escapeHtml(b.name)}</span>${b.name === base ? ICON.check : ''}
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
  if (confirm) confirm.textContent = startLabel();
  for (const input of dialog.el.querySelectorAll('input, select')) input.disabled = on || input.closest('.disabled, .off') !== null;
  for (const button of dialog.el.querySelectorAll('[data-action="connect-server"], [data-action="add-server"], [data-action="back"]')) button.disabled = on;
  if (ref('base')) ref('base').disabled = on;
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
  else if (name === 'next') goToStep(2);
  else if (name === 'back') goToStep(1);
  else if (name === 'confirm') confirm();
  else if (name === 'add-server') openServers({ add: true });
  else if (name === 'connect-server') openServers({ key: action.dataset.key || null });
  else if (name === 'toggle-base') {
    setMenu(!dialog.menuOpen);
  } else if (name === 'pick-base') {
    if (dialog.place) dialog.bases[dialog.place] = action.dataset.base;
    setMenu(false);
    renderBase();
    if (ref('branch')) ref('branch').focus();
  }
}

function onChange(e) {
  if (!dialog || !dialog.view) return;
  if (e.target === ref('server')) {
    dialog.serverKey = e.target.value || null;
    renderStepTwo({ keepFocus: true });
    ref('server').focus();
    return;
  }
  if (e.target.type !== 'radio' || !e.target.value) return;
  if (e.target.name === `${dialog.id}-place`) {
    setPlace(e.target.value);
    return;
  }
  if (e.target.name !== `${dialog.id}-choice`) return;
  dialog.choice = e.target.value;
  // The name follows the choice until the user types in it.
  if (!dialog.edited) dialog.branchText = dialog.view.suggestions[dialog.choice] || '';
  syncNext();
}

function onInput(e) {
  if (!dialog) return;
  if (e.target === ref('branch')) {
    dialog.edited = true;
    dialog.branchText = e.target.value;
    renderBranchLine();
  } else if (e.target === ref('basefilter')) renderBaseList();
}

function onKeydown(e) {
  if (e.key !== 'Escape' || !dialog) return;
  e.stopPropagation();
  // Esc closes the menu first, then the dialog.
  if (dialog.menuOpen) {
    setMenu(false);
    if (ref('base')) ref('base').focus();
  } else {
    close();
  }
}

async function confirm() {
  const current = dialog;
  if (!current || current.pending || current.done || !current.view || !current.place) return;
  const part = chosenPart();
  const base = currentBase();
  if (!part || !part.canBegin || !base) return;
  const server = current.place === 'server' ? chosenServer() : null;
  if (current.place === 'server' && !server) return;
  const path = state.getProjectPath();
  const request = {
    number: current.number,
    beginPartId: part.partId,
    branch: current.branchText.trim(),
    base,
    place: current.place,
    ...(server ? { serverKey: server.key } : {}),
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
    for (const input of current.el.querySelectorAll('input, select')) input.disabled = true;
    for (const button of current.el.querySelectorAll('[data-action="connect-server"], [data-action="add-server"], [data-action="back"]')) button.disabled = true;
    if (ref('base')) ref('base').disabled = true;
    if (current.onPartial) current.onPartial(result);
    return;
  }
  showError(copy.startErrorMessage(result));
}

module.exports = { open };
