/**
 * Command Registry
 *
 * Central registry for app actions. Each command is the single source of
 * truth for its title, shortcut, and behavior — consumed by the Command
 * Palette, the keyboard handler, and (later) the cheat sheet UI.
 */

const { matchesShortcut } = require('./platform');

const RECENT_KEY = 'command-palette:recent';
const RECENT_LIMIT = 20;

const commands = new Map();
let keyboardBound = false;

/**
 * Register a command.
 * @param {Object} cmd
 * @param {string} cmd.id           Unique id (e.g. "panel.toggleSidebar")
 * @param {string} cmd.title        Short user-facing label
 * @param {string} [cmd.category]   Category label for grouping ("Panel", "Terminal"...)
 * @param {string} [cmd.shortcut]   Electron-style accelerator ("CmdOrCtrl+Shift+P")
 * @param {Function} cmd.run        Action to invoke
 * @param {Function} [cmd.when]     Predicate that returns whether the command is currently available
 */
function register(cmd) {
  if (!cmd || !cmd.id || !cmd.title || typeof cmd.run !== 'function') {
    throw new Error('Command requires id, title, and run');
  }
  commands.set(cmd.id, {
    id: cmd.id,
    title: cmd.title,
    category: cmd.category || '',
    shortcut: cmd.shortcut || '',
    when: typeof cmd.when === 'function' ? cmd.when : () => true,
    run: cmd.run
  });
}

function unregister(id) {
  commands.delete(id);
}

function getById(id) {
  return commands.get(id);
}

function getAll() {
  return Array.from(commands.values()).filter((c) => c.when());
}

function runById(id) {
  const cmd = commands.get(id);
  if (!cmd || !cmd.when()) return false;
  pushRecent(id);
  try {
    cmd.run();
    return true;
  } catch (err) {
    console.error('Command failed:', id, err);
    return false;
  }
}

/**
 * Search commands. Empty query → recents first, then alphabetical by category/title.
 */
function search(query) {
  const q = (query || '').trim().toLowerCase();
  const all = getAll();

  if (!q) {
    const recentIds = getRecent();
    const recentSet = new Set(recentIds);
    const recents = recentIds
      .map((id) => commands.get(id))
      .filter((c) => c && c.when());
    const others = all.filter((c) => !recentSet.has(c.id));
    others.sort((a, b) => {
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      return a.title.localeCompare(b.title);
    });
    return [...recents, ...others];
  }

  const scored = [];
  for (const cmd of all) {
    const score = fuzzyScore(q, cmd);
    if (score > 0) scored.push({ cmd, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.cmd);
}

/**
 * Fuzzy score: subsequence match with bonuses for word boundaries and
 * consecutive characters. Score 0 means no match.
 */
function fuzzyScore(query, cmd) {
  const haystacks = [cmd.title.toLowerCase()];
  if (cmd.category) haystacks.push(cmd.category.toLowerCase());
  let best = 0;
  for (let h = 0; h < haystacks.length; h++) {
    const target = haystacks[h];
    let score = 0;
    let qIdx = 0;
    let lastMatchIdx = -2;
    for (let i = 0; i < target.length && qIdx < query.length; i++) {
      if (target[i] === query[qIdx]) {
        if (i === 0 || target[i - 1] === ' ' || target[i - 1] === '-') score += 5;
        if (lastMatchIdx === i - 1) score += 2;
        score += 1;
        lastMatchIdx = i;
        qIdx++;
      }
    }
    if (qIdx >= query.length) {
      score += 10 / (target.length + 1);
      if (h > 0) score *= 0.5; // category match counts less than title match
      if (score > best) best = score;
    }
  }
  return best;
}

function pushRecent(id) {
  const recent = [id, ...getRecent().filter((r) => r !== id)].slice(0, RECENT_LIMIT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch (e) {
    /* ignore quota errors */
  }
}

function getRecent() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

/**
 * Bind a single global keydown handler that dispatches to the first matching
 * registered shortcut. Idempotent.
 */
function bindKeyboard() {
  if (keyboardBound) return;
  keyboardBound = true;

  document.addEventListener('keydown', (e) => {
    const target = e.target;
    const tag = target && target.tagName;
    const isInput =
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      (target && target.isContentEditable);

    for (const cmd of commands.values()) {
      if (!cmd.shortcut) continue;
      if (!matchesShortcut(e, cmd.shortcut)) continue;
      if (!cmd.when()) continue;

      // Allow shortcuts that include a modifier even when typing in an input
      // (so Cmd+P still opens the palette while a search field is focused).
      // Plain keys are blocked inside inputs to not steal typed characters.
      const tokens = cmd.shortcut.toLowerCase().split('+');
      const hasModifier = tokens.some((t) =>
        ['cmdorctrl', 'ctrl', 'cmd', 'meta', 'alt', 'option'].includes(t)
      );
      if (isInput && !hasModifier) continue;

      e.preventDefault();
      runById(cmd.id);
      return;
    }
  });
}

module.exports = {
  register,
  unregister,
  getById,
  getAll,
  runById,
  search,
  bindKeyboard
};
