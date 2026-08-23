/**
 * Markdown extractor
 *
 * Docs repos get an honest file map: the first heading becomes the
 * description; no exports/deps/functions are invented. Opt-in — only active
 * when the detected project languages include "markdown", so code repos
 * don't index their READMEs as modules.
 */

const extensions = ['.md'];

/**
 * Extract description: first heading text, else first non-empty line
 */
function extractDescription(content) {
  const heading = content.match(/^#{1,6}\s+(.+)/m);
  if (heading) return heading[1].trim();
  const line = content.split('\n').find(l => l.trim());
  return line ? line.trim() : '';
}

function extractExports() {
  return [];
}

function extractDependencies() {
  return [];
}

function extractFunctions() {
  return {};
}

function extractPurpose() {
  return null;
}

module.exports = {
  extensions,
  optInLanguage: 'markdown',
  extractDescription,
  extractExports,
  extractDependencies,
  extractFunctions,
  extractPurpose
};
