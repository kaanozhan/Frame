/**
 * Widget Registry — what Home shows, and in what order.
 *
 * The board does not know which widgets exist; it asks here. That makes this
 * the single seam a future "choose your widgets" surface writes to: a stored
 * layout is a list of widget ids and their spans, and `resolveLayout()` is
 * where it would be applied. In this pass there is no stored layout, so the
 * answer is registry order filtered by availability.
 *
 * ## The widget contract
 *
 * A widget is a plain object:
 *
 *   {
 *     id:             stable string — `home-card-<id>` and the key any stored
 *                     layout would use. Never derived from the title, so
 *                     renaming a widget cannot orphan a saved layout.
 *     title:          the card heading
 *     icon:           a lucide icon array
 *     sources:        which homeData sources to subscribe to, e.g. ['lanes']
 *     defaultSpan:    grid columns the widget wants (1 today; the mechanism
 *                     exists now so a full-width widget needs no second one)
 *     defaultEnabled: whether a fresh install shows it
 *     isAvailable(ctx):  false → not mounted at all, occupies no cell (D6).
 *                        Distinct from a mounted widget showing an empty state.
 *     mount(el, ctx):    build the DOM once, into the given element
 *     update(data, ctx): patch in place, given `{ [source]: value }` for every
 *                        source the widget declared. The ONLY per-tick entry
 *                        point (D4) — a widget that rebuilds its subtree here
 *                        is violating the contract, not the style guide (C1).
 *     dispose():         optional; drop listeners and timers
 *   }
 *
 * `ctx` carries the host's affordances — the current state, `enterLane`,
 * `openTerminals`, `createLane` — never `ipcRenderer`. Data reaches a widget
 * through `update()` and nowhere else (D3, S6).
 */

/**
 * The board's reading order, top-left to bottom-right.
 *
 * `lastSessions` joins as it lands; a fifth widget is one file plus one line
 * here (S5).
 */
const WIDGETS = [
  require('./widgets/agents'),
  require('./widgets/activeSpecs'),
  require('./widgets/activeTasks')
];

/**
 * Which widgets to mount, in which order, with the span each one gets.
 *
 * @param {Object} ctx - the host context handed to `isAvailable`
 * @returns {Array<{widget: Object, span: number}>}
 */
function resolveLayout(ctx) {
  return WIDGETS
    .filter(w => w.defaultEnabled !== false)
    .filter(w => typeof w.isAvailable !== 'function' || w.isAvailable(ctx))
    .map(w => ({ widget: w, span: w.defaultSpan || 1 }));
}

/** Every source the resolved widgets read, deduplicated — what the board subscribes to. */
function sourcesFor(layout) {
  const all = new Set();
  for (const { widget } of layout) (widget.sources || []).forEach(s => all.add(s));
  return [...all];
}

module.exports = { WIDGETS, resolveLayout, sourcesFor };
