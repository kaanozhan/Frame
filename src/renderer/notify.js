/**
 * Notify
 *
 * The renderer's single toast layer: notify.error / success / info.
 * Every module that needs to surface a message to the user requires this —
 * do not add per-panel showToast copies (this file replaced four of them).
 *
 * Behavior (carried over from the old tasksPanel toast, the designated
 * baseline): mounted on document.body so it lives in the viewport's
 * coordinate space, one toast at a time (a new call replaces the visible
 * one), errors stay 4000 ms because they require user attention, everything
 * else 2000 ms. The message is set via textContent, never innerHTML, so
 * user-provided text can't inject markup.
 *
 * `{ sticky: true }` opts a message out of the auto-hide and gives it a
 * close button — for warnings that carry detail worth reading, which the
 * four-second fade made unreadable (resize-storm-watchdog spec). Use it
 * sparingly: a toast that never leaves on its own is the user's problem
 * until they click it.
 */

const VISIBLE_ERROR_MS = 4000;
const VISIBLE_DEFAULT_MS = 2000;
const FADE_MS = 300;

const ICONS = {
  success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
  error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
};

function show(message, type = 'info', { sticky = false } = {}) {
  const existing = document.querySelector('.app-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `app-toast app-toast-${type}${sticky ? ' app-toast-sticky' : ''}`;

  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.innerHTML = ICONS[type] || ICONS.info;

  const text = document.createElement('span');
  text.className = 'toast-message';
  text.textContent = message;

  toast.appendChild(icon);
  toast.appendChild(text);

  const dismiss = () => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), FADE_MS);
  };

  if (sticky) {
    const close = document.createElement('button');
    close.className = 'toast-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '×';
    close.addEventListener('click', dismiss);
    toast.appendChild(close);
  }

  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('visible');
  });

  if (sticky) return;

  const visibleMs = type === 'error' ? VISIBLE_ERROR_MS : VISIBLE_DEFAULT_MS;
  setTimeout(dismiss, visibleMs);
}

module.exports = {
  error: (message, options) => show(message, 'error', options),
  success: (message, options) => show(message, 'success', options),
  info: (message, options) => show(message, 'info', options)
};
