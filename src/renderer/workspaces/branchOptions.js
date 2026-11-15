/**
 * branchOptions — what the New Workspace branch fields list (pure).
 *
 * A filter the user types narrows the repository's branches to the ones
 * whose name contains it (case-insensitive, anywhere in the name — `log`
 * finds `feat/login`). Local branches come first; remote branches follow,
 * without those that already have a local branch of the same name. The
 * exact match, when there is one, is highlighted first, so Enter keeps what
 * was typed.
 *
 * Pure: no DOM, so it is tested directly (test/branchOptions.test.js).
 */

const LIMIT = 60; // per section: a filter narrows the rest

function matches(name, needle) {
  return !needle || name.toLowerCase().includes(needle);
}

/**
 * @param {{ local?: string[], remote?: string[], filter?: string }} input
 * @returns {{ sections: Array<{ id: 'local'|'remote', label: string, items: string[], more: number }>, items: string[] }}
 *   `items` is every listed name in display order (what arrows walk).
 */
function build({ local = [], remote = [], filter = '' } = {}) {
  const needle = String(filter || '').trim().toLowerCase();
  const uniq = (list) => [...new Set((list || []).filter((n) => typeof n === 'string' && n))];
  const localNames = uniq(local);
  const localSet = new Set(localNames);
  const remoteNames = uniq(remote).filter((n) => !localSet.has(n));
  const sections = [];
  for (const [id, label, names] of [['local', 'Local', localNames], ['remote', 'Remote', remoteNames]]) {
    const hits = names.filter((n) => matches(n, needle));
    // The exact name first, then the rest in their given order.
    hits.sort((a, b) => (b.toLowerCase() === needle) - (a.toLowerCase() === needle));
    if (hits.length) sections.push({ id, label, items: hits.slice(0, LIMIT), more: Math.max(0, hits.length - LIMIT) });
  }
  return { sections, items: sections.flatMap((s) => s.items) };
}

/** The index the arrows land on: `delta` from `index`, wrapping; -1 with nothing listed. */
function move(items, index, delta) {
  if (!items || !items.length) return -1;
  if (index < 0) return delta > 0 ? 0 : items.length - 1;
  return (index + delta + items.length) % items.length;
}

/** The first highlight for a filter: the exact match if listed, else nothing (Enter keeps the typed text). */
function initialHighlight(items, filter) {
  const needle = String(filter || '').trim().toLowerCase();
  if (!needle) return -1;
  return (items || []).findIndex((n) => n.toLowerCase() === needle);
}

module.exports = { build, move, initialHighlight, LIMIT };
