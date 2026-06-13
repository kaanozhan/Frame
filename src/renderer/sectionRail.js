/**
 * Section Rail Module
 *
 * The collapsible sibling list shown on the right of a task/spec section
 * viewport (taskSection.js / specSection.js). It lets the user flip through
 * siblings of the same type without the Home → reselect → new-tab round-trip:
 * a normal click navigates the current viewport in place, a Cmd/Ctrl-click
 * opens the item in a new viewport tab.
 *
 * By default only active items show; completed/done ones are tucked behind a
 * "hide completed" toggle and, when revealed, grouped under their own label.
 * A header shortcut jumps straight to the full dashboard. Collapse + filter
 * state persist in localStorage per `storageKey` (same mechanics as the board
 * rails).
 */

const { PanelRightClose, PanelRightOpen, ArrowUpRight } = require('lucide');

function lucideIcon(data, size = 14) {
  const children = data.map(([tag, attrs]) => {
    const attrStr = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
    return `<${tag} ${attrStr}/>`;
  }).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;flex-shrink:0">${children}</svg>`;
}

function getState(storageKey) {
  try {
    return Object.assign(
      { hidden: false, hideCompleted: true },
      JSON.parse(localStorage.getItem(storageKey) || '{}')
    );
  } catch {
    return { hidden: false, hideCompleted: true };
  }
}

function setState(storageKey, partial) {
  const next = Object.assign(getState(storageKey), partial);
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch { /* non-fatal */ }
}

function _appendItem(parent, it, onSelect) {
  const item = document.createElement('div');
  item.className = `lane-rail-item lane-rail-card ${it.className || ''}${it.active ? ' section-rail-item-active' : ''}`;
  item.innerHTML = it.html;
  item.title = 'Click to view · Cmd/Ctrl-click for a new tab';
  item.addEventListener('click', (e) => {
    if (onSelect) onSelect(it.id, { newTab: e.metaKey || e.ctrlKey });
  });
  parent.appendChild(item);
}

/**
 * Render the rail into `el`.
 * @param {HTMLElement} el
 * @param {object} opts
 * @param {string} opts.title           Section title ("Tasks" / "Specs")
 * @param {Array}  opts.typeIcon        lucide icon data for the type
 * @param {string} opts.storageKey      localStorage key for collapse/filter state
 * @param {Array}  opts.items           [{ id, active, completed, className, html }]
 * @param {string} [opts.completedLabel='Completed'] group heading for completed items
 * @param {string} opts.emptyText       shown when there are no active items
 * @param {function} opts.onSelect      (id, { newTab }) => void
 * @param {function} [opts.onOpenDashboard]  header shortcut to the full dashboard
 * @param {function} [opts.onToggle]    called after show/hide (e.g. to refit)
 */
function render(el, opts) {
  const {
    title, typeIcon, storageKey, items = [],
    completedLabel = 'Completed', emptyText = '',
    onSelect, onOpenDashboard, onToggle
  } = opts;

  const st = getState(storageKey);
  el.innerHTML = '';
  el.className = st.hidden ? 'lane-rail section-rail collapsed' : 'lane-rail section-rail';

  if (st.hidden) {
    const strip = document.createElement('div');
    strip.className = 'lane-rail-strip';
    strip.innerHTML = `
      <button class="lane-rail-strip-btn" title="Show ${title}">${lucideIcon(PanelRightOpen, 15)}</button>
      <button class="lane-rail-strip-btn" title="${title}">${lucideIcon(typeIcon, 15)}</button>
    `;
    strip.addEventListener('click', (e) => {
      if (!e.target.closest('.lane-rail-strip-btn')) return;
      setState(storageKey, { hidden: false });
      render(el, opts);
      if (onToggle) onToggle();
    });
    el.appendChild(strip);
    return;
  }

  const active = items.filter(it => !it.completed);
  const completed = items.filter(it => it.completed);

  const header = document.createElement('div');
  header.className = 'lane-rail-section-header section-rail-header';
  header.innerHTML = `
    <span class="lane-rail-section-title">${title}</span>
    <span class="lane-rail-section-count">${active.length}</span>
    ${onOpenDashboard ? `<button class="lane-rail-section-open section-rail-dash" title="Open ${title} dashboard">${lucideIcon(ArrowUpRight, 13)}</button>` : ''}
    <button class="lane-rail-toggle" title="Hide panel">${lucideIcon(PanelRightClose, 15)}</button>
  `;
  if (onOpenDashboard) {
    header.querySelector('.section-rail-dash').addEventListener('click', (e) => {
      e.stopPropagation();
      onOpenDashboard();
    });
  }
  header.querySelector('.lane-rail-toggle').addEventListener('click', () => {
    setState(storageKey, { hidden: true });
    render(el, opts);
    if (onToggle) onToggle();
  });
  el.appendChild(header);

  // "Hide completed" filter — only meaningful when completed items exist
  if (completed.length > 0) {
    const filter = document.createElement('label');
    filter.className = 'section-rail-filter';
    filter.innerHTML = `
      <input type="checkbox" ${st.hideCompleted ? 'checked' : ''} />
      <span>Hide ${completedLabel.toLowerCase()}</span>
    `;
    filter.querySelector('input').addEventListener('change', (e) => {
      setState(storageKey, { hideCompleted: e.target.checked });
      render(el, opts);
    });
    el.appendChild(filter);
  }

  const body = document.createElement('div');
  body.className = 'lane-rail-section-body section-rail-body';

  if (active.length === 0 && (st.hideCompleted || completed.length === 0)) {
    body.innerHTML = `<div class="lane-rail-empty">${emptyText}</div>`;
    el.appendChild(body);
    return;
  }

  active.forEach(it => _appendItem(body, it, onSelect));

  if (!st.hideCompleted && completed.length > 0) {
    const group = document.createElement('div');
    group.className = 'section-rail-group';
    group.textContent = `${completedLabel} (${completed.length})`;
    body.appendChild(group);
    completed.forEach(it => _appendItem(body, it, onSelect));
  }

  el.appendChild(body);
}

module.exports = { render };
