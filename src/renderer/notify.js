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
 *
 * `{ action: { label, onClick } }` adds one button after the message — for a
 * notice the user may want to act on from wherever they are (a Shape that
 * landed while they sat in its lane: Open brief). Clicking it runs `onClick`
 * and dismisses the toast; a toast with an action stays ACTION_MS, long
 * enough to reach the button.
 *
 * `{ visibleMs }` overrides how long a non-sticky toast stays — for an action
 * that stops meaning anything after a fixed time: the Briefs view's Undo on a
 * held move to Done lives exactly as long as the hold
 * (frame-cloud-brief-manual-done D18). A later toast still replaces it.
 */

const VISIBLE_ERROR_MS = 4000;
const VISIBLE_DEFAULT_MS = 2000;
const VISIBLE_ACTION_MS = 6000;
const FADE_MS = 300;

const ICONS = {
  success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
  error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
};

function show(message, type = 'info', { sticky = false, action = null, visibleMs = null } = {}) {
  const existing = document.querySelector('.app-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  const hasAction = Boolean(action && action.label && typeof action.onClick === 'function');
  toast.className = `app-toast app-toast-${type}${sticky ? ' app-toast-sticky' : ''}${hasAction ? ' app-toast-has-action' : ''}`;

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

  if (hasAction) {
    const button = document.createElement('button');
    button.className = 'toast-action';
    button.type = 'button';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      dismiss();
      action.onClick();
    });
    toast.appendChild(button);
  }

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

  const defaultMs = hasAction ? VISIBLE_ACTION_MS : type === 'error' ? VISIBLE_ERROR_MS : VISIBLE_DEFAULT_MS;
  setTimeout(dismiss, Number.isFinite(visibleMs) && visibleMs > 0 ? visibleMs : defaultMs);
}

module.exports = {
  error: (message, options) => show(message, 'error', options),
  success: (message, options) => show(message, 'success', options),
  info: (message, options) => show(message, 'info', options)
};
