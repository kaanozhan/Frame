/**
 * Servers — the renderer side of the Frame Server links
 * (server-workspaces, server-install-update; multi-server-connections).
 *
 * Main owns the connections (serverConnection: one link per saved server)
 * and the installer (serverInstaller); this module draws them in the
 * Servers dialog:
 *   - the saved servers on the left (state dot, host, state), an add form
 *     with the Host entries of ~/.ssh/config as suggestions;
 *   - the selected server on the right: live status and errors, Connect /
 *     Disconnect / Remove;
 *   - when its Frame Server is missing or outdated: the reason, Install /
 *     Update, and the installer's progress lines as they arrive;
 *   - before an update or rollback that would end running agents: the list
 *     of that server's agents (or a general warning) with "Update now" / "Later";
 *   - once connected: the server check-up (agent CLIs, gh, git, service)
 *     with the command to fix each missing item, and Roll back when a
 *     previous version is installed.
 * Each server has its own dialog model (serverConnectModel), so one server's
 * progress or check-up never shows on another.
 *
 * Shared state:
 *   - `getServers()` / `getServer(key)` / `onServersChange(cb(list, prev))`
 *     — every saved server with its status;
 *   - `getStatus()` / `onChange(cb(status, prev))` — the default server (the
 *     first connected one, else the first saved), for views that show one.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const notify = require('./notify');
const model = require('./serverConnectModel');
const sshErrors = require('../shared/sshErrors');

const OFF = { state: 'off', host: null, error: null, frameVersion: null, platform: null, saved: null, install: null };

let servers = [];          // [{ key, host, serverId, autoConnect, status }]
let defaultStatus = OFF;
let selectedKey = null;    // the server the dialog's detail shows
let models = {};           // key → dialog model (progress, check-up, in-flight action)
const listeners = new Set();
const serversListeners = new Set();
let modal = null;
let wantClose = null;      // key whose connect, started here, closes the dialog once its check-up is clean
let consent = null;        // { key, kind: 'update'|'rollback', agents: [...]|null }
let closeListener = null;  // open({ onClose }): told once when the dialog closes (frame-cloud-start-places D18)
const notifiedUpdate = new Set(); // host+version an "update available" toast was shown for

const LABELS = {
  off: 'Not connected',
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  error: 'Could not connect — retrying',
  'needs-install': 'Frame Server is not installed',
  'needs-update': 'Frame Server needs an update',
  installing: 'Installing…'
};

/** A status's label: an ssh failure only the user can fix waits, it does not retry (server-first-connect). */
function labelOf(s) {
  if (s.state === 'error' && sshErrors.needsUser(s.errorKind)) return 'Needs your action';
  return LABELS[s.state] || s.state;
}

// ─── Shared state ────────────────────────────────────────────

function getStatus() {
  return defaultStatus;
}

function getServers() {
  return servers.slice();
}

function getServer(key) {
  return servers.find((s) => s.key === key) || null;
}

function onChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function onServersChange(cb) {
  serversListeners.add(cb);
  return () => serversListeners.delete(cb);
}

function statusOf(key) {
  const s = getServer(key);
  return s ? { ...OFF, ...s.status, host: s.host } : OFF;
}

function m(key = selectedKey) {
  return model.modelFor(models, key);
}

function setModel(key, next) {
  models = model.withModel(models, key, next);
}

function updateAvailable(s) {
  return s.state === 'connected' && s.install && (s.install.action === 'update' || s.install.action === 'reinstall-dev');
}

/** One server's status changed: its model, toasts and check-up. */
function onServerStatus(key, prev, next) {
  setModel(key, model.onStatus(m(key), prev, next));
  const host = next.host;
  if (prev.state !== 'connected' && next.state === 'connected' && prev.state !== 'off') {
    notify.success(`Connected to ${host}`);
    loadDoctor(key);
  } else if (prev.state === 'connected' && next.state === 'reconnecting') {
    notify.info(`Lost the connection to ${host} — reconnecting…`);
  }
  if (next.state !== prev.state && (next.state === 'needs-install' || next.state === 'needs-update') && !isOpen()) {
    notify.info(`${LABELS[next.state]} on ${host} — open Servers to continue.`);
  }
  if (updateAvailable(next)) {
    const tag = `${host}@${next.install.desktopVersion}`;
    if (!notifiedUpdate.has(tag)) {
      notifiedUpdate.add(tag);
      notify.info(`Frame Server ${next.install.current} on ${host} can be updated to ${next.install.desktopVersion} (Servers).`);
    }
  }
}

/** A status payload from main: `{ ...default server status, servers, notice? }`. */
function apply(payload) {
  const p = payload || {};
  const prevServers = servers;
  const prevDefault = defaultStatus;
  if (Array.isArray(p.servers)) {
    servers = p.servers.map((s) => ({ ...s, status: { ...OFF, ...(s.status || {}), host: s.host } }));
    models = model.pruneModels(models, servers.map((s) => s.key));
    for (const s of servers) {
      const before = prevServers.find((x) => x.key === s.key);
      onServerStatus(s.key, before ? before.status : OFF, s.status);
    }
  }
  const first = servers[0];
  defaultStatus = { ...OFF, ...p, saved: first ? { host: first.host, autoConnect: first.autoConnect } : null };
  delete defaultStatus.servers;
  delete defaultStatus.notice;
  selectedKey = model.pickSelected(servers, selectedKey);
  if (p.notice && p.notice.kind === 'duplicate') {
    notify.error(`${p.notice.host} is the same server as ${p.notice.existingHost} — it stays listed once, as ${p.notice.existingHost}.`);
    if (p.notice.existingKey) selectedKey = p.notice.existingKey;
  }
  for (const cb of listeners) {
    try { cb(defaultStatus, prevDefault); } catch (err) { console.error('serverConnect listener failed', err); }
  }
  for (const cb of serversListeners) {
    try { cb(getServers(), prevServers); } catch (err) { console.error('serverConnect servers listener failed', err); }
  }
  if (isOpen()) renderModal();
}

function isOpen() {
  return !!(modal && modal.classList.contains('visible'));
}

// ─── Dialog ──────────────────────────────────────────────────

function init() {
  modal = document.getElementById('server-connect-modal');
  ipcRenderer.on(IPC.SERVER_STATUS_CHANGED, (event, s) => apply(s || {}));
  ipcRenderer.on(IPC.SERVER_INSTALL_PROGRESS, (event, { key, line } = {}) => {
    if (!line || !key) return;
    const cur = m(key);
    const lines = [...cur.progressLines, line];
    setModel(key, { ...cur, progressLines: lines.length > 200 ? lines.slice(-200) : lines });
    if (isOpen() && key === selectedKey) renderModal();
  });
  ipcRenderer.invoke(IPC.SERVER_STATUS).then((s) => {
    apply(s || {});
    for (const srv of servers) if (srv.status.state === 'connected') loadDoctor(srv.key);
  }).catch(() => {});
  if (!modal) return;
  const $ = (id) => modal.querySelector(id);
  $('#sc-connect').addEventListener('click', () => connect(selectedKey));
  $('#sc-disconnect').addEventListener('click', () => disconnectOne(selectedKey));
  $('#sc-remove').addEventListener('click', () => removeServer(selectedKey));
  $('#sc-cancel').addEventListener('click', close);
  $('#sc-install-btn').addEventListener('click', () => runAction(statusOf(selectedKey).state === 'needs-install' ? 'install' : 'update'));
  $('#sc-rollback').addEventListener('click', () => runAction('rollback'));
  $('#sc-later').addEventListener('click', () => { consent = null; renderModal(); });
  $('#sc-confirm').addEventListener('click', () => {
    const c = consent;
    consent = null;
    if (c && c.key === selectedKey) runAction(c.kind, true);
    else renderModal();
  });
  $('#sc-recheck').addEventListener('click', () => loadDoctor(selectedKey, true));
  $('#sc-error-action').addEventListener('click', () => openSetupTerminal());
  // "Before you start" (server-first-connect): the key setup, for any host.
  const noteCommand = sshErrors.setupCommand('user@host');
  $('#sc-note-command').textContent = noteCommand;
  $('#sc-note-copy').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    try { await navigator.clipboard.writeText(noteCommand); btn.textContent = 'Copied'; } catch (_) { btn.textContent = 'Copy failed'; }
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
  });
  $('#sc-open-terminal').addEventListener('click', () => openServerTerminal(null));
  $('#sc-doctor-list').addEventListener('click', async (e) => {
    const term = e.target.closest('button[data-terminal-fix]');
    if (term) { openServerTerminal(term.dataset.terminalFix); return; }
    const btn = e.target.closest('button[data-fix]');
    if (!btn) return;
    try { await navigator.clipboard.writeText(btn.dataset.fix); btn.textContent = 'Copied'; } catch (_) { btn.textContent = 'Copy failed'; }
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
  });
  $('#sc-servers').addEventListener('click', (e) => {
    const row = e.target.closest('[data-key]');
    if (row) select(row.dataset.key);
  });
  $('#sc-servers').addEventListener('keydown', (e) => {
    const rows = [...modal.querySelectorAll('#sc-servers [data-key]')];
    const at = rows.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = rows[(at + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length];
      if (next) { select(next.dataset.key); next.focus(); }
    } else if ((e.key === 'Enter' || e.key === ' ') && at >= 0) {
      e.preventDefault();
      select(rows[at].dataset.key);
    }
  });
  $('#sc-add-form').addEventListener('submit', (e) => { e.preventDefault(); addServer(); });
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
}

function select(key) {
  if (!key || key === selectedKey) return;
  selectedKey = key;
  consent = null;
  renderModal();
  if (statusOf(key).state === 'connected') loadDoctor(key);
}

async function loadDoctor(key, force = false) {
  const s = statusOf(key);
  if (!key || s.state !== 'connected') return;
  const cur = m(key);
  if (!force && cur.doctor && cur.doctorFor === s.host) { finishIfClean(key); return; }
  let res;
  try { res = await ipcRenderer.invoke(IPC.SERVER_DOCTOR, { key }); } catch (err) { res = { error: err.message, items: [] }; }
  if (!getServer(key)) return; // removed since
  setModel(key, { ...m(key), doctor: res, doctorFor: s.host });
  if (isOpen() && key === selectedKey) renderModal();
  finishIfClean(key);
}

/** A connect started here closes the dialog once that server's check-up has nothing to fix. */
function finishIfClean(key) {
  const s = statusOf(key);
  const cur = m(key);
  if (wantClose !== key || s.state !== 'connected' || !cur.doctor) return;
  const clean = !cur.doctor.error && (cur.doctor.items || []).every((i) => i.ok || i.optional);
  wantClose = null;
  if (clean && !updateAvailable(s) && key === selectedKey) close();
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function renderList() {
  const list = modal.querySelector('#sc-servers');
  list.replaceChildren(...servers.map((srv) => {
    const st = srv.status.state;
    const li = el('li', `sc-server${srv.key === selectedKey ? ' on' : ''}`);
    li.dataset.key = srv.key;
    li.dataset.state = st;
    li.tabIndex = srv.key === selectedKey ? 0 : -1;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', srv.key === selectedKey ? 'true' : 'false');
    li.appendChild(el('span', 'sc-server-dot'));
    const text = el('span', 'sc-server-text');
    text.appendChild(el('span', 'sc-server-host', srv.host));
    text.appendChild(el('span', 'sc-server-state', labelOf(srv.status)));
    li.appendChild(text);
    return li;
  }));
  list.hidden = servers.length === 0;
}

function renderModal() {
  const $ = (id) => modal.querySelector(id);
  renderList();
  const has = !!getServer(selectedKey);
  $('#sc-empty').hidden = has;
  $('#sc-detail-body').hidden = !has;
  if (!has) {
    for (const id of ['#sc-disconnect', '#sc-rollback', '#sc-install-btn', '#sc-connect']) $(id).hidden = true;
    return;
  }
  const s = statusOf(selectedKey);
  const cur = m(selectedKey);
  $('#sc-detail-host').textContent = s.host;
  // Connect → Install Frame Server → Check-up (server-first-connect).
  $('#sc-steps').replaceChildren(...model.steps(s, cur.doctorFor === s.host ? cur.doctor : null).map((step, i) => {
    const li = el('li', 'sc-step');
    li.dataset.state = step.state;
    li.appendChild(el('span', 'sc-step-mark', step.state === 'done' ? '✓' : (step.state === 'failed' || step.state === 'attention') ? '!' : String(i + 1)));
    li.appendChild(el('span', 'sc-step-label', step.label));
    if (step.state === 'active') li.setAttribute('aria-current', 'step');
    return li;
  }));
  const line = $('#sc-status');
  line.textContent = `${labelOf(s)}${s.state === 'connected' && s.frameVersion ? ` · Frame Server ${s.frameVersion}${s.platform ? ` (${s.platform})` : ''}` : ''}`;
  line.dataset.state = s.state;
  // ssh's failure in plain words, with the one step that fixes it (server-first-connect).
  const failed = !!s.error && s.state !== 'connected';
  const said = failed ? sshErrors.describe(s.errorKind, s.host, s.error) : { message: '', action: null };
  $('#sc-error').textContent = said.message;
  $('#sc-error-action').hidden = said.action !== 'setup';

  // Install / update panel
  const needs = s.state === 'needs-install' || s.state === 'needs-update';
  const installing = s.state === 'installing';
  const update = updateAvailable(s);
  const progressLines = cur.progressLines;
  const doctor = cur.doctor;
  const busyNow = model.actionsDisabled(cur, s);
  const failedInstall = s.state === 'error' && progressLines.length > 0;
  $('#sc-install').hidden = !(needs || installing || update || failedInstall);
  $('#sc-install-reason').textContent = installing
    ? 'Installing Frame Server — this can take a minute.'
    : s.install && s.install.reason
      ? `${s.install.reason}${update || s.state === 'needs-update' ? ` Update to ${s.install.desktopVersion}?` : ''}`
      : '';
  const progress = $('#sc-progress');
  progress.hidden = progressLines.length === 0;
  progress.textContent = progressLines.join('\n');
  progress.scrollTop = progress.scrollHeight;

  const installBtn = $('#sc-install-btn');
  installBtn.hidden = !(needs || update || failedInstall) || installing;
  installBtn.disabled = busyNow;
  installBtn.textContent = s.state === 'needs-install' || (failedInstall && !(s.install && s.install.current)) ? 'Install Frame Server' : 'Update Frame Server';

  // Consent (only for the server it was asked about)
  const shownConsent = consent && consent.key === selectedKey ? consent : null;
  const consentEl = $('#sc-consent');
  consentEl.hidden = !shownConsent;
  if (shownConsent) {
    const agents = shownConsent.agents;
    $('#sc-consent-text').textContent = model.consentText({ kind: shownConsent.kind, agents, host: s.host });
    const list = $('#sc-agents');
    list.replaceChildren(...(agents || []).map((a) => el('li', null, `${a.agent} in ${a.workspace || a.workspaceId}`)));
    list.hidden = !agents || !agents.length;
    $('#sc-confirm').textContent = shownConsent.kind === 'rollback' ? 'Roll back now' : 'Update now';
    $('#sc-confirm').disabled = busyNow;
  }

  // Check-up
  const docEl = $('#sc-doctor');
  docEl.hidden = !(s.state === 'connected' && doctor && cur.doctorFor === s.host);
  if (!docEl.hidden) {
    const items = doctor.error ? [{ id: 'error', label: 'Check-up failed', ok: false, detail: doctor.error }] : (doctor.items || []);
    $('#sc-doctor-list').replaceChildren(...items.map((i) => {
      const li = el('li', `sc-check${i.ok ? '' : i.optional ? ' optional' : ' missing'}`);
      li.appendChild(el('span', 'sc-check-mark', i.ok ? '✓' : i.optional ? '–' : '!'));
      const body = el('div');
      body.appendChild(el('span', 'sc-check-label', i.label));
      body.appendChild(el('span', 'sc-check-detail', ` — ${i.detail}${i.optional ? ' (optional)' : ''}`));
      if (!i.ok && i.fix) {
        const fix = el('div', 'sc-fix');
        fix.appendChild(el('code', null, i.fix));
        const copy = el('button', 'sc-link', 'Copy');
        copy.type = 'button';
        copy.dataset.fix = i.fix;
        fix.appendChild(copy);
        // Run it on the server without leaving Frame (server-onboarding).
        const typed = model.fixTerminalFor(i);
        if (typed) {
          const open = el('button', 'sc-link', 'Open terminal');
          open.type = 'button';
          open.dataset.terminalFix = typed;
          fix.appendChild(open);
        }
        body.appendChild(fix);
        // What the command will ask of the user, e.g. gh's device code (G2).
        if (i.note) body.appendChild(el('p', 'sc-check-note', i.note));
      }
      li.appendChild(body);
      return li;
    }));
  }

  const rollback = $('#sc-rollback');
  const prev = s.install && s.install.previous;
  rollback.hidden = !(s.state === 'connected' && prev);
  rollback.disabled = busyNow;
  rollback.textContent = prev ? `Roll back to ${prev}` : 'Roll back';
  $('#sc-disconnect').hidden = s.state === 'off';
  $('#sc-connect').hidden = needs || installing || s.state === 'connected';
  $('#sc-connect').textContent = s.state === 'off' ? 'Connect' : 'Reconnect';
  $('#sc-remove').disabled = installing;
}

/**
 * Open the Servers dialog. `key` selects that server; `add` (or no saved
 * server at all) puts the cursor in the add form. `onClose({ handoff })` is
 * called once when the dialog next closes — `handoff` when it closed to give
 * a terminal the screen — so a caller such as Start Work can come back
 * (frame-cloud-start-places D18). An `open` without `onClose` keeps one that
 * is still waiting.
 */
async function open({ key = null, add = false, onClose = null } = {}) {
  if (!modal) return;
  if (typeof onClose === 'function') closeListener = onClose;
  const input = modal.querySelector('#sc-host');
  const list = modal.querySelector('#sc-hosts');
  let hosts = [];
  try { hosts = await ipcRenderer.invoke(IPC.SERVER_SSH_HOSTS); } catch (_) { hosts = []; }
  const saved = new Set(servers.map((s) => s.host.toLowerCase()));
  list.replaceChildren(...(hosts || []).filter((h) => !saved.has(String(h).toLowerCase())).map((h) => { const o = document.createElement('option'); o.value = h; return o; }));
  if (key && getServer(key)) selectedKey = key;
  selectedKey = model.pickSelected(servers, selectedKey);
  input.value = '';
  modal.querySelector('#sc-add-error').textContent = '';
  renderModal();
  modal.classList.add('visible');
  // Back from a fix terminal (a sign-in): check again rather than show the old result.
  if (selectedKey) {
    const t = model.takeRecheck(m(selectedKey));
    setModel(selectedKey, t.model);
    if (statusOf(selectedKey).state === 'connected') loadDoctor(selectedKey, t.recheck);
  }
  if (add || !servers.length) {
    input.focus();
  } else {
    const row = modal.querySelector('#sc-servers .sc-server.on');
    if (row) row.focus();
  }
}

/**
 * A terminal on the selected server, in its home folder, in the current view
 * (server-onboarding). With `command`, that check-up fix is typed in for the
 * user to run; the dialog closes so the terminal has the screen, and checks
 * again when it is opened next.
 */
async function openServerTerminal(command) {
  const key = selectedKey;
  const s = statusOf(key);
  if (s.state !== 'connected') return;
  setModel(key, model.noteFixOpened(m(key)));
  close({ handoff: true });
  try {
    const ui = require('./terminal').getMultiTerminalUI();
    const id = await ui.getManager().createServerHomeTerminal({ command, serverKey: key });
    ui.enterLane(id);
  } catch (err) {
    notify.error(`Could not open a terminal on ${s.host}: ${err.message}`);
  }
}

/**
 * "Set up access in a terminal" (server-first-connect): a terminal on this
 * Mac with the key setup typed in for the selected server. ssh itself shows
 * the fingerprint and asks for the password; the dialog closes so the
 * terminal has the screen, and Connect is pressed when the user is done.
 */
async function openSetupTerminal() {
  const s = statusOf(selectedKey);
  if (!s.host) return;
  close({ handoff: true });
  try {
    const ui = require('./terminal').getMultiTerminalUI();
    const id = await ui.getManager().createLocalCommandTerminal({ command: sshErrors.setupCommand(s.host), name: `Set up ${s.host}` });
    ui.enterLane(id);
    notify.info(`Press Enter in the terminal, answer ssh there, then Connect ${s.host} again from Servers.`);
  } catch (err) {
    notify.error(`Could not open a terminal: ${err.message}`);
  }
}

/**
 * Close the dialog. `handoff` says it closed for a terminal (a check-up fix,
 * the ssh access setup). A click or key event passed as the argument reads as
 * no handoff.
 */
function close({ handoff = false } = {}) {
  wantClose = null;
  consent = null;
  if (modal) modal.classList.remove('visible');
  const listener = closeListener;
  closeListener = null;
  if (listener) {
    try { listener({ handoff: handoff === true }); } catch (err) { console.error('serverConnect close listener failed', err); }
  }
}

/** Add the host typed in the form, select it and connect it. */
async function addServer() {
  const input = modal.querySelector('#sc-host');
  const errEl = modal.querySelector('#sc-add-error');
  const host = input.value.trim();
  errEl.textContent = '';
  if (!host) { input.focus(); return; }
  const res = await ipcRenderer.invoke(IPC.SERVER_ADD, { host });
  if (res && res.error) {
    errEl.textContent = res.error;
    if (res.existing) select(res.existing.key);
    return;
  }
  input.value = '';
  selectedKey = res.entry.key;
  await connect(res.entry.key);
}

async function connect(key) {
  if (!key) return;
  const res = await ipcRenderer.invoke(IPC.SERVER_CONNECT, { key });
  if (res && res.error) {
    modal.querySelector('#sc-error').textContent = res.error;
    return;
  }
  // Main accepted the connect: a fresh check-up follows it.
  setModel(key, { ...m(key), doctor: null, doctorFor: null });
  wantClose = key;
  if (isOpen()) renderModal();
}

/** Disconnect one server; it stays in the list and off at the next launch. */
async function disconnectOne(key) {
  const srv = getServer(key);
  if (!srv) return;
  await ipcRenderer.invoke(IPC.SERVER_DISCONNECT, { key });
  notify.info(`Disconnected from ${srv.host}`);
}

/** Disconnect every server (File ▸ Disconnect from Server, palette). */
async function disconnect() {
  await ipcRenderer.invoke(IPC.SERVER_DISCONNECT, {});
  notify.info(servers.length > 1 ? 'Disconnected from every server' : 'Disconnected from the server');
}

/** Forget a server after asking; nothing on the server is touched. */
async function removeServer(key) {
  const srv = getServer(key);
  if (!srv) return;
  const ok = window.confirm(`Remove ${srv.host} from Frame?\n\nIts workspaces and terminals leave this window. Nothing on ${srv.host} is deleted — its terminals keep running there, and adding it again brings them back.`);
  if (!ok) return;
  const res = await ipcRenderer.invoke(IPC.SERVER_REMOVE, { key });
  if (res && res.error) { notify.error(res.error); return; }
  if (selectedKey === key) selectedKey = null;
  notify.info(`Removed ${srv.host}`);
}

/** Install, update or roll back the selected server; update and rollback first ask about its running agents. */
async function runAction(kind, confirmAgents = false) {
  const key = selectedKey;
  if (!key) return;
  const channel = kind === 'install' ? IPC.SERVER_INSTALL : kind === 'rollback' ? IPC.SERVER_ROLLBACK : IPC.SERVER_UPDATE;
  // One action at a time per server; nothing is cleared here — main's
  // `installing` status clears the old progress when the install really
  // starts (S12).
  const start = model.startAction(m(key));
  if (!start.allowed) return;
  setModel(key, start.model);
  renderModal();
  let res;
  try {
    res = await ipcRenderer.invoke(channel, { key, confirmAgents });
  } catch (err) {
    res = { error: err.message };
  } finally {
    setModel(key, model.endAction(m(key)));
  }
  const host = statusOf(key).host;
  if (res && res.needsConsent) {
    consent = { key, kind, agents: res.agents };
    if (isOpen()) renderModal();
    return;
  }
  if (res && res.error) {
    notify.error(`${kind === 'rollback' ? 'Rollback' : 'Install'} on ${host} failed: ${res.error}`);
    if (isOpen()) renderModal();
    return;
  }
  const r = res && res.result;
  notify.success(kind === 'rollback' ? `Rolled back ${host} to Frame Server ${r ? r.version : ''}` : `Frame Server ${r ? r.version : ''} is running on ${host}`);
  if (wantClose === key) wantClose = null;
  if (isOpen()) renderModal();
}

module.exports = { init, open, close, getStatus, getServers, getServer, onChange, onServersChange, disconnect, LABELS };
