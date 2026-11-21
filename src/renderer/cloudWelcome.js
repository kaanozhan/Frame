/**
 * Frame Cloud — the tour beside the sign-in (frame-cloud-header-entry spec).
 *
 * The left half of the Frame Cloud modal while signed out and through every
 * sign-in step: five steps, each one idea with a small example, moved through
 * with Back, Next and the step dots. This module is the DOM host only; the
 * words, the sample data and the stepping rules live in `cloudTour.js`.
 *
 * It only ever touches `#cloud-pitch`. The sign-in card is a sibling, so a
 * step change cannot disturb its pane, a typed email or its focus. The
 * skeleton is built once and the nav buttons are never replaced, so focus
 * stays on the button that was pressed. Every string is written with
 * textContent; the examples are static and read no cloud state.
 */

const tour = require('./cloudTour');

const LOCK_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

// The skeleton's live parts, set by render().
let refs = null;
let at = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function toneClass(tone) {
  return tour.TONES.includes(tone) ? ` cloud-tour-tone-${tone}` : '';
}

// ─── Examples: one builder per kind ───────────────────────────

function buildFeatures(example) {
  const grid = el('div', 'cloud-tour-features');
  for (const item of example.items) {
    const feature = el('div', 'cloud-tour-feature');
    feature.appendChild(el('b', '', item.title));
    feature.appendChild(el('span', '', item.text));
    grid.appendChild(feature);
  }
  return grid;
}

function buildPartsList(parts) {
  const list = el('ul', 'cloud-tour-card-parts');
  for (const part of parts) {
    const item = el('li');
    item.appendChild(el('i', `cloud-tour-dot${toneClass(part.tone)}`));
    item.appendChild(el('span', 'cloud-tour-part-label', part.label));
    item.appendChild(el('span', `cloud-tour-part-status${toneClass(part.tone)}`, part.status));
    list.appendChild(item);
  }
  return list;
}

function buildCard(card) {
  const node = el('div', 'cloud-tour-card');
  const top = el('div', 'cloud-tour-card-top');
  top.appendChild(el('span', '', `#${card.number}`));
  const kind = el('span', 'cloud-tour-kind', card.kind);
  kind.dataset.kind = String(card.kind).toLowerCase();
  top.appendChild(kind);
  node.appendChild(top);
  node.appendChild(el('div', 'cloud-tour-card-title', card.title));
  if (Array.isArray(card.parts) && card.parts.length) node.appendChild(buildPartsList(card.parts));
  node.appendChild(el('div', `cloud-tour-card-foot${toneClass(card.tone)}`, card.foot));
  return node;
}

function buildBoard(example) {
  const board = el('div', 'cloud-tour-panel cloud-tour-board');

  const milestone = el('div', 'cloud-tour-milestone');
  milestone.appendChild(el('b', '', example.milestone.name));
  milestone.appendChild(el('span', '', example.milestone.due));
  const track = el('span', 'cloud-tour-track');
  const fill = el('i');
  const ratio = Math.min(Math.max(Number(example.milestone.ratio) || 0, 0), 1);
  fill.style.width = `${Math.round(ratio * 100)}%`;
  track.appendChild(fill);
  milestone.appendChild(track);
  milestone.appendChild(el('span', '', example.milestone.progress));
  board.appendChild(milestone);

  const columns = el('div', 'cloud-tour-columns');
  for (const column of example.columns) {
    const col = el('div', 'cloud-tour-column');
    // The column whose card lists its parts gets the room.
    if (column.cards.some((card) => Array.isArray(card.parts) && card.parts.length)) {
      col.classList.add('cloud-tour-column-wide');
    }
    col.appendChild(el('span', 'cloud-tour-column-name', column.name));
    for (const card of column.cards) col.appendChild(buildCard(card));
    columns.appendChild(col);
  }
  board.appendChild(columns);
  return board;
}

function buildLane(example) {
  const lane = el('div', 'cloud-tour-panel cloud-tour-lane');
  lane.appendChild(el('span', 'cloud-tour-chip', example.chip));
  for (const line of example.lines) {
    const say = el('p', 'cloud-tour-say');
    say.appendChild(el('b', '', line.who));
    say.appendChild(document.createTextNode(` · ${line.text}`));
    lane.appendChild(say);
  }
  const record = el('div', 'cloud-tour-record');
  record.appendChild(el('span', '', example.record.title));
  record.appendChild(el('small', '', example.record.text));
  lane.appendChild(record);
  if (example.action) lane.appendChild(el('span', 'cloud-tour-action', example.action));
  return lane;
}

function buildParts(example) {
  const lane = el('div', 'cloud-tour-panel cloud-tour-lane');
  lane.appendChild(el('span', 'cloud-tour-chip', example.chip));
  for (const row of example.rows) {
    const node = el('div', 'cloud-tour-row');
    node.appendChild(el('span', 'cloud-tour-row-label', row.label));
    node.appendChild(el('span', `cloud-tour-row-status${toneClass(row.tone)}`, row.status));
    lane.appendChild(node);
  }
  if (example.note) lane.appendChild(el('span', 'cloud-tour-note', example.note));
  if (example.action) lane.appendChild(el('span', 'cloud-tour-action', example.action));
  return lane;
}

const BUILDERS = {
  features: buildFeatures,
  board: buildBoard,
  lane: buildLane,
  parts: buildParts,
};

// ─── The skeleton and the step ────────────────────────────────

/** Build the tour once; `show` repaints it from then on. */
function render(root) {
  if (!root || root.childNodes.length) return;

  const head = el('div', 'cloud-pitch-head');
  const eyebrow = el('span', 'cloud-pitch-eyebrow', tour.EYEBROW);
  const count = el('span', 'cloud-tour-count');
  eyebrow.appendChild(count);
  head.appendChild(eyebrow);
  const title = el('h3', 'cloud-pitch-title');
  title.setAttribute('aria-live', 'polite');
  head.appendChild(title);
  const lede = el('p', 'cloud-pitch-lede');
  head.appendChild(lede);
  root.appendChild(head);

  const stage = el('div', 'cloud-tour-stage');
  stage.setAttribute('role', 'group');
  root.appendChild(stage);

  const nav = el('div', 'cloud-tour-nav');
  const dotRow = el('div', 'cloud-tour-dots');
  const dots = tour.STEPS.map((step, i) => {
    const dot = el('button', 'cloud-tour-dot-btn');
    dot.type = 'button';
    dot.setAttribute('aria-label', step.name);
    dot.title = step.name;
    dot.addEventListener('click', () => show(i));
    dotRow.appendChild(dot);
    return dot;
  });
  nav.appendChild(dotRow);
  const back = el('button', 'cloud-tour-btn', 'Back');
  back.type = 'button';
  back.addEventListener('click', () => show(tour.back(at)));
  nav.appendChild(back);
  const next = el('button', 'cloud-tour-btn', 'Next');
  next.type = 'button';
  next.addEventListener('click', () => show(tour.next(at)));
  nav.appendChild(next);
  root.appendChild(nav);

  const trust = el('p', 'cloud-trust');
  const lock = el('span');
  lock.innerHTML = LOCK_ICON;
  trust.appendChild(lock.firstChild);
  const words = el('span');
  words.appendChild(el('b', '', tour.TRUST_LEAD));
  words.appendChild(document.createTextNode(tour.TRUST.slice(tour.TRUST_LEAD.length)));
  trust.appendChild(words);
  root.appendChild(trust);

  refs = { count, title, lede, stage, dots, back, next };
  show(0);
}

/** Show step `i` (clamped): the words, the example, the dots and the buttons. */
function show(i) {
  if (!refs) return;
  at = tour.clamp(i);
  const step = tour.STEPS[at];

  refs.count.textContent = ` · ${tour.counter(at)}`;
  refs.title.textContent = step.title;
  refs.lede.textContent = step.lede;

  const build = BUILDERS[step.example.kind];
  refs.stage.replaceChildren(...(build ? [build(step.example)] : []));
  refs.stage.setAttribute('aria-label', `Example: ${step.name}`);
  refs.stage.scrollTop = 0;

  refs.dots.forEach((dot, n) => {
    if (n === at) dot.setAttribute('aria-current', 'step');
    else dot.removeAttribute('aria-current');
  });

  // A button that turns disabled under focus would drop focus to the page;
  // hand it to the other one instead.
  const active = document.activeElement;
  const canNext = tour.canNext(at);
  const canBack = tour.canBack(at);
  refs.next.disabled = !canNext;
  refs.back.disabled = !canBack;
  if (active === refs.next && !canNext) refs.back.focus();
  else if (active === refs.back && !canBack) refs.next.focus();
}

/** Back to step one — every time the window opens. */
function reset() {
  show(0);
}

module.exports = { render, show, reset };
