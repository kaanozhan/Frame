/**
 * "Remove from the top bar" notice.
 *
 * The × on a terminal's breadcrumb chip drops that chip from the top bar and
 * does nothing else — the terminal keeps running, and Terminals still holds
 * it. An × sitting next to a terminal's name does not say that on its own, so
 * until the user says they have got it, this explains itself before acting:
 * where the terminal went, and which × is the one that actually closes it.
 *
 * The bar is a breadcrumb, not a tab strip, so this is the only place the
 * distinction has to be taught. "Don't show this again" is remembered in
 * localStorage (the same store the bar's other chrome preferences use); after
 * that the × drops the chip silently.
 */

const SUPPRESS_KEY = 'frame-terminal-chip-notice-off';

let modalEl = null;
let titleEl = null;
let bodyEl = null;
let checkboxEl = null;
let cancelBtn = null;
let removeBtn = null;
let pending = null;   // the onConfirm of the open dialog

function _suppressed() {
  try {
    return localStorage.getItem(SUPPRESS_KEY) === '1';
  } catch (_) {
    return false;
  }
}

function _persistSuppression() {
  if (!checkboxEl || !checkboxEl.checked) return;
  try {
    localStorage.setItem(SUPPRESS_KEY, '1');
  } catch (err) {
    console.error('Terminal chip notice: failed to persist preference', err);
  }
}

function _build() {
  if (modalEl) return;

  modalEl = document.createElement('div');
  modalEl.className = 'tcn-modal';
  modalEl.innerHTML = `
    <div class="tcn-container" role="dialog" aria-modal="true" aria-labelledby="tcn-title">
      <h3 class="tcn-title" id="tcn-title">Remove from the top bar?</h3>
      <p class="tcn-body"></p>
      <label class="tcn-check">
        <input type="checkbox" />
        <span>Don't show this again</span>
      </label>
      <div class="tcn-footer">
        <button type="button" class="tcn-cancel">Cancel</button>
        <button type="button" class="tcn-remove">Remove from bar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modalEl);

  titleEl = modalEl.querySelector('.tcn-title');
  bodyEl = modalEl.querySelector('.tcn-body');
  checkboxEl = modalEl.querySelector('.tcn-check input');
  cancelBtn = modalEl.querySelector('.tcn-cancel');
  removeBtn = modalEl.querySelector('.tcn-remove');

  cancelBtn.addEventListener('click', _cancel);
  removeBtn.addEventListener('click', _accept);
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) _cancel();
  });

  // Esc cancels. Capture, so a surface underneath with its own Esc handler
  // (the dashboards) does not act on a key that was meant for this dialog.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !modalEl.classList.contains('visible')) return;
    e.stopPropagation();
    _cancel();
  }, true);

  // Nothing here is destructive, so Enter does the thing the user asked for.
  modalEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (document.activeElement === cancelBtn) _cancel();
    else _accept();
  });
}

function _close() {
  pending = null;
  if (modalEl) modalEl.classList.remove('visible');
}

function _cancel() {
  // The checkbox is a preference about this dialog, not about this answer —
  // ticking it and backing out still means "stop asking me".
  _persistSuppression();
  _close();
}

function _accept() {
  const go = pending;
  _persistSuppression();
  _close();
  if (go) go();
}

/**
 * Drop a chip, explaining what that means unless the user opted out.
 *
 * @param {object} opts
 * @param {string} opts.name        - the terminal's display name
 * @param {Function} opts.onConfirm - run when the user goes ahead
 */
function confirmRemoval({ name, onConfirm }) {
  if (typeof onConfirm !== 'function') return;
  if (_suppressed()) {
    onConfirm();
    return;
  }

  _build();
  if (!modalEl) {           // no DOM to build into — never block the action
    onConfirm();
    return;
  }

  pending = onConfirm;
  checkboxEl.checked = false;
  bodyEl.textContent = '';
  const who = document.createElement('strong');
  who.textContent = name || 'This terminal';
  bodyEl.appendChild(who);
  bodyEl.append(
    ' keeps running — this only takes it out of the top bar. It is still in '
    + 'Terminals, and going back to it there puts the chip back. To close the '
    + 'terminal for good, use the × on its pane in Terminals.'
  );

  modalEl.classList.add('visible');
  requestAnimationFrame(() => removeBtn && removeBtn.focus());
}

module.exports = { confirmRemoval };
