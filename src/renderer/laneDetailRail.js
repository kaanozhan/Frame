/**
 * Lane Detail Rail Module
 *
 * Collapsible right-side panel in the terminal detail view listing all the
 * project's lanes, priority-ordered by how much they need the user:
 *
 *   waiting (input needed) → agent (working) → busy (command) → idle
 *
 * Same collapse mechanics as the board's specs/tasks rail: the panel can be
 * hidden to a slim strip and reopened any time; state persists in
 * localStorage. Clicking a lane enters it without going through the board.
 */

const laneStatus = require('./laneStatus');
const { formatRelativeTime, cleanCommand, assignmentIcon, assignmentText } = require('./laneBoard');
const { PanelRightClose, PanelRightOpen, Terminal, Bot } = require('lucide');

const STORAGE_KEY = 'frame-detail-lanes-rail';

const STATUS_PRIORITY = {
  'agent-approval': 0,  // blocked on the user — most urgent
  'agent-input': 1,     // turn done, waiting for the next prompt
  'agent-working': 2,
  'running': 3,
  'idle': 4
};
const STATUS_SHORT = {
  'agent-approval': 'Needs approval',
  'agent-input': 'Awaiting input',
  'agent-working': 'Working',
  'running': 'Running',
  'idle': 'Idle'
};

// Same information as the Mainframe cards, compressed for the rail:
// agents read "claude · Needs approval", commands read "Running · npm run dev".
function itemStatusText(s) {
  if (s.status === 'running') {
    const what = cleanCommand(s.commandLine) || s.foreground;
    return what ? `Running · ${what}` : 'Running';
  }
  if (s.agentName) return `${s.agentName} · ${STATUS_SHORT[s.status]}`;
  return STATUS_SHORT[s.status];
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

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

function isHidden() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').hidden === true;
  } catch {
    return false;
  }
}

function setHidden(hidden) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ hidden }));
  } catch { /* non-fatal */ }
}

/**
 * Render the rail. Called by multiTerminalUI on every detail render;
 * re-renders itself on lane status changes while visible.
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

function _renderInto() {
  const hidden = isHidden();
  container.innerHTML = '';
  container.className = hidden ? 'lane-rail lanes-rail collapsed' : 'lane-rail lanes-rail';

  if (hidden) {
    const strip = document.createElement('div');
    strip.className = 'lane-rail-strip';
    strip.innerHTML = `
      <button class="lane-rail-strip-btn" title="Show frames">${lucideIcon(PanelRightOpen, 15)}</button>
      <button class="lane-rail-strip-btn" title="Frames">${lucideIcon(Terminal, 15)}</button>
    `;
    strip.addEventListener('click', (e) => {
      if (!e.target.closest('.lane-rail-strip-btn')) return;
      setHidden(false);
      _renderInto();
      if (callbacks.onLayoutChange) callbacks.onLayoutChange();
    });
    container.appendChild(strip);
    return;
  }

  const header = document.createElement('div');
  header.className = 'lane-rail-section-header lanes-rail-header';
  header.innerHTML = `
    <span class="lane-rail-section-title">Frames</span>
    <span class="lane-rail-section-count">${lastState.terminals.length}</span>
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

  const sorted = lastState.terminals
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
    if (t.id === lastState.activeTerminalId) item.classList.add('active-lane');
    item.innerHTML = `
      <div class="lane-rail-item-row">
        <span class="lane-status-dot ${s.status}"></span>
        <span class="lane-rail-item-title">${escapeHtml(t.customName || t.name)}</span>
        ${s.agentName ? `<span class="lane-rail-agent-badge" title="Agent frame · ${escapeHtml(s.agentName)}">${lucideIcon(Bot, 10)}<span>Agent</span></span>` : ''}
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
