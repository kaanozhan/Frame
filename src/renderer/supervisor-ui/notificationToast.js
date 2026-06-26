// Supervisor in-renderer toast — Phase R.
//
// Lightweight bottom-right stack used for non-OS-notification signals
// (currently: a task transitioning to in_flight, and a task completing).
// OS notifications stay in notifier.js for things worth a system popup
// (failures, escalations, daemon stale) — toasts are for the quieter
// "your task is moving" lifecycle events that would be too noisy as OS
// pings but invisible without any UI feedback at all.
//
// Click → invokes onClick(payload) so the caller can route to the task
// modal. Cards auto-dismiss after 4s, or on click. The stack lives at
// document.body so it surfaces regardless of which Frame tab is active.

const KIND_LABEL = {
  started: 'started',
  done: 'done',
};

let _root = null;
let _onClick = null;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function ensureRoot() {
  if (_root && _root.isConnected) return _root;
  _root = document.createElement('div');
  _root.className = 'sup-toast-stack';
  document.body.appendChild(_root);
  return _root;
}

function setClickHandler(fn) {
  _onClick = typeof fn === 'function' ? fn : null;
}

function show(payload) {
  if (!payload) return;
  const { title, kind, taskId, body } = payload;
  const root = ensureRoot();
  const card = document.createElement('div');
  card.className = `sup-toast sup-toast-${esc(kind || 'info')}`;
  card.innerHTML = `
    <div class="sup-toast-kind">${esc(KIND_LABEL[kind] || kind || '')}</div>
    <div class="sup-toast-title">${esc(title || '')}</div>
    ${body ? `<div class="sup-toast-body">${esc(body)}</div>` : ''}
  `;
  let dismissed = false;
  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    card.classList.add('leaving');
    setTimeout(() => { try { card.remove(); } catch {} }, 220);
  }
  card.addEventListener('click', () => {
    if (_onClick && taskId) {
      try { _onClick({ taskId, kind }); } catch (err) {
        console.warn('[supervisor-toast] click handler threw:', err);
      }
    }
    dismiss();
  });
  root.appendChild(card);
  // Force layout so the enter transition runs.
  // eslint-disable-next-line no-unused-expressions
  card.offsetHeight;
  card.classList.add('entered');
  setTimeout(dismiss, 4000);
}

function clearAll() {
  if (!_root) return;
  while (_root.firstChild) _root.removeChild(_root.firstChild);
}

module.exports = { show, setClickHandler, clearAll };
