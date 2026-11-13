/**
 * workspaceNames — automatic short names for workspaces.
 *
 * Workspaces get a color name (workspaces spec, D4: the user chose colors
 * over Conductor's city names). The name becomes the worktree folder and the
 * branch suffix (`<prefix>/<name>`), so it has to be unique among the
 * project's workspaces and free on disk. When every color is taken, names
 * continue as `<color>-2`, `<color>-3`, …
 *
 * Pure by design: the caller passes what is taken (record names and existing
 * folder names) and, under test, a deterministic `random`.
 */

const COLORS = Object.freeze([
  'amber', 'apricot', 'azure', 'beige', 'blue', 'bronze', 'burgundy', 'cerise',
  'charcoal', 'cobalt', 'copper', 'coral', 'crimson', 'cyan', 'denim', 'emerald',
  'fuchsia', 'garnet', 'gold', 'graphite', 'green', 'indigo', 'ivory', 'jade',
  'khaki', 'lavender', 'lemon', 'lilac', 'lime', 'magenta', 'maroon', 'mauve',
  'mint', 'mustard', 'navy', 'ochre', 'olive', 'onyx', 'orange', 'orchid',
  'peach', 'pearl', 'periwinkle', 'pink', 'plum', 'purple', 'red', 'rose',
  'ruby', 'rust', 'saffron', 'sage', 'salmon', 'sand', 'sapphire', 'scarlet',
  'sepia', 'sienna', 'silver', 'slate', 'tan', 'tangerine', 'taupe', 'teal',
  'topaz', 'turquoise', 'ultramarine', 'umber', 'vermilion', 'violet', 'white',
  'yellow'
]);

function takenSet(taken) {
  const set = new Set();
  for (const name of taken || []) {
    if (name) set.add(String(name).toLowerCase());
  }
  return set;
}

/**
 * Pick the next free name. `taken` is any iterable of names already in use
 * (workspace records and folders under the project's workspaces directory).
 */
function nextName(taken, random = Math.random) {
  const used = takenSet(taken);
  const free = COLORS.filter((c) => !used.has(c));
  if (free.length) return free[Math.floor(random() * free.length) % free.length];
  const start = Math.floor(random() * COLORS.length) % COLORS.length;
  for (let n = 2; ; n++) {
    for (let i = 0; i < COLORS.length; i++) {
      const candidate = `${COLORS[(start + i) % COLORS.length]}-${n}`;
      if (!used.has(candidate)) return candidate;
    }
  }
}

/**
 * Turn a user-typed name into a safe folder/branch segment: lowercase,
 * `[a-z0-9-]`, no leading/trailing dashes, at most 40 characters.
 * Returns '' when nothing usable is left.
 */
function toSlug(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-$/, '');
}

/**
 * Make `wanted` unique against `taken` by suffixing `-2`, `-3`, … Used when a
 * folder with the chosen name already exists on disk.
 */
function uniquify(wanted, taken) {
  const used = takenSet(taken);
  if (!used.has(String(wanted).toLowerCase())) return wanted;
  for (let n = 2; ; n++) {
    const candidate = `${wanted}-${n}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

module.exports = { COLORS, nextName, toSlug, uniquify };
