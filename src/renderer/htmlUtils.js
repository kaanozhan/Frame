/**
 * HTML Utils
 *
 * The renderer's single escapeHtml. Every module that interpolates user or
 * file-system text into an HTML template string must require this helper —
 * do not add local copies (this file replaced 20 of them).
 *
 * String-replace implementation on purpose: no DOM dependency, null-safe,
 * and escapes quotes so the output is safe in attribute contexts too.
 */

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

module.exports = { escapeHtml };
