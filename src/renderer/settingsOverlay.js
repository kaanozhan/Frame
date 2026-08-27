/**
 * Settings Overlay Plumbing
 *
 * Frame has two settings surfaces — the open project's, and Frame's own —
 * and they are the same box with different contents. This is that box:
 * backdrop click, the × in the header and Escape all close it, and opening
 * re-reads the values so a panel never shows a state the disk has moved
 * past.
 *
 * Each surface owns its own module (projectSettingsModal, frameSettingsModal)
 * and asks for one of these; nothing here knows what is inside the dialog.
 */

// Every overlay created, so opening one can close the others. The buttons are
// behind the backdrop while a dialog is up, but Cmd+, is not — and two
// settings dialogs stacked is a state the user has to back out of twice.
const overlays = [];

/**
 * @param {string} overlayId - id of the `.settings-overlay` element
 * @param {Function} [onOpen] - re-read values from disk before showing
 * @returns {{open, close, toggle, isOpen: () => boolean}|null}
 */
function create(overlayId, onOpen) {
  const overlayEl = document.getElementById(overlayId);
  if (!overlayEl) {
    // A settings surface that silently fails to bind is one the user finds
    // by clicking a dead button (audit-q3-ux-error-feedback discipline).
    console.error(`settingsOverlay: #${overlayId} not found — that settings surface will not open`);
    return null;
  }

  let open_ = false;

  const close = () => {
    if (!open_) return;
    open_ = false;
    overlayEl.classList.remove('visible');
    if (typeof window.terminalFocus === 'function') window.terminalFocus();
  };

  const open = () => {
    if (open_) return;
    overlays.forEach((other) => { if (other !== api) other.close(); });
    open_ = true;
    if (onOpen) onOpen();
    overlayEl.classList.add('visible');
  };

  const api = { open, close, toggle: () => (open_ ? close() : open()), isOpen: () => open_ };

  overlayEl.addEventListener('mousedown', (e) => {
    if (e.target === overlayEl) close();
  });

  // Scoped to this overlay: the other dialog's × must not close this one.
  overlayEl.querySelectorAll('[data-settings-close]').forEach((btn) => {
    btn.addEventListener('click', close);
  });

  document.addEventListener('keydown', (e) => {
    if (open_ && e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });

  overlays.push(api);
  return api;
}

module.exports = { create };
