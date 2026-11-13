/**
 * Connect to Server — the renderer side of the Frame Server link
 * (server-workspaces, server-install-update specs).
 *
 * Main owns the connection (serverConnection) and the installer
 * (serverInstaller); this module draws them in the Connect dialog:
 *   - an SSH host (Host entries of ~/.ssh/config as suggestions), Connect /
 *     Disconnect, live status and errors;
 *   - when Frame Server is missing or outdated: the reason, Install / Update,
 *     and the installer's progress lines as they arrive;
 *   - before an update or rollback that would end running agents: the list
 *     of them (or a general warning) with "Update now" / "Later";
 *   - once connected: the server check-up (agent CLIs, gh, git, service)
 *     with the command to fix each missing item, and Roll back when a
 *     previous version is installed.
 * The current status is shared with the status bar (`getStatus`, `onChange`).
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const notify = require('./notify');
const model = require('./serverConnectModel');

let status = { state: 'off', host: null, error: null, frameVersion: null, platform: null, saved: null, install: null };
const listeners = new Set();
let modal = null;
let wantClose = false;      // close once the connect this dialog started succeeds (and the check-up is clean)
// Progress lines, the check-up and the in-flight action (serverConnectModel).
let m = model.initial();
let consent = null;         // { kind: 'update'|'rollback', agents: [...]|null }
let notifiedUpdate = null;  // host+version an "update available" toast was shown for

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

function getStatus() {
  return status;
}

function onChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function updateAvailable(s) {
  return s.state === 'connected' && s.install && (s.install.action === 'update' || s.install.action === 'reinstall-dev');
}

function apply(next) {
  const prev = status;
  status = { ...status, ...next };
  // Progress and the check-up reset when main starts an install, not on a click (S12).
  m = model.onStatus(m, prev, status);
  for (const cb of listeners) {
    try { cb(status, prev); } catch (err) { console.error('serverConnect listener failed', err); }
  }
  if (prev.state !== 'connected' && status.state === 'connected' && prev.state !== 'off') {
    notify.success(`Connected to ${status.host}`);
    loadDoctor();
  } else if (prev.state === 'connected' && status.state === 'reconnecting') {
    notify.info(`Lost the connection to ${status.host} — reconnecting…`);
  }
  if (status.state !== prev.state && (status.state === 'needs-install' || status.state === 'needs-update') && !isOpen()) {
    notify.info(`${LABELS[status.state]} on ${status.host} — open Connect to Server to continue.`);
  }
  if (updateAvailable(status)) {
    const key = `${status.host}@${status.install.desktopVersion}`;
    if (notifiedUpdate !== key) {
      notifiedUpdate = key;
      notify.info(`Frame Server ${status.install.current} on ${status.host} can be updated to ${status.install.desktopVersion} (Connect to Server).`);
    }
  }
  if (isOpen()) renderModal();
}

function isOpen() {
  return !!(modal && modal.classList.contains('visible'));
}

function init() {
  modal = document.getElementById('server-connect-modal');
  ipcRenderer.on(IPC.SERVER_STATUS_CHANGED, (event, s) => apply(s || {}));
  ipcRenderer.on(IPC.SERVER_INSTALL_PROGRESS, (event, { line } = {}) => {
    if (!line) return;
    const lines = [...m.progressLines, line];
    m = { ...m, progressLines: lines.length > 200 ? lines.slice(-200) : lines };
    if (isOpen()) renderModal();
  });
  ipcRenderer.invoke(IPC.SERVER_STATUS).then((s) => {
    apply(s || {});
    if (status.state === 'connected') loadDoctor();
  }).catch(() => {});
  if (!modal) return;
  const $ = (id) => modal.querySelector(id);
  $('#sc-connect').addEventListener('click', connect);
  $('#sc-disconnect').addEventListener('click', disconnect);
  $('#sc-cancel').addEventListener('click', close);
  $('#sc-install-btn').addEventListener('click', () => runAction(status.state === 'needs-install' ? 'install' : 'update'));
  $('#sc-rollback').addEventListener('click', () => runAction('rollback'));
  $('#sc-later').addEventListener('click', () => { consent = null; renderModal(); });
  $('#sc-confirm').addEventListener('click', () => { const kind = consent && consent.kind; consent = null; if (kind) runAction(kind, true); });
  $('#sc-recheck').addEventListener('click', () => loadDoctor(true));
  $('#sc-open-terminal').addEventListener('click', () => openServerTerminal(null));
  $('#sc-doctor-list').addEventListener('click', async (e) => {
    const term = e.target.closest('button[data-terminal-fix]');
    if (term) { openServerTerminal(term.dataset.terminalFix); return; }
    const btn = e.target.closest('button[data-fix]');
    if (!btn) return;
    try { await navigator.clipboard.writeText(btn.dataset.fix); btn.textContent = 'Copied'; } catch (_) { btn.textContent = 'Copy failed'; }
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
  });
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  $('#sc-host').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); connect(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
}

async function loadDoctor(force = false) {
  if (status.state !== 'connected') return;
  if (!force && m.doctor && m.doctorFor === status.host) { finishIfClean(); return; }
  const host = status.host;
  let res;
  try { res = await ipcRenderer.invoke(IPC.SERVER_DOCTOR); } catch (err) { res = { error: err.message, items: [] }; }
  if (status.host !== host) return; // another host since
  m = { ...m, doctor: res, doctorFor: host };
  if (isOpen()) renderModal();
  finishIfClean();
}

/** A connect started here closes the dialog once the check-up has nothing to fix. */
function finishIfClean() {
  if (!wantClose || status.state !== 'connected' || !m.doctor) return;
  const clean = !m.doctor.error && (m.doctor.items || []).every((i) => i.ok || i.optional);
  wantClose = false;
  if (clean && !updateAvailable(status)) close();
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function renderModal() {
  const s = status;
  const $ = (id) => modal.querySelector(id);
  const line = $('#sc-status');
  const shown = s.state === 'off'
    ? (s.saved && s.saved.host ? `Last used: ${s.saved.host}` : 'Not connected')
    : `${LABELS[s.state] || s.state}${s.host ? ` · ${s.host}` : ''}${s.state === 'connected' && s.frameVersion ? ` · Frame Server ${s.frameVersion}${s.platform ? ` (${s.platform})` : ''}` : ''}`;
  line.textContent = shown;
  line.dataset.state = s.state;
  $('#sc-error').textContent = s.error && s.state !== 'connected' ? s.error : '';

  // Install / update panel
  const needs = s.state === 'needs-install' || s.state === 'needs-update';
  const installing = s.state === 'installing';
  const update = updateAvailable(s);
  const progressLines = m.progressLines;
  const doctor = m.doctor;
  const busyNow = model.actionsDisabled(m, s);
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

  // Consent
  const consentEl = $('#sc-consent');
  consentEl.hidden = !consent;
  if (consent) {
    const agents = consent.agents;
    $('#sc-consent-text').textContent = model.consentText({ kind: consent.kind, agents, host: s.host });
    const list = $('#sc-agents');
    list.replaceChildren(...(agents || []).map((a) => el('li', null, `${a.agent} in ${a.workspace || a.workspaceId}`)));
    list.hidden = !agents || !agents.length;
    $('#sc-confirm').textContent = consent.kind === 'rollback' ? 'Roll back now' : 'Update now';
    $('#sc-confirm').disabled = busyNow;
  }

  // Check-up
  const docEl = $('#sc-doctor');
  docEl.hidden = !(s.state === 'connected' && doctor && m.doctorFor === s.host);
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
  // Connected: no need for Reconnect next to the real actions (the host field + Enter still reconnects).
  $('#sc-connect').hidden = needs || installing || s.state === 'connected';
  $('#sc-connect').textContent = s.state === 'off' ? 'Connect' : 'Reconnect';
  $('#sc-host').disabled = installing;
}

async function open() {
  if (!modal) return;
  const input = modal.querySelector('#sc-host');
  const list = modal.querySelector('#sc-hosts');
  let hosts = [];
  try { hosts = await ipcRenderer.invoke(IPC.SERVER_SSH_HOSTS); } catch (_) { hosts = []; }
  list.replaceChildren(...(hosts || []).map((h) => { const o = document.createElement('option'); o.value = h; return o; }));
  input.value = status.host || (status.saved && status.saved.host) || '';
  renderModal();
  modal.classList.add('visible');
  // Back from a fix terminal (a sign-in): check again rather than show the old result.
  const t = model.takeRecheck(m);
  m = t.model;
  if (status.state === 'connected') loadDoctor(t.recheck);
  input.focus();
  input.select();
}

/**
 * A terminal on the server, in its home folder, in the current view
 * (server-onboarding). With `command`, that check-up fix is typed in for the
 * user to run; the dialog closes so the terminal has the screen, and checks
 * again when it is opened next.
 */
async function openServerTerminal(command) {
  if (status.state !== 'connected') return;
  m = model.noteFixOpened(m);
  close();
  try {
    const ui = require('./terminal').getMultiTerminalUI();
    const id = await ui.getManager().createServerHomeTerminal({ command });
    ui.enterLane(id);
  } catch (err) {
    notify.error(`Could not open a terminal on ${status.host}: ${err.message}`);
  }
}

function close() {
  wantClose = false;
  consent = null;
  if (modal) modal.classList.remove('visible');
}

async function connect() {
  const host = modal.querySelector('#sc-host').value.trim();
  const res = await ipcRenderer.invoke(IPC.SERVER_CONNECT, { host });
  if (res && res.error) {
    modal.querySelector('#sc-error').textContent = res.error;
    return;
  }
  // Main accepted the connect: a fresh check-up follows it.
  m = { ...m, doctor: null, doctorFor: null };
  wantClose = true;
  if (res && res.status) apply(res.status);
}

/** Install, update or roll back; update and rollback first ask about running agents. */
async function runAction(kind, confirmAgents = false) {
  const channel = kind === 'install' ? IPC.SERVER_INSTALL : kind === 'rollback' ? IPC.SERVER_ROLLBACK : IPC.SERVER_UPDATE;
  // One action at a time; nothing is cleared here — main's `installing`
  // status clears the old progress when the install really starts (S12).
  const start = model.startAction(m);
  if (!start.allowed) return;
  m = start.model;
  renderModal();
  let res;
  try {
    res = await ipcRenderer.invoke(channel, { host: status.host || modal.querySelector('#sc-host').value.trim(), confirmAgents });
  } catch (err) {
    res = { error: err.message };
  } finally {
    m = model.endAction(m);
  }
  if (res && res.needsConsent) {
    consent = { kind, agents: res.agents };
    renderModal();
    return;
  }
  if (res && res.error) {
    notify.error(`${kind === 'rollback' ? 'Rollback' : 'Install'} failed: ${res.error}`);
    renderModal();
    return;
  }
  const r = res && res.result;
  notify.success(kind === 'rollback' ? `Rolled back to Frame Server ${r ? r.version : ''}` : `Frame Server ${r ? r.version : ''} is running on ${status.host}`);
  wantClose = false;
  if (isOpen()) renderModal();
}

async function disconnect() {
  const res = await ipcRenderer.invoke(IPC.SERVER_DISCONNECT);
  if (res && res.status) apply({ ...res.status, saved: { host: status.host, autoConnect: false } });
  notify.info('Disconnected from the server');
}

module.exports = { init, open, close, getStatus, onChange, disconnect, LABELS };
