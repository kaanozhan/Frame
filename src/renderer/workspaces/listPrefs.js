/**
 * Workspace list prefs — pure (workspace-list-agent-alerts spec, T04).
 *
 * Whether the sidebar's workspace list is open, per sidebar view. The
 * Projects view has room for it, so it starts open there; Files, Changes and
 * GitHub need the height for their own content, so it starts folded in
 * those. Each view remembers what the user last chose for it.
 *
 * Stored in localStorage `frame-ws-list-open` as `{ [view]: boolean }` — only
 * views the user folded or unfolded have an entry. Anything else found there
 * (a hand-edited value, an older shape) reads as "no choice made".
 */

const STORAGE_KEY = 'frame-ws-list-open';
const OPEN_BY_DEFAULT = 'projects';

/** Open in the Projects view, folded in every other one. */
function defaultOpen(view) {
  return view === OPEN_BY_DEFAULT;
}

/** The stored choices that are usable: a plain object's boolean entries. */
function clean(prefs) {
  const out = {};
  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) return out;
  for (const [view, open] of Object.entries(prefs)) {
    if (typeof open === 'boolean') out[view] = open;
  }
  return out;
}

/** The stored string as prefs; `{}` when it is missing or unreadable. */
function parse(raw) {
  try { return clean(JSON.parse(raw || '{}')); } catch (_) { return {}; }
}

/** Is the list open in `view`? The user's choice for it, else the view's default. */
function isOpen(prefs, view) {
  const stored = clean(prefs)[view];
  return typeof stored === 'boolean' ? stored : defaultOpen(view);
}

/** The prefs with `view` set open or folded; the other views are untouched. */
function withOpen(prefs, view, open) {
  return { ...clean(prefs), [view]: !!open };
}

module.exports = { STORAGE_KEY, defaultOpen, parse, isOpen, withOpen };
