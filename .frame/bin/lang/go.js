/**
 * Go extractor
 *
 * Regex-based, good-enough extraction: package doc comment, exported
 * (capitalized) top-level identifiers, imports, func params. Dependency-free —
 * ships into user projects' .frame/bin/lang/.
 */

const extensions = ['.go'];

/**
 * Extract description: the package doc comment's first line
 */
function extractDescription(content) {
  const match = content.match(/^\/\/\s*(.+)\n(?:\/\/[^\n]*\n)*package\s+\w+/m);
  if (match) return match[1].trim();
  return '';
}

/**
 * Extract exports: capitalized top-level func/type/var/const names
 */
function extractExports(content) {
  const exports = [];
  const patterns = [
    /^func\s+(?:\([^)]*\)\s+)?([A-Z]\w*)/gm,   // funcs and methods
    /^type\s+([A-Z]\w*)/gm,
    /^(?:var|const)\s+([A-Z]\w*)/gm
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      if (!exports.includes(match[1])) exports.push(match[1]);
    }
  }
  return exports;
}

/**
 * Extract import paths (single and block form)
 */
function extractDependencies(content) {
  const deps = [];
  for (const match of content.matchAll(/^import\s+(?:\w+\s+)?"([^"]+)"/gm)) {
    deps.push(match[1]);
  }
  const block = content.match(/import\s*\(([\s\S]*?)\)/);
  if (block) {
    for (const match of block[1].matchAll(/"([^"]+)"/g)) {
      deps.push(match[1]);
    }
  }
  return [...new Set(deps)];
}

/** "id string, value string" → ["id", "value"]; skips receiver-less groups */
function cleanParams(raw) {
  const params = [];
  for (const group of raw.split(',')) {
    const name = group.trim().split(/\s+/)[0];
    if (name && /^[a-zA-Z_]\w*$/.test(name)) params.push(name);
  }
  return params;
}

/**
 * Extract top-level functions (including methods) with line numbers
 */
function extractFunctions(content, lines) {
  const functions = {};

  const funcRegex = /^func\s+(?:\([^)]*\)\s+)?(\w+)\s*\(([^)]*)\)/gm;
  let match;
  while ((match = funcRegex.exec(content)) !== null) {
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
 * Extract purpose from the // comment run ending immediately above
 */
function extractPurpose(lines, lineIndex) {
  const above = lineIndex - 1;
  if (above < 0 || !lines[above].trim().startsWith('//')) return null;
  let start = above;
  while (start > 0 && lines[start - 1].trim().startsWith('//')) start--;
  const text = lines[start].trim().replace(/^\/\/\s*/, '').trim();
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
