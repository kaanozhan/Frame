/**
 * Connect to Server — the renderer side of the Frame Server link
 * (server-workspaces spec).
 *
 * Main owns the connection (serverConnection); this module draws it: the
 * Connect dialog (an SSH host, with the Host entries of ~/.ssh/config as
 * suggestions; Connect / Disconnect; live status and errors), and the
 * current status for the status bar and anything else that asks
 * (`getStatus`, `onChange`).
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const notify = require('./notify');

let status = { state: 'off', host: null, error: null, frameVersion: null, platform: null, saved: null };
const listeners = new Set();
let modal = null;
let wantClose = false; // the dialog closes itself once the connect it started succeeds

const LABELS = {
  off: 'Not connected',
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  error: 'Could not connect — retrying'
};

function getStatus() {
  return status;
}

function onChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function apply(next) {
  const prev = status;
  status = { ...status, ...next };
  for (const cb of listeners) {
    try { cb(status, prev); } catch (err) { console.error('serverConnect listener failed', err); }
  }
  if (prev.state !== 'connected' && status.state === 'connected' && prev.state !== 'off') {
    notify.success(`Connected to ${status.host}`);
  } else if (prev.state === 'connected' && status.state === 'reconnecting') {
    notify.info(`Lost the connection to ${status.host} — reconnecting…`);
  }
  if (modal && modal.classList.contains('visible')) renderModal();
  if (wantClose && status.state === 'connected') {
    wantClose = false;
    close();
  }
}

function init() {
  modal = document.getElementById('server-connect-modal');
  ipcRenderer.on(IPC.SERVER_STATUS_CHANGED, (event, s) => apply(s || {}));
  ipcRenderer.invoke(IPC.SERVER_STATUS).then((s) => apply(s || {})).catch(() => {});
  if (!modal) return;
  modal.querySelector('#sc-connect').addEventListener('click', connect);
  modal.querySelector('#sc-disconnect').addEventListener('click', disconnect);
  modal.querySelector('#sc-cancel').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modal.querySelector('#sc-host').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); connect(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
}

function renderModal() {
  const s = status;
  const line = modal.querySelector('#sc-status');
  const err = modal.querySelector('#sc-error');
  const shown = s.state === 'off' ? (s.saved && s.saved.host ? `Last used: ${s.saved.host}` : 'Not connected') : `${LABELS[s.state] || s.state}${s.host ? ` · ${s.host}` : ''}${s.state === 'connected' && s.frameVersion ? ` · Frame Server ${s.frameVersion}${s.platform ? ` (${s.platform})` : ''}` : ''}`;
  line.textContent = shown;
  line.dataset.state = s.state;
  err.textContent = s.error && s.state !== 'connected' ? s.error : '';
  modal.querySelector('#sc-disconnect').hidden = s.state === 'off';
  modal.querySelector('#sc-connect').textContent = s.state === 'off' ? 'Connect' : 'Reconnect';
}

async function open() {
  if (!modal) return;
  const input = modal.querySelector('#sc-host');
  const list = modal.querySelector('#sc-hosts');
  let hosts = [];
  try { hosts = await ipcRenderer.invoke(IPC.SERVER_SSH_HOSTS); } catch (_) { hosts = []; }
  list.innerHTML = '';
  for (const h of hosts || []) {
    const o = document.createElement('option');
    o.value = h;
    list.appendChild(o);
  }
  input.value = status.host || (status.saved && status.saved.host) || '';
  renderModal();
  modal.classList.add('visible');
  input.focus();
  input.select();
}

function close() {
  wantClose = false;
  if (modal) modal.classList.remove('visible');
}

async function connect() {
  const host = modal.querySelector('#sc-host').value.trim();
  const res = await ipcRenderer.invoke(IPC.SERVER_CONNECT, { host });
  if (res && res.error) {
    modal.querySelector('#sc-error').textContent = res.error;
    return;
  }
  wantClose = true;
  if (res && res.status) apply(res.status);
}

async function disconnect() {
  const res = await ipcRenderer.invoke(IPC.SERVER_DISCONNECT);
  if (res && res.status) apply({ ...res.status, saved: { host: status.host, autoConnect: false } });
  notify.info('Disconnected from the server');
}

module.exports = { init, open, close, getStatus, onChange, disconnect, LABELS };
