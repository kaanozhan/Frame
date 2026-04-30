/**
 * Task Confirm-Delete Modal
 *
 * One small confirmation dialog shared between the tasks side panel (✕ on a
 * row) and the dashboard detail aside (Delete button on a selected card).
 * Centralized so both entry points share copy, styling, and the same
 * "Are you sure?" guard before any DELETE_TASK is dispatched.
 */

let modalEl = null;
let messageEl = null;
let cancelBtn = null;
let deleteBtn = null;
let activeOnConfirm = null;
let activeOnCancel = null;
let initialized = false;

function init() {
  if (initialized) return;
  modalEl = document.getElementById('task-confirm-delete-modal');
  if (!modalEl) return;
  messageEl = document.getElementById('task-confirm-delete-message');
  cancelBtn = document.getElementById('task-confirm-cancel');
  deleteBtn = document.getElementById('task-confirm-delete');

  cancelBtn.addEventListener('click', cancel);
  deleteBtn.addEventListener('click', confirm);

  // Backdrop click cancels
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) cancel();
  });

  // Esc cancels (capture phase to beat the dashboard's Esc handler)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!modalEl.classList.contains('visible')) return;
    e.stopPropagation();
    cancel();
  }, true);

  // Enter triggers Delete (matches the focused button)
  modalEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && modalEl.classList.contains('visible')) {
      e.preventDefault();
      confirm();
    }
  });

  initialized = true;
}

/**
 * Open the modal.
 * @param {object} opts
 * @param {string} [opts.title]   - Optional task title; appears in the message.
 * @param {function} opts.onConfirm - Called when user confirms delete.
 * @param {function} [opts.onCancel] - Optional cancel callback.
 */
function open(opts = {}) {
  if (!initialized) init();
  if (!modalEl) return;

  activeOnConfirm = typeof opts.onConfirm === 'function' ? opts.onConfirm : null;
  activeOnCancel = typeof opts.onCancel === 'function' ? opts.onCancel : null;

  if (messageEl) {
    if (opts.title) {
      messageEl.innerHTML = `&ldquo;<strong></strong>&rdquo; will be removed permanently. This action can't be undone.`;
      messageEl.querySelector('strong').textContent = opts.title;
    } else {
      messageEl.textContent = "This task will be removed permanently. This action can't be undone.";
    }
  }

  modalEl.classList.add('visible');
  // Focus the delete button so Enter confirms and the destructive action is
  // clearly the active default in the dialog.
  requestAnimationFrame(() => deleteBtn && deleteBtn.focus());
}

function close() {
  if (!modalEl) return;
  modalEl.classList.remove('visible');
  activeOnConfirm = null;
  activeOnCancel = null;
}

function confirm() {
  const cb = activeOnConfirm;
  close();
  if (cb) cb();
}

function cancel() {
  const cb = activeOnCancel;
  close();
  if (cb) cb();
}

module.exports = {
  init,
  open
};
