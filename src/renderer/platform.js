/**
 * Platform helpers
 * Cross-platform shortcut formatting and matching for command registry.
 */

const isMac = typeof process !== 'undefined' && process.platform === 'darwin';

const SYMBOLS = {
  cmdorctrl: isMac ? '⌘' : 'Ctrl',
  cmd: '⌘',
  ctrl: 'Ctrl',
  shift: isMac ? '⇧' : 'Shift',
  alt: isMac ? '⌥' : 'Alt',
  option: isMac ? '⌥' : 'Alt',
  meta: isMac ? '⌘' : 'Meta',
  tab: isMac ? '⇥' : 'Tab',
  enter: isMac ? '↵' : 'Enter',
  escape: 'Esc',
  esc: 'Esc',
  backspace: isMac ? '⌫' : 'Backspace',
  delete: 'Del',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  space: 'Space'
};

const JOIN = isMac ? '' : '+';

/**
 * Convert an Electron-style accelerator (e.g. "CmdOrCtrl+Shift+P") into a
 * platform-appropriate display string.
 */
function formatShortcut(accelerator) {
  if (!accelerator) return '';
  return accelerator
    .split('+')
    .map((part) => {
      const key = part.toLowerCase();
      if (SYMBOLS[key] !== undefined) return SYMBOLS[key];
      if (part.length === 1) return part.toUpperCase();
      return part;
    })
    .join(JOIN);
}

/**
 * Check whether a KeyboardEvent matches an accelerator string.
 */
function matchesShortcut(e, accelerator) {
  if (!accelerator) return false;
  const tokens = accelerator.toLowerCase().split('+');

  const requireMod =
    tokens.includes('cmdorctrl') ||
    tokens.includes('ctrl') ||
    tokens.includes('cmd') ||
    tokens.includes('meta');
  const requireShift = tokens.includes('shift');
  const requireAlt = tokens.includes('alt') || tokens.includes('option');

  const modPressed = e.ctrlKey || e.metaKey;
  if (requireMod !== modPressed) return false;
  if (requireShift !== e.shiftKey) return false;
  if (requireAlt !== e.altKey) return false;

  const keyToken = tokens[tokens.length - 1];
  const eventKey = (e.key || '').toLowerCase();

  if (keyToken === 'space') return eventKey === ' ' || eventKey === 'spacebar';
  if (keyToken === 'esc' || keyToken === 'escape') return eventKey === 'escape';
  return eventKey === keyToken;
}

module.exports = { isMac, formatShortcut, matchesShortcut };
