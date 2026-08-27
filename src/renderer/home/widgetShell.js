/**
 * Widget Shell — the one card every Home widget is drawn inside.
 *
 * Extracted verbatim in structure from `LaneBoard._card()`, so the board's
 * three cards keep the markup and the CSS they already had: a header that
 * opens the full surface, a body the widget patches, and a footer action.
 *
 * Both the header and the footer are optional. A widget whose title is not a
 * doorway (nothing behind it to open) gets a plain header instead of a
 * button, and one with no single obvious action gets no footer at all —
 * neither case should have to fake an `onOpen` to use the shell.
 */

const { Plus, ArrowUpRight } = require('lucide');

// Local, like every other renderer module's copy — six of them exist and the
// duplication is the project's idiom for keeping lucide out of the seams.
function lucideIcon(data, size = 14) {
  const children = data.map(([tag, attrs]) => {
    const attrStr = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
    return `<${tag} ${attrStr}/>`;
  }).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;flex-shrink:0">${children}</svg>`;
}

/**
 * Build one widget's card.
 *
 * @param {Object}   opts
 * @param {string}   opts.id            - the widget's stable id; becomes `home-card-<id>`
 * @param {Array}    opts.icon          - a lucide icon
 * @param {string}   opts.title
 * @param {string}   [opts.actionLabel] - omit for a card with no footer action
 * @param {Array}    [opts.actionIcon]
 * @param {Function} [opts.onOpen]      - omit for a header that is not a doorway
 * @param {Function} [opts.onAction]
 * @param {Function} [opts.onActionContext]
 * @returns {{el: HTMLElement, count: HTMLElement, body: HTMLElement, action: HTMLElement|null}}
 */
function widgetShell({ id, icon, title, actionLabel, actionIcon = Plus, onOpen, onAction, onActionContext }) {
  const el = document.createElement('div');
  el.className = `home-card home-card-${id}`;

  const headerTag = onOpen ? 'button' : 'div';
  el.innerHTML = `
    <${headerTag} class="home-card-header"${onOpen ? ' type="button"' : ''}>
      <span class="home-card-icon">${lucideIcon(icon, 15)}</span>
      <span class="home-card-title">${title}</span>
      <span class="home-card-count"></span>
      ${onOpen ? `<span class="home-card-open">${lucideIcon(ArrowUpRight, 13)}</span>` : ''}
    </${headerTag}>
    <div class="home-card-body"></div>
    ${actionLabel ? `<button class="home-card-action" type="button">${lucideIcon(actionIcon, 13)}<span>${actionLabel}</span></button>` : ''}
  `;

  if (onOpen) el.querySelector('.home-card-header').addEventListener('click', onOpen);

  const action = el.querySelector('.home-card-action');
  if (action && onAction) {
    action.addEventListener('click', (e) => { e.stopPropagation(); onAction(); });
    if (onActionContext) {
      action.addEventListener('contextmenu', (e) => { e.preventDefault(); onActionContext(e); });
    }
  }

  return {
    el,
    count: el.querySelector('.home-card-count'),
    body: el.querySelector('.home-card-body'),
    action
  };
}

module.exports = { widgetShell, lucideIcon };
