/**
 * Rust extractor
 *
 * Regex-based, good-enough extraction: //! module doc, pub items, use
 * dependencies, fn params with types stripped. Dependency-free — ships into
 * user projects' .frame/bin/lang/.
 */

const extensions = ['.rs'];

/**
 * Extract description: the first //! inner doc comment line
 */
function extractDescription(content) {
  const match = content.match(/^\/\/!\s*(.+)/m);
  if (match) return match[1].trim();
  return '';
}

/**
 * Extract exports: top-level pub fn/struct/enum/trait/const/mod names
 * (impl methods are functions, not module surface)
 */
function extractExports(content) {
  const exports = [];
  const pattern = /^pub\s+(?:async\s+)?(?:fn|struct|enum|trait|mod|const|static|type)\s+(\w+)/gm;
  for (const match of content.matchAll(pattern)) {
    if (!exports.includes(match[1])) exports.push(match[1]);
  }
  return exports;
}

/**
 * Extract dependencies: use/extern-crate root segments (crate/self/super
 * skipped — they are internal paths, not dependencies)
 */
function extractDependencies(content) {
  const deps = [];
  for (const match of content.matchAll(/^\s*use\s+([\w:]+)/gm)) {
    const root = match[1].split('::')[0];
    if (root && !['crate', 'self', 'super'].includes(root) && !deps.includes(root)) {
      deps.push(root);
    }
  }
  for (const match of content.matchAll(/^extern\s+crate\s+(\w+)/gm)) {
    if (!deps.includes(match[1])) deps.push(match[1]);
  }
  return deps;
}

/** "line: &str, n: usize" → ["line", "n"]; self receivers skipped */
function cleanParams(raw) {
  const params = [];
  for (const group of raw.split(',')) {
    const name = group.split(':')[0].trim().replace(/^(&\s*)?(mut\s+)?/, '');
    if (name && name !== 'self' && /^[a-zA-Z_]\w*$/.test(name)) params.push(name);
  }
  return params;
}

/**
 * Extract fn definitions (top-level and impl methods) with line numbers
 */
function extractFunctions(content, lines) {
  const functions = {};

  const fnRegex = /^\s*(?:pub\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/gm;
  let match;
  while ((match = fnRegex.exec(content)) !== null) {
    const name = match[1];
    if (functions[name]) continue;
    const params = cleanParams(match[2]);
    const lineNum = content.substring(0, match.index).split('\n').length;
    const purpose = extractPurpose(lines, lineNum - 1);

    functions[name] = { line: lineNum };
    if (params.length > 0) functions[name].params = params;
    if (purpose) functions[name].purpose = purpose;
  }

  return functions;
}

/**
 * Extract purpose from the /// (or //) doc comment run ending immediately above
 */
function extractPurpose(lines, lineIndex) {
  const above = lineIndex - 1;
  if (above < 0) return null;
  const isDoc = (s) => s.startsWith('///') || s.startsWith('//');
  if (!isDoc(lines[above].trim())) return null;
  let start = above;
  while (start > 0 && isDoc(lines[start - 1].trim())) start--;
  const text = lines[start].trim().replace(/^\/{2,3}!?\s*/, '').trim();
  return text || null;
}

module.exports = {
  extensions,
  extractDescription,
  extractExports,
  extractDependencies,
  extractFunctions,
  extractPurpose
};
