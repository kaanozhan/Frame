/**
 * Python extractor
 *
 * Regex-based, good-enough extraction: module docstring, top-level
 * def/class, imports, def params with annotations stripped. Dependency-free —
 * ships into user projects' .frame/bin/lang/.
 */

const extensions = ['.py'];

/**
 * Extract module description: docstring first line, else top # comment
 */
function extractDescription(content) {
  const doc = content.match(/^\s*(?:"""|''')\s*\n?\s*([^\n"']+)/);
  if (doc) return doc[1].trim();
  const hash = content.match(/^#\s*(.+)/);
  if (hash && !hash[1].startsWith('!')) return hash[1].trim();
  return '';
}

/**
 * Extract exports: __all__ when declared, else public top-level def/class
 */
function extractExports(content) {
  const exports = [];

  const all = content.match(/^__all__\s*=\s*[\[(]([^\])]*)[\])]/m);
  if (all) {
    for (const item of all[1].split(',')) {
      const name = item.trim().replace(/^['"]|['"]$/g, '');
      if (name) exports.push(name);
    }
    return exports;
  }

  for (const match of content.matchAll(/^(?:async\s+)?def\s+(\w+)/gm)) {
    if (!match[1].startsWith('_') && !exports.includes(match[1])) exports.push(match[1]);
  }
  for (const match of content.matchAll(/^class\s+(\w+)/gm)) {
    if (!match[1].startsWith('_') && !exports.includes(match[1])) exports.push(match[1]);
  }
  return exports;
}

/**
 * Extract top-level import dependencies
 */
function extractDependencies(content) {
  const deps = [];
  for (const match of content.matchAll(/^import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/gm)) {
    for (const mod of match[1].split(',')) deps.push(mod.trim());
  }
  for (const match of content.matchAll(/^from\s+([\w.]+)\s+import/gm)) {
    deps.push(match[1].replace(/^\.+/, '') || match[1]);
  }
  return [...new Set(deps.filter(Boolean))];
}

/** Strip annotation and default from one param: "x: int = 5" → "x" */
function cleanParam(param) {
  return param.split(':')[0].split('=')[0].trim();
}

/**
 * Extract top-level function definitions with line numbers
 */
function extractFunctions(content, lines) {
  const functions = {};

  const defRegex = /^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/gm;
  let match;
  while ((match = defRegex.exec(content)) !== null) {
    const name = match[1];
    if (functions[name]) continue;
    const params = match[2].split(',').map(p => cleanParam(p)).filter(p => p && p !== 'self' && p !== 'cls');
    const lineNum = content.substring(0, match.index).split('\n').length;
    const purpose = extractPurpose(lines, lineNum - 1);

    functions[name] = { line: lineNum };
    if (params.length > 0) functions[name].params = params;
    if (purpose) functions[name].purpose = purpose;
  }

  return functions;
}

/**
 * Extract purpose: the def's docstring first line, else a # comment run
 * ending on the line immediately above
 */
function extractPurpose(lines, lineIndex) {
  // Docstring: first non-empty line after the def line is """text
  for (let i = lineIndex + 1; i < Math.min(lineIndex + 3, lines.length); i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const doc = line.match(/^(?:"""|''')\s*(.*?)\s*(?:"""|''')?$/);
    if (doc && doc[1]) return doc[1].trim();
    break;
  }

  // # comment run directly above: take its first line
  const above = lineIndex - 1;
  if (above >= 0 && lines[above].trim().startsWith('#')) {
    let start = above;
    while (start > 0 && lines[start - 1].trim().startsWith('#')) start--;
    const text = lines[start].trim().replace(/^#\s*/, '').trim();
    return text || null;
  }

  return null;
}

module.exports = {
  extensions,
  extractDescription,
  extractExports,
  extractDependencies,
  extractFunctions,
  extractPurpose
};
