/**
 * Other Terminals Rail Module
 *
 * The right-side panel of the Terminals section's enlarged body: every
 * terminal in the project **except the one on screen**, priority-ordered by
 * how much each needs the user:
 *
 *   waiting (input needed) → agent (working) → busy (command) → idle
 *
 * The rule that keeps it distinct from the top bar's breadcrumb chips: **the
 * chips are navigation, this rail is state.** The chips say which terminals
 * exist and carry a status dot; the rail says what each one is doing and in
 * what order it needs you. It is therefore not agents-only — listing only
 * agents would leave no path to a plain shell from here.
 *
 * It is **closed by default** (D13): looking at one terminal, the screen
 * belongs to that terminal. A control at the edge appears on hover to open it
 * and the open/closed state is remembered in localStorage. Closed it is quiet
 * but not blind — an agent waiting on approval or input shows in the slim
 * strip as an attention mark and an agent marker. Running and idle terminals
 * never appear there.
 */

const laneStatus = require('./laneStatus');
const { statusLabel, attentionMark, formatRelativeTime, assignmentIcon, assignmentText } = laneStatus;
const { PanelRightClose, PanelRightOpen, Bot, Plus } = require('lucide');
const { escapeHtml } = require('./htmlUtils');

const STORAGE_KEY = 'frame-other-terminals-rail';

// The only two statuses that are waiting on the user, and the only ones the
// collapsed strip is allowed to show.
const ATTENTION_STATUSES = new Set(['agent-approval', 'agent-input']);

const STATUS_PRIORITY = {
  'agent-approval': 0,  // blocked on the user — most urgent
  'agent-input': 1,     // turn done, waiting for the next prompt
  'agent-working': 2,
  'running': 3,
  'idle': 4
};

// Same information as the Home cards, compressed for the rail: agents read
// "claude · Needs approval", commands read "Running · npm run dev". The words
// come from laneStatus — the rail picks the short variant, nothing more.
function itemStatusText(s) {
  return statusLabel(s.status, {
    agentName: s.agentName,
    foreground: s.foreground,
    commandLine: s.commandLine,
    short: true
  });
}

let container = null;
let lastState = null;
let callbacks = {};
let subscribed = false;

function lucideIcon(data, size = 14) {
  const children = data.map(([tag, attrs]) => {
    const attrStr = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
    return `<${tag} ${attrStr}/>`;
  }).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;flex-shrink:0">${children}</svg>`;
}

// Closed by default, and closed again whenever the stored value cannot be
// read — the quiet state is the safe one to fall back to.
function isHidden() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').hidden !== false;
  } catch {
    return true;
  }
}

function setHidden(hidden) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ hidden }));
  } catch { /* non-fatal */ }
}

/**
 * Render the rail. Called by terminalsView on every single-terminal render;
 * re-renders itself on status changes while visible.
 *
 * @param {HTMLElement} el
 * @param {{terminals: Array, currentId: string}} state - the project's
 *   terminals and the one currently on screen (which the rail leaves out).
 * @param {Object} cbs - onEnterLane, onNewLane, onLayoutChange
 */
function render(el, state, cbs) {
  container = el;
  lastState = state;
  callbacks = cbs || {};

  if (!subscribed) {
    subscribed = true;
    laneStatus.onChange(() => {
      if (container && container.isConnected && lastState) {
        _renderInto();
      }
    });
  }

  _renderInto();
}

/** The project's terminals minus the one filling the body. */
function _others() {
  return lastState.terminals.filter(t => t.id !== lastState.currentId);
}

function _open() {
  setHidden(false);
  _renderInto();
  if (callbacks.onLayoutChange) callbacks.onLayoutChange();
}

function _renderInto() {
  const others = _others();
  const hidden = isHidden();
  container.innerHTML = '';

  // Nothing to be blind to — the rail has no reason to exist.
  if (others.length === 0) {
    container.className = '';
    return;
  }

  container.className = hidden ? 'lane-rail lanes-rail collapsed' : 'lane-rail lanes-rail';

  if (hidden) {
    // Quiet but not blind: the open control appears on hover (CSS), and only
    // terminals actually waiting on the user get a mark.
    const strip = document.createElement('div');
    strip.className = 'lane-rail-strip';

    const openBtn = document.createElement('button');
    openBtn.className = 'lane-rail-strip-btn otr-open';
    openBtn.title = 'Show the other terminals';
    openBtn.innerHTML = lucideIcon(PanelRightOpen, 15);
    openBtn.addEventListener('click', _open);
    strip.appendChild(openBtn);

    others
      .map(t => ({ t, s: laneStatus.getStatus(t.id) }))
      .filter(({ s }) => ATTENTION_STATUSES.has(s.status))
      .forEach(({ t, s }) => {
        const mark = document.createElement('button');
        mark.className = `lane-rail-strip-btn otr-waiting ${s.status}`;
        mark.title = `${t.customName || t.name} — ${statusLabel(s.status, { agentName: s.agentName, short: true })}`;
        mark.innerHTML = `<span class="otr-waiting-mark">${attentionMark(s.status)}</span>${lucideIcon(Bot, 13)}`;
        mark.addEventListener('click', () => {
          if (callbacks.onEnterLane) callbacks.onEnterLane(t.id);
        });
        strip.appendChild(mark);
      });

    container.appendChild(strip);
    return;
  }

  const header = document.createElement('div');
  header.className = 'lane-rail-section-header lanes-rail-header';
  header.innerHTML = `
    <span class="lane-rail-section-title">Other terminals</span>
    <span class="lane-rail-section-count">${others.length}</span>
    <button class="lane-rail-toggle" title="Hide panel">${lucideIcon(PanelRightClose, 15)}</button>
  `;
  header.querySelector('.lane-rail-toggle').addEventListener('click', () => {
    setHidden(true);
    _renderInto();
    if (callbacks.onLayoutChange) callbacks.onLayoutChange();
  });
  container.appendChild(header);

  const body = document.createElement('div');
  body.className = 'lane-rail-section-body lanes-rail-body';

  const sorted = others
    .map((t) => ({ t, s: laneStatus.getStatus(t.id) }))
    .sort((a, b) => {
      const pa = STATUS_PRIORITY[a.s.status] ?? 4;
      const pb = STATUS_PRIORITY[b.s.status] ?? 4;
      if (pa !== pb) return pa - pb;
      return (b.s.lastActivityAt || 0) - (a.s.lastActivityAt || 0);
    });

  sorted.forEach(({ t, s }) => {
    const item = document.createElement('div');
    item.className = 'lane-rail-item lane-detail-item';
    item.innerHTML = `
      <div class="lane-rail-item-row">
        <span class="lane-status-dot ${s.status}"></span>
        <span class="lane-rail-item-title">${escapeHtml(t.customName || t.name)}</span>
        ${s.agentName ? `<span class="lane-rail-agent-badge" title="Agent · ${escapeHtml(s.agentName)}">${lucideIcon(Bot, 10)}<span>Agent</span></span>` : ''}
      </div>
      <div class="lane-rail-item-row">
        <span class="lane-detail-item-status ${s.status}" title="${escapeHtml(s.commandLine || '')}">${escapeHtml(itemStatusText(s))}</span>
        <span class="lane-detail-item-time" data-ts="${s.lastActivityAt || ''}">${formatRelativeTime(s.lastActivityAt)}</span>
      </div>
      ${t.assignment ? `
      <div class="lane-rail-item-row">
        <span class="lane-assignment-chip${s.agentName ? '' : ' dimmed'}" title="${escapeHtml(t.assignment.label)}">
          ${lucideIcon(assignmentIcon(t.assignment), 10)}<span class="lane-assignment-chip-label">${escapeHtml(assignmentText(t.assignment))}</span>
        </span>
      </div>` : ''}
    `;
    item.addEventListener('click', () => {
      if (callbacks.onEnterLane) callbacks.onEnterLane(t.id);
    });
    body.appendChild(item);
  });

  container.appendChild(body);

  // New terminal — the top-bar "+" is retired; creating one lives here, next
  // to the list it adds to.
  const addBtn = document.createElement('button');
  addBtn.className = 'lane-rail-add-btn';
  addBtn.title = 'New Terminal';
  addBtn.innerHTML = `${lucideIcon(Plus, 14)}<span>Add new Terminal</span>`;
  addBtn.addEventListener('click', () => {
    if (callbacks.onNewLane) callbacks.onNewLane();
  });
  container.appendChild(addBtn);

  _startTicker();
}

// Keep the relative times fresh while the rail is on screen
let ticker = null;
function _startTicker() {
  if (ticker) clearInterval(ticker);
  ticker = setInterval(() => {
    if (!container || !container.isConnected) {
      clearInterval(ticker);
      ticker = null;
      return;
    }
    container.querySelectorAll('.lane-detail-item-time').forEach((el) => {
      const ts = el.dataset.ts ? Number(el.dataset.ts) : null;
      el.textContent = formatRelativeTime(ts);
    });
  }, 30000);
}

module.exports = { render };
