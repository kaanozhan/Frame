/**
 * Task Info Modal
 *
 * Lightweight informational dialog used when an action can't proceed but the
 * user still needs an explanation — e.g. "no project selected" when they hit
 * the Tasks button without picking a project first. Single OK button, no
 * destructive intent.
 */

let modalEl = null;
let titleEl = null;
let messageEl = null;
let okBtn = null;
let initialized = false;

function init() {
  if (initialized) return;
  modalEl = document.getElementById('task-info-modal');
  if (!modalEl) return;
  titleEl = document.getElementById('task-info-modal-title');
  messageEl = document.getElementById('task-info-modal-message');
  okBtn = document.getElementById('task-info-modal-ok');

  okBtn.addEventListener('click', close);
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!modalEl.classList.contains('visible')) return;
    e.stopPropagation();
    close();
  }, true);

  initialized = true;
}

/**
 * @param {object} [opts]
 * @param {string} [opts.title]   - Optional override title.
 * @param {string} [opts.message] - Optional override body.
 */
function open(opts = {}) {
  if (!initialized) init();
  if (!modalEl) return;

  if (titleEl && opts.title) titleEl.textContent = opts.title;
  if (messageEl && opts.message) messageEl.textContent = opts.message;

  modalEl.classList.add('visible');
  requestAnimationFrame(() => okBtn && okBtn.focus());
}

function close() {
  if (!modalEl) return;
  modalEl.classList.remove('visible');
}

module.exports = {
  init,
  open
};
