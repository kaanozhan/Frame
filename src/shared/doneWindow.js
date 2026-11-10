/**
 * doneWindow — how much of the "done" pile a board shows by default.
 *
 * Pure by design (boards-done-window spec, D7): required from main to
 * normalise the project setting, and from both boards to split done items
 * into the ones inside the window and the ones behind "Show N older".
 * Nothing here reaches electron, the DOM or the filesystem.
 *
 * The window applies to done items only — a pending task from sixty days
 * ago is still pending — and a done item with no usable date counts as
 * recent, because a missing timestamp must never hide work silently.
 */

const DAY_MS = 86400000;

/** Days of done items a board shows before the reveal control. 0 = all. */
const DEFAULT_DONE_WINDOW = Object.freeze({ tasks: 7, specs: 0 });

/** The values Project Settings offers; anything else falls back. */
const WINDOW_OPTIONS = Object.freeze([7, 30, 90, 0]);

const BOARDS = Object.freeze(['tasks', 'specs']);

/**
 * Coerce one raw value to a window in days, or null when it is not one of
 * the offered options. Numeric strings are accepted because a hand-edited
 * config is the only other writer.
 */
function coerceDays(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'string' ? Number(raw.trim()) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return WINDOW_OPTIONS.includes(n) ? n : null;
}

/**
 * Any input → a valid `{ tasks, specs }`, falling back per key to the
 * default. Never throws.
 */
function normalizeDoneWindow(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const board of BOARDS) {
    const days = coerceDays(src[board]);
    out[board] = days === null ? DEFAULT_DONE_WINDOW[board] : days;
  }
  return out;
}

/**
 * Is a timestamp inside the last `days` days? `days` 0 means everything is.
 * An absent or unparseable timestamp is inside — see the header.
 * The boundary is inclusive: exactly `days` days old is still within.
 */
function isWithinWindow(iso, days, now = Date.now()) {
  if (!days) return true;
  if (iso === null || iso === undefined || iso === '') return true;
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!Number.isFinite(t)) return true;
  return now - t <= days * DAY_MS;
}

/**
 * Split done items into `recent` (inside the window) and `older`, keeping
 * the input order in both. `dateOf` picks the timestamp per item.
 */
function partitionDone(items, { days, now = Date.now(), dateOf } = {}) {
  const recent = [];
  const older = [];
  const pick = typeof dateOf === 'function' ? dateOf : () => null;
  for (const item of items || []) {
    (isWithinWindow(pick(item), days, now) ? recent : older).push(item);
  }
  return { recent, older };
}

module.exports = {
  DAY_MS,
  DEFAULT_DONE_WINDOW,
  WINDOW_OPTIONS,
  BOARDS,
  normalizeDoneWindow,
  isWithinWindow,
  partitionDone
};
