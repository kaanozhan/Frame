/**
 * JavaScript / TypeScript extractor
 *
 * The CommonJS logic is moved verbatim from update-structure.js (the golden
 * fixture guards byte-compat), extended with ESM import/export and TS/JSX
 * support. Dependency-free — ships into user projects' .frame/bin/lang/.
 */

const extensions = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx'];

/** Strip a source extension from a dependency path. */
function stripExt(p) {
  return p.replace(/\.(js|mjs|cjs|jsx|ts|tsx)$/, '');
}

/**
 * Strip TS-only syntax from a captured param: type annotation ("label:
 * string") and optional marker ("label?"). Params without a ":" — all plain
 * JS — pass through untouched, so CJS output is unchanged.
 */
function cleanParam(param) {
  if (!param.includes(':')) return param;
  return param.split(':')[0].trim().replace(/\?$/, '');
}

/**
 * Extract file description from top comment
 */
function extractDescription(content) {
  // Match JSDoc style comment at top
  const match = content.match(/^\/\*\*\s*\n\s*\*\s*([^\n]+)/);
  if (match) {
    return match[1].trim();
  }

  // Match single line comment
  const singleMatch = content.match(/^\/\/\s*(.+)/);
  if (singleMatch) {
    return singleMatch[1].trim();
  }

  return '';
}

/**
 * Extract exports: module.exports (CJS) and export statements (ESM)
 */
function extractExports(content) {
  const exports = [];

  // module.exports = { func1, func2 }
  const objectMatch = content.match(/module\.exports\s*=\s*\{([^}]+)\}/);
  if (objectMatch) {
    const items = objectMatch[1].split(',').map(s => s.trim());
    items.forEach(item => {
      // Handle "name: value" and just "name"
      const name = item.split(':')[0].trim();
      if (name && !name.startsWith('//')) {
        exports.push(name);
      }
    });
  }

  // module.exports.funcName = ...
  const namedMatches = content.matchAll(/module\.exports\.(\w+)\s*=/g);
  for (const match of namedMatches) {
    if (!exports.includes(match[1])) {
      exports.push(match[1]);
    }
  }

  // ESM: export [default] function/class/const/let/var name
  const esmDecls = content.matchAll(/^export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+(\w+)/gm);
  for (const match of esmDecls) {
    if (!exports.includes(match[1])) {
      exports.push(match[1]);
    }
  }

  // ESM: export { a, b as c } — the exported (alias) name counts
  const esmNamed = content.matchAll(/^export\s*\{([^}]+)\}/gm);
  for (const match of esmNamed) {
    for (const item of match[1].split(',')) {
      const name = (item.includes(' as ') ? item.split(' as ')[1] : item).trim();
      if (name && !exports.includes(name)) {
        exports.push(name);
      }
    }
  }

  // ESM: anonymous default export ("export default {" / expression)
  if (/^export\s+default\b/m.test(content)
    && !/^export\s+default\s+(?:async\s+)?(?:function|class)\s+\w+/m.test(content)
    && !exports.includes('default')) {
    exports.push('default');
  }

  return exports;
}

/**
 * Extract dependencies: require() (CJS) and import/export-from (ESM)
 */
function extractDependencies(content) {
  const deps = [];
  const patterns = [
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,          // require('x')
    /import\s+[^'";]*?from\s*['"]([^'"]+)['"]/g,      // import x from 'x'
    /^import\s*['"]([^'"]+)['"]/gm,                   // import 'x' (side effect)
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,           // import('x') (dynamic)
    /export\s+[^'";]*?from\s*['"]([^'"]+)['"]/g       // export { x } from 'x'
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const dep = match[1];
      // Convert relative paths to module names
      if (dep.startsWith('./') || dep.startsWith('../')) {
        // Convert to module path format
        deps.push(stripExt(dep.replace(/^\.\.?\//, '')));
      } else {
        // External module
        deps.push(dep);
      }
    }
  }

  return [...new Set(deps)]; // Remove duplicates
}

/**
 * Extract function definitions with line numbers
 */
function extractFunctions(content, lines) {
  const functions = {};

  const record = (name, rawParams, index) => {
    if (functions[name]) return; // Keep the first sighting
    const params = rawParams.split(',').map(p => cleanParam(p.trim())).filter(p => p);
    const lineNum = content.substring(0, index).split('\n').length;
    const purpose = extractPurpose(lines, lineNum - 1);

    functions[name] = {
      line: lineNum,
      params: params.length > 0 ? params : undefined,
      purpose: purpose || undefined
    };

    // Clean up undefined values
    Object.keys(functions[name]).forEach(key => {
      if (functions[name][key] === undefined) {
        delete functions[name][key];
      }
    });
  };

  // Match function declarations, incl. ESM "export [default] function"
  // and TS generics: function name<T>(params) {
  const funcRegex = /^(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/gm;
  let match;
  while ((match = funcRegex.exec(content)) !== null) {
    record(match[1], match[2], match.index);
  }

  // Match [export] const name = function(params) or const name = (params) =>
  const constFuncRegex = /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function\s*)?\(([^)]*)\)\s*(?:=>)?\s*[{]/gm;
  while ((match = constFuncRegex.exec(content)) !== null) {
    record(match[1], match[2], match.index);
  }

  return functions;
}

/**
 * Extract function purpose from the comment block directly above a declaration.
 * Only a comment that ends on the line immediately above counts. The purpose is
 * always the block's FIRST content line — never a mid-comment fragment.
 */
function extractPurpose(lines, lineIndex) {
  const above = lineIndex - 1;
  if (above < 0) return null;

  const aboveLine = lines[above].trim();

  // Run of // comments: walk up to the start of the run, take its first line
  if (aboveLine.startsWith('//')) {
    let start = above;
    while (start > 0 && lines[start - 1].trim().startsWith('//')) {
      start--;
    }
    const text = lines[start].trim().replace(/^\/\/\s*/, '').trim();
    return text || null;
  }

  // Block comment ending immediately above: walk up to /* and take the
  // block's first content line (skipping JSDoc @tags)
  if (aboveLine.endsWith('*/')) {
    let start = above;
    while (start >= 0 && !lines[start].includes('/*')) {
      start--;
    }
    if (start < 0) return null;

    for (let i = start; i <= above; i++) {
      const text = lines[i].trim()
        .replace(/^\/\*\*?/, '')
        .replace(/\*\/$/, '')
        .replace(/^\*\s?/, '')
        .trim();
      if (text && !text.startsWith('@')) {
        return text;
      }
    }
  }

  return null;
}

/**
 * Extract IPC channel usage (Electron projects; harmless no-op elsewhere)
 */
function extractIPC(content) {
  const ipc = { listens: [], emits: [] };

  // ipcMain.on / ipcMain.handle
  const listenMatches = content.matchAll(/ipc(?:Main|Renderer)\.(?:on|handle)\s*\(\s*(?:IPC\.)?['"]?(\w+)['"]?/g);
  for (const match of listenMatches) {
    ipc.listens.push(match[1]);
  }

  // Also check for IPC constant references in .on()
  const ipcConstListens = content.matchAll(/\.on\s*\(\s*IPC\.(\w+)/g);
  for (const match of ipcConstListens) {
    if (!ipc.listens.includes(match[1])) {
      ipc.listens.push(match[1]);
    }
  }

  // ipcRenderer.send / mainWindow.webContents.send
  const emitMatches = content.matchAll(/(?:ipcRenderer|webContents)\.send\s*\(\s*(?:IPC\.)?['"]?(\w+)['"]?/g);
  for (const match of emitMatches) {
    ipc.emits.push(match[1]);
  }

  // Also check for IPC constant references in .send()
  const ipcConstEmits = content.matchAll(/\.send\s*\(\s*IPC\.(\w+)/g);
  for (const match of ipcConstEmits) {
    if (!ipc.emits.includes(match[1])) {
      ipc.emits.push(match[1]);
    }
  }

  return ipc;
}

module.exports = {
  extensions,
  extractDescription,
  extractExports,
  extractDependencies,
  extractFunctions,
  extractPurpose,
  extractIPC
};
