/**
 * Tooltip
 *
 * One styled hover tooltip for icon-only controls, in place of the native
 * `title` bubble — which is slow to appear, unstyled, and lost inside
 * Electron on some platforms. A single element serves every control: it is
 * positioned next to the hovered one and hidden again on leave, blur or
 * click (the click opens something, and the label would sit on top of it).
 *
 * Usage: `tooltip.attach(el, 'Label', { placement: 'right' })`. The label
 * also becomes the control's aria-label when it has none, so the same text
 * reaches screen readers; the native `title` is removed so the two bubbles
 * never stack.
 */

const SHOW_DELAY_MS = 350;
const GAP_PX = 8;

let tipEl = null;
let showTimer = null;
let current = null;

function _el() {
  if (tipEl) return tipEl;
  tipEl = document.createElement('div');
  tipEl.className = 'ui-tooltip';
  tipEl.setAttribute('role', 'tooltip');
  document.body.appendChild(tipEl);
  return tipEl;
}

function _place(target, placement) {
  const tip = _el();
  const r = target.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  let top;
  let left;
  if (placement === 'right') {
    top = r.top + (r.height - t.height) / 2;
    left = r.right + GAP_PX;
  } else if (placement === 'bottom') {
    top = r.bottom + GAP_PX;
    left = r.left + (r.width - t.width) / 2;
  } else {
    // 'top' — the default; the status bar sits on the floor of the window.
    top = r.top - t.height - GAP_PX;
    left = r.left + (r.width - t.width) / 2;
  }
  // Keep it inside the viewport: a control at the window's edge must not
  // push its label off screen.
  const maxLeft = window.innerWidth - t.width - GAP_PX;
  const maxTop = window.innerHeight - t.height - GAP_PX;
  tip.style.left = `${Math.max(GAP_PX, Math.min(left, maxLeft))}px`;
  tip.style.top = `${Math.max(GAP_PX, Math.min(top, maxTop))}px`;
}

function show(target, text, placement, variant) {
  const tip = _el();
  tip.textContent = text;
  tip.dataset.placement = placement;
  tip.classList.toggle('ui-tooltip-note', variant === 'note');
  tip.classList.add('visible');
  _place(target, placement);
  current = target;
}

function hide() {
  clearTimeout(showTimer);
  showTimer = null;
  current = null;
  if (tipEl) tipEl.classList.remove('visible');
}

/**
 * @param {HTMLElement} el
 * @param {string} text
 * @param {{ placement?: 'top' | 'right' | 'bottom', variant?: 'note' }} [opts]
 *   variant 'note': a sentence or two that wraps, shown above modals too.
 */
function attach(el, text, opts = {}) {
  if (!el || !text) return;
  const placement = opts.placement || 'top';
  const variant = opts.variant || '';
  el.removeAttribute('title');
  if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', text);

  const schedule = () => {
    clearTimeout(showTimer);
    showTimer = setTimeout(() => show(el, text, placement, variant), SHOW_DELAY_MS);
  };
  el.addEventListener('mouseenter', schedule);
  el.addEventListener('focus', schedule);
  el.addEventListener('mouseleave', hide);
  el.addEventListener('blur', hide);
  el.addEventListener('mousedown', hide);
}

/** Drop the label whenever the hovered control leaves the page or scrolls away. */
function init() {
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
}

module.exports = { init, attach, hide, get current() { return current; } };
