/**
 * modalKeys — what Enter means inside a dialog (workspace-hardening R1).
 *
 * Enter confirms the dialog only from a field. On a focused button the
 * browser already "clicks" it (Cancel cancels); on a select or link it has
 * its own meaning; in a textarea it is a newline unless ⌘/Ctrl is held.
 * Pure: no DOM access beyond the target's tag.
 */
function enterSubmits(target, { metaKey = false, ctrlKey = false } = {}) {
  if (!target || !target.tagName) return false;
  const tag = String(target.tagName).toUpperCase();
  if (tag === 'BUTTON' || tag === 'SELECT' || tag === 'A') return false;
  if (tag === 'TEXTAREA') return !!(metaKey || ctrlKey);
  return true;
}

module.exports = { enterSubmits };
