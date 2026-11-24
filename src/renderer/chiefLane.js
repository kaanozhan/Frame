/**
 * chiefLane — the Chief terminal in the renderer (lead-agent spec, T10).
 *
 * Every project gets one Chief: a terminal Frame opens by itself in `main`,
 * pinned first, never closed by the user, outside the terminal cap. Its
 * Claude session does not run until the user clicks Start (spec: one click).
 * On top of the terminal this module draws:
 *   - the Start overlay (shown again whenever the session exits), with the
 *     send-mode switch (user-guided / full auto);
 *   - a small mode chip while the session runs;
 *   - approval cards — "Chief wants to send …" with Approve / Reject / Edit —
 *     plus a pending count on the Chief's chip and pane and a sticky toast,
 *     so an approval asked for while you are elsewhere is not missed (D17).
 *
 * Each connected Frame Server that holds the project's workspaces gets its
 * own Chief too ("Chief · host", T12): it runs on that server, in the
 * project's clone there, and keeps working while this Mac is away. Its
 * approvals arrive the same way, tagged with the server.
 *
 * Everything the Chief can do is decided in the main process (leadHost);
 * this module only shows state and relays the user's clicks.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const state = require('./state');
const notify = require('./notify');

const MODES = [
  { id: 'user-guided', label: 'User-guided', hint: 'Every message the Chief sends waits for your approval here.' },
  { id: 'full-auto', label: 'Full auto', hint: 'The Chief sends without asking. Terminals waiting on you, and conductor lanes, are still off-limits.' }
];

let ui = null;
let manager = null;
// terminalId → { projectPath, running, seenAgent, mode, pending: [], els }
const chiefs = new Map();
const ensuring = new Set(); // projectPaths (and `projectPath#serverKey`) with an ensure in flight
let serverTimer = null;

const isServerId = (id) => String(id).startsWith('srv-');
const serverKeyOf = (id) => { const m = /^srv-([0-9a-z]+)\./.exec(String(id)); return m ? m[1] : null; };

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function chiefOf(projectPath) {
  for (const [id, c] of chiefs) if (c.projectPath === projectPath) return id;
  return null;
}

// ─── ensure one Chief per project ─────────────────────────

async function ensure(projectPath) {
  if (!projectPath || ensuring.has(projectPath)) return;
  const known = manager.getTerminalsInScope(projectPath, 'main').find((t) => t.lead && !isServerId(t.id));
  if (known) {
    decorate(known.id, projectPath);
    return;
  }
  ensuring.add(projectPath);
  try {
    const id = await manager.createTerminal({ projectPath, workspaceId: 'main', cwd: projectPath, lead: true, name: 'Chief' });
    if (id) decorate(id, projectPath);
  } catch (err) {
    if (err && err.code === 'LEAD_EXISTS') return; // main already has one (another window); nothing to draw here
    console.warn('chiefLane: could not open the Chief terminal:', err && err.message);
  } finally {
    ensuring.delete(projectPath);
  }
  ensureServers(projectPath);
}

/** One Chief per connected server that holds this project's workspaces (T12). */
async function ensureServers(projectPath) {
  let targets = [];
  try {
    targets = await ipcRenderer.invoke(IPC.LEAD_SERVER_TARGETS, { projectPath });
  } catch (_) {
    return;
  }
  for (const t of targets || []) {
    const key = `${projectPath}#${t.serverKey}`;
    if (ensuring.has(key)) continue;
    const known = manager.getTerminalsInScope(projectPath, 'main').find((s) => s.lead && serverKeyOf(s.id) === t.serverKey);
    if (known) {
      decorate(known.id, projectPath, t.host);
      continue;
    }
    ensuring.add(key);
    try {
      const id = await manager.createTerminal({
        projectPath, workspaceId: 'main', lead: true, name: `Chief · ${t.host}`,
        location: 'server-lead', serverKey: t.serverKey, serverProjectPath: t.serverProjectPath
      });
      if (id) decorate(id, projectPath, t.host);
    } catch (err) {
      // The server already runs one (opened from another window, or before a
      // reload): bring it in rather than open a second.
      if (err && err.code === 'LEAD_EXISTS') {
        await manager.adoptServerTerminals(projectPath);
        const adopted = manager.getTerminalsInScope(projectPath, 'main').find((s) => s.lead && serverKeyOf(s.id) === t.serverKey);
        if (adopted) decorate(adopted.id, projectPath, t.host);
      } else {
        console.warn(`chiefLane: could not open the Chief on ${t.host}:`, err && err.message);
      }
    } finally {
      ensuring.delete(key);
    }
  }
}

// ─── overlay + cards ──────────────────────────────────────

function decorate(terminalId, projectPath, host = null) {
  if (chiefs.has(terminalId)) return;
  const instance = manager.getTerminal(terminalId);
  if (!instance) return;
  const c = { projectPath, host, running: false, seenAgent: false, mode: 'user-guided', pending: [], els: {} };
  chiefs.set(terminalId, c);

  const root = instance.element;
  root.classList.add('chief-host');

  const overlay = document.createElement('div');
  overlay.className = 'chief-overlay';
  overlay.innerHTML = `
    <div class="chief-card">
      <div class="chief-title">Chief</div>
      <p class="chief-lede">${host
        ? `Runs on ${escapeHtml(host)} and sees this project's terminals there — it keeps working while this Mac is away. Tells you what each agent is doing and passes your instructions to the right one.`
        : 'Sees every terminal of this project on this Mac, tells you what each agent is doing, and passes your instructions to the right one.'}</p>
      <div class="chief-modes" role="radiogroup" aria-label="Send mode">
        ${MODES.map((m) => `<button type="button" class="chief-mode" role="radio" data-mode="${m.id}" title="${escapeHtml(m.hint)}">${m.label}</button>`).join('')}
      </div>
      <p class="chief-mode-hint"></p>
      <button type="button" class="chief-start">Start Chief</button>
    </div>`;
  root.appendChild(overlay);

  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chief-mode-chip';
  chip.title = 'Send mode — click to switch';
  root.appendChild(chip);

  const cards = document.createElement('div');
  cards.className = 'chief-approvals';
  root.appendChild(cards);

  c.els = { overlay, chip, cards };

  overlay.querySelectorAll('.chief-mode').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    setMode(terminalId, b.dataset.mode);
  }));
  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    setMode(terminalId, c.mode === 'full-auto' ? 'user-guided' : 'full-auto');
  });
  overlay.querySelector('.chief-start').addEventListener('click', (e) => {
    e.stopPropagation();
    start(terminalId);
  });

  ipcRenderer.invoke(IPC.LEAD_MODE_GET, { projectPath, terminalId }).then((mode) => { c.mode = mode || 'user-guided'; render(terminalId); }).catch(() => render(terminalId));
  render(terminalId);
  refreshPending(projectPath);
}

/** Approvals asked while this window could not see them (reload, a server reconnect). */
async function refreshPending(projectPath) {
  try {
    const list = await ipcRenderer.invoke(IPC.LEAD_PENDING, { projectPath });
    for (const c of list || []) onApprovals({ chiefId: c.chiefId, serverKey: c.serverKey || null, pending: c.pending });
  } catch (_) { /* nothing to show */ }
}

function render(terminalId) {
  const c = chiefs.get(terminalId);
  if (!c) return;
  const { overlay, chip } = c.els;
  overlay.hidden = c.running;
  chip.hidden = !c.running;
  overlay.querySelectorAll('.chief-mode').forEach((b) => {
    const on = b.dataset.mode === c.mode;
    b.classList.toggle('selected', on);
    b.setAttribute('aria-checked', String(on));
  });
  const m = MODES.find((x) => x.id === c.mode) || MODES[0];
  overlay.querySelector('.chief-mode-hint').textContent = m.hint;
  chip.textContent = m.label;
  chip.classList.toggle('auto', c.mode === 'full-auto');
  renderCards(terminalId);
}

async function setMode(terminalId, mode) {
  const c = chiefs.get(terminalId);
  if (!c) return;
  try {
    c.mode = await ipcRenderer.invoke(IPC.LEAD_MODE_SET, { projectPath: c.projectPath, mode, terminalId });
  } catch (_) { /* keep the old one */ }
  render(terminalId);
}

async function start(terminalId) {
  const c = chiefs.get(terminalId);
  if (!c || c.running) return;
  const btn = c.els.overlay.querySelector('.chief-start');
  btn.disabled = true;
  try {
    const res = await ipcRenderer.invoke(IPC.LEAD_START, { projectPath: c.projectPath, terminalId });
    if (!res || !res.ok) {
      notify.error(`Chief could not start: ${(res && res.error) || 'unknown error'}`);
      return;
    }
    c.mode = res.mode || c.mode;
    c.running = true;
    c.seenAgent = false;
    render(terminalId);
    manager.setActiveTerminal(terminalId);
    manager.sendCommand(res.command, terminalId);
  } finally {
    btn.disabled = false;
  }
}

/** The Chief's session left its terminal (back at the shell): show Start again. */
function stopped(terminalId) {
  const c = chiefs.get(terminalId);
  if (!c || !c.running) return;
  c.running = false;
  c.seenAgent = false;
  ipcRenderer.send(IPC.LEAD_STOP, { terminalId });
  render(terminalId);
}

/** "Send to 1st Terminal (blue)": the target as the user sees it, not its id. */
function approvalTitle(rec) {
  const target = rec.target && manager.getTerminal(rec.target);
  const name = target ? (target.state.customName || target.state.name) : null;
  if (!name || rec.action !== 'terminal_send') return rec.summary || 'Chief wants to act';
  const ws = rec.payload && rec.payload.workspace && rec.payload.workspace !== 'main' ? ` (${rec.payload.workspace})` : '';
  return `Send to ${name}${ws}`;
}

function renderCards(terminalId) {
  const c = chiefs.get(terminalId);
  if (!c) return;
  const { cards } = c.els;
  cards.innerHTML = '';
  for (const rec of c.pending) {
    const text = rec.payload && typeof rec.payload.text === 'string' ? rec.payload.text : '';
    const card = document.createElement('div');
    card.className = 'chief-approval';
    card.innerHTML = `
      <div class="chief-approval-head">${escapeHtml(approvalTitle(rec))}</div>
      <textarea class="chief-approval-text" rows="${Math.min(8, Math.max(2, text.split('\n').length))}" spellcheck="false">${escapeHtml(text)}</textarea>
      <div class="chief-approval-actions">
        <button type="button" class="chief-approve">Approve</button>
        <button type="button" class="chief-reject">Reject</button>
      </div>`;
    const area = card.querySelector('textarea');
    const decide = async (decision) => {
      const edited = decision === 'approved' && area.value !== text;
      card.classList.add('deciding');
      try {
        await ipcRenderer.invoke(IPC.LEAD_DECIDE, { approvalId: rec.id, decision: edited ? 'edited' : decision, text: edited ? area.value : null, serverKey: rec.serverKey || null });
      } catch (err) {
        notify.error(`Could not record the decision: ${err.message}`);
        card.classList.remove('deciding');
      }
    };
    area.addEventListener('keydown', (e) => e.stopPropagation()); // typing here is not typing into the terminal
    card.querySelector('.chief-approve').addEventListener('click', (e) => { e.stopPropagation(); decide('approved'); });
    card.querySelector('.chief-reject').addEventListener('click', (e) => { e.stopPropagation(); decide('rejected'); });
    cards.appendChild(card);
  }
}

/** main → renderer: a Chief's pending approvals changed. */
function onApprovals(payload) {
  const id = payload && payload.chiefId;
  const c = id && chiefs.get(id);
  if (!c) return;
  const before = new Set(c.pending.map((r) => r.id));
  c.pending = Array.isArray(payload.pending) ? payload.pending.map((r) => ({ ...r, serverKey: r.serverKey || payload.serverKey || null })) : [];
  manager.setLeadPending(id, c.pending.length);
  renderCards(id);
  const fresh = c.pending.filter((r) => !before.has(r.id));
  if (fresh.length) {
    const project = `${c.projectPath.split(/[\\/]/).pop()}${c.host ? ` on ${c.host}` : ''}`;
    notify.info(`Chief (${project}) is waiting for your approval: ${approvalTitle(fresh[0])}. Open the Chief terminal to approve or reject.`, { sticky: true });
  }
}

// ─── wiring ───────────────────────────────────────────────

function init(multiTerminalUI) {
  ui = multiTerminalUI;
  manager = ui.manager;

  state.onProjectChange((projectPath) => { if (projectPath) ensure(projectPath); });
  const current = state.getProjectPath && state.getProjectPath();
  if (current) ensure(current);

  // Session in / out of the Chief terminal, from the PTY's foreground process.
  ipcRenderer.on(IPC.TERMINAL_PROCESS_DATA, (event, data) => {
    const c = data && chiefs.get(data.terminalId);
    if (!c) return;
    const atShell = data.processName && data.shellName && data.processName === data.shellName;
    if (!c.running) {
      // Already running when this window found it (a server Chief after a
      // reconnect — its session never stopped): show the session, not Start.
      if (data.processName && !atShell) {
        c.running = true;
        c.seenAgent = true;
        render(data.terminalId);
      }
      return;
    }
    if (!atShell) c.seenAgent = true;
    else if (c.seenAgent) stopped(data.terminalId);
  });

  // The Chief's shell itself ended (e.g. `exit`): the terminal is gone, so
  // open a fresh one — the Chief is never simply gone (spec S5).
  ipcRenderer.on(IPC.TERMINAL_DESTROYED, (event, { terminalId } = {}) => {
    const c = chiefs.get(terminalId);
    if (!c) return;
    chiefs.delete(terminalId);
    // A server Chief that went (server removed or its shell exited) comes
    // back with the next connect / project open; a local one at once.
    if (isServerId(terminalId)) return;
    ipcRenderer.send(IPC.LEAD_STOP, { terminalId });
    setTimeout(() => ensure(c.projectPath), 300);
  });

  // A server came up: once its terminals are adopted, make sure it has its Chief.
  ipcRenderer.on(IPC.SERVER_STATUS_CHANGED, () => {
    clearTimeout(serverTimer);
    serverTimer = setTimeout(() => {
      const p = state.getProjectPath && state.getProjectPath();
      if (p) ensureServers(p);
    }, 2000);
  });

  ipcRenderer.on(IPC.LEAD_APPROVALS, (event, payload) => onApprovals(payload));
}

module.exports = { init, ensure, _chiefs: chiefs };
