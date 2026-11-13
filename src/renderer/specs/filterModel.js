/**
 * Specs dashboard filter model — what the grid shows for a given scope,
 * phase, search and done window.
 *
 * Pure by design (boards-done-window spec, D7): a function over the spec
 * list, so the scope × phase × window × search rules are testable and
 * `specsDashboard.js` only renders what comes back.
 *
 * Rules:
 * - scope `all` / `active` / `done` — `done` is `phase === 'done'`, active
 *   is everything else (a malformed spec is not done, so it is active).
 * - `phase` narrows only while scope is `active`; every phase chip is a
 *   subset of Active, so outside it the value is ignored.
 * - a non-null `searchMatches` (Set of slugs) narrows the pool first and
 *   switches the window off: a query is explicit intent (D5).
 * - in `all` and `done`, done specs older than `windowDays` are dropped
 *   from `visible` and reported as `olderCount`, unless `showOlder`.
 *   Active is never windowed. Age is read from `updated_at` (D6).
 * - `sort` orders `visible` by date: `newest` (default) or `oldest` first.
 *   The date is `updated_at`, falling back to `created_at`; a spec with
 *   neither sorts as the oldest. Ties keep input order.
 * - `counts` answer "what will I see if I click": they follow the search
 *   pool and, for `all` / `done`, the window. `doneTotal` is the unwindowed
 *   done count for the tooltip.
 */

const { partitionDone } = require('../../shared/doneWindow');

const SCOPES = Object.freeze(['all', 'active', 'done']);

const PHASES = Object.freeze([
  { id: 'draft',           label: 'Draft' },
  { id: 'specified',       label: 'Specified' },
  { id: 'planned',         label: 'Planned' },
  { id: 'tasks_generated', label: 'Tasks Generated' },
  { id: 'implementing',    label: 'Implementing' }
]);

const SORTS = Object.freeze(['newest', 'oldest']);

const isDone = (s) => s && s.phase === 'done';

function dateValue(s) {
  const t = Date.parse((s && (s.updated_at || s.created_at)) || '');
  return Number.isFinite(t) ? t : -Infinity;
}

function sortByDate(list, sort) {
  const dir = sort === 'oldest' ? 1 : -1;
  return list
    .map((s, i) => ({ s, i, t: dateValue(s) }))
    .sort((a, b) => (a.t === b.t ? a.i - b.i : (a.t < b.t ? -dir : dir)))
    .map(x => x.s);
}

function buildGridModel({
  specs = [],
  scope = 'all',
  phase = null,
  searchMatches = null,
  windowDays = 0,
  showOlder = false,
  sort = 'newest',
  now = Date.now()
} = {}) {
  const pool = searchMatches ? specs.filter(s => searchMatches.has(s.slug)) : specs;
  const effectiveScope = SCOPES.includes(scope) ? scope : 'all';
  const effectivePhase = effectiveScope === 'active' ? phase : null;

  // The window is off while searching, when set to "all", or once revealed.
  const windowed = !searchMatches && windowDays > 0 && !showOlder;
  const { recent: recentDone, older: olderDone } = windowed
    ? partitionDone(pool.filter(isDone), { days: windowDays, now, dateOf: s => s.updated_at })
    : { recent: pool.filter(isDone), older: [] };
  const hidden = new Set(olderDone);

  const counts = { all: 0, active: 0, done: 0, doneTotal: 0 };
  for (const s of pool) {
    if (isDone(s)) {
      counts.doneTotal++;
      if (!hidden.has(s)) { counts.done++; counts.all++; }
    } else {
      counts.active++;
      counts.all++;
      const key = `phase:${s.phase}`;
      counts[key] = (counts[key] || 0) + 1;
    }
  }

  let visible;
  let olderCount = 0;
  if (effectiveScope === 'active') {
    visible = pool.filter(s => !isDone(s) && (!effectivePhase || s.phase === effectivePhase));
  } else if (effectiveScope === 'done') {
    visible = recentDone;
    olderCount = olderDone.length;
  } else {
    visible = pool.filter(s => !hidden.has(s));
    olderCount = olderDone.length;
  }

  const effectiveSort = SORTS.includes(sort) ? sort : 'newest';
  visible = sortByDate(visible, effectiveSort);

  return { visible, olderCount, counts, scope: effectiveScope, phase: effectivePhase, sort: effectiveSort };
}

module.exports = { SCOPES, PHASES, SORTS, buildGridModel };
