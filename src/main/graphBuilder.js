/**
 * Graph Builder
 *
 * Electron-free core of the code-graph pipeline: decides WHAT to scan and
 * writes the result. Parsing itself (tree-sitter) lives in graphWorker.js —
 * this module stays pure Node (fs/path only) so tests can drive it without
 * Electron and the worker can require it from a plain child process.
 *
 * Responsibilities:
 *   - Read the detected `project` block from .frame/config.json
 *     (languages + sourceRoots, written by scripts/detect-project.js).
 *   - Walk the source roots mirroring update-structure.js's rules (default
 *     ignore set, .gitignore subset, lstat / never follow symlinks) but with
 *     graph-sized caps — the spec budgets for 10k+ file repos, so the
 *     structure parser's 5000-file cap is NOT reused here.
 *   - Normalize file ids to POSIX-style repo-relative paths (Windows-safe).
 *   - Write .frame/graph/graph.json + meta.json, recording every cap trip
 *     and skipped language — never a silent partial graph.
 */

const fs = require('fs');
const path = require('path');

const GRAPH_VERSION = '1.0';
const GRAPH_DIR = 'graph'; // under .frame/

// Graph-specific caps (see plan — sized for 10k+ file repos).
const MAX_GRAPH_FILES = 20000;
const MAX_GRAPH_DEPTH = 12;
const MAX_FILE_SIZE = 1024 * 1024; // skip single files > 1 MB (generated/bundled)
const TIME_BUDGET_MS = 60000; // soft budget, enforced by the worker's parse loop

// Mirrors update-structure.js — directories never scanned regardless of .gitignore.
const DEFAULT_IGNORED_DIRS = new Set([
  'node_modules', 'vendor', '.venv', 'venv', 'target', 'dist', 'build',
  '.git', '__pycache__', '.next', '.turbo', 'coverage', '.frame'
]);

/**
 * Extension → grammar name, gated by detected language. The detector reports
 * coarse languages ('javascript' covers TS projects), so the JS map carries
 * the TS/TSX grammars too — grammar choice is per-file, per-extension.
 */
const LANGUAGE_EXT_GRAMMARS = {
  javascript: {
    '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
    '.jsx': 'javascript', '.ts': 'typescript', '.tsx': 'tsx'
  },
  typescript: {
    '.ts': 'typescript', '.tsx': 'tsx',
    '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript'
  },
  python: { '.py': 'python' },
  go: { '.go': 'go' },
  rust: { '.rs': 'rust' }
};

/** The `project` block of .frame/config.json (written by detect-project.js). */
function loadProjectConfig(rootDir) {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(rootDir, '.frame', 'config.json'), 'utf-8'));
    return config.project || {};
  } catch (e) {
    return {};
  }
}

/**
 * Source roots to scan — project.sourceRoots from config, falling back to
 * ["src"] like update-structure.js. Only roots that exist are returned.
 */
function getSourceRoots(rootDir, project) {
  const configured = Array.isArray(project.sourceRoots) && project.sourceRoots.length > 0
    ? project.sourceRoots
    : ['src'];
  return configured.filter((root) => {
    try { return fs.statSync(path.join(rootDir, root)).isDirectory(); } catch (e) { return false; }
  });
}

/**
 * Simple .gitignore subset (mirrors update-structure.js): bare directory
 * names match anywhere, anchored entries match repo-relative. Wildcards and
 * negations are skipped — a pragmatic filter, not a gitignore engine.
 */
function loadGitignoreDirs(rootDir) {
  const names = new Set();
  const paths = new Set();
  let lines = [];
  try {
    lines = fs.readFileSync(path.join(rootDir, '.gitignore'), 'utf-8').split('\n');
  } catch (e) {
    return { names, paths };
  }
  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#') || line.startsWith('!') || line.includes('*')) continue;
    line = line.replace(/\/+$/, '');
    if (line.startsWith('/')) paths.add(line.slice(1));
    else if (!line.includes('/')) names.add(line);
    else paths.add(line);
  }
  return { names, paths };
}

/** POSIX-normalized repo-relative id — forward slashes on every platform. */
function toFileId(rootDir, absPath) {
  return path.relative(rootDir, absPath).split(path.sep).join('/');
}

/**
 * Walk the detected source roots and classify every parseable file by
 * grammar. Returns everything the worker needs plus honest degradation info:
 *
 *   { status: 'ok' | 'no-languages',
 *     files: [{ abs, id, grammar, size }],
 *     capsHit: [string], skippedLanguages: [string], sourceRoots: [string] }
 */
function collectSourceFiles(rootDir) {
  const project = loadProjectConfig(rootDir);
  const languages = Array.isArray(project.languages) ? project.languages : [];

  // Detection found nothing → say so, never guess (degradation matrix).
  if (languages.length === 0) {
    return { status: 'no-languages', files: [], capsHit: [], skippedLanguages: [], sourceRoots: [] };
  }

  // Merge extension maps of every detected language; unknown languages are
  // recorded, not silently dropped.
  const extToGrammar = new Map();
  const skippedLanguages = [];
  for (const lang of languages) {
    const map = LANGUAGE_EXT_GRAMMARS[lang];
    if (!map) {
      skippedLanguages.push(lang);
      continue;
    }
    for (const [ext, grammar] of Object.entries(map)) extToGrammar.set(ext, grammar);
  }

  const files = [];
  const capsHit = new Set();
  const ignore = loadGitignoreDirs(rootDir);
  const sourceRoots = getSourceRoots(rootDir, project);

  function isIgnoredDir(name, relPath) {
    return DEFAULT_IGNORED_DIRS.has(name) || ignore.names.has(name) || ignore.paths.has(relPath);
  }

  function walk(dir, depth) {
    if (depth > MAX_GRAPH_DEPTH) {
      capsHit.add(`depth cap (${MAX_GRAPH_DEPTH}) hit at ${toFileId(rootDir, dir)} — deeper files skipped`);
      return;
    }
    let items;
    try {
      items = fs.readdirSync(dir);
    } catch (e) {
      return;
    }
    for (const item of items) {
      if (files.length >= MAX_GRAPH_FILES) {
        capsHit.add(`file cap (${MAX_GRAPH_FILES}) hit — remaining files skipped`);
        return;
      }
      const fullPath = path.join(dir, item);
      let stat;
      try {
        stat = fs.lstatSync(fullPath);
      } catch (e) {
        continue;
      }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        const relPath = toFileId(rootDir, fullPath);
        if (item.startsWith('.') || isIgnoredDir(item, relPath)) continue;
        walk(fullPath, depth + 1);
      } else {
        const ext = path.extname(item);
        const grammar = extToGrammar.get(ext);
        if (!grammar) continue;
        if (stat.size > MAX_FILE_SIZE) {
          capsHit.add(`size cap (>${Math.round(MAX_FILE_SIZE / 1024)} KB) — skipped ${toFileId(rootDir, fullPath)}`);
          continue;
        }
        files.push({ abs: fullPath, id: toFileId(rootDir, fullPath), grammar, size: stat.size });
      }
    }
  }

  for (const root of sourceRoots) {
    walk(root === '.' ? rootDir : path.join(rootDir, root), 0);
  }

  return {
    status: 'ok',
    files,
    capsHit: [...capsHit],
    skippedLanguages,
    sourceRoots
  };
}

/**
 * Resolve a raw import specifier to a known file id where possible.
 * JS-style relative specifiers are resolved against the importing file and
 * matched against the walked file set (with the usual extension / index
 * fallbacks); Python dotted/relative imports get a module-path attempt.
 * Anything unresolvable (external packages, stdlib) keeps its raw
 * specifier — plan: unresolved targets are kept, not dropped.
 */
function resolveImport(fromId, rawTarget, fileIds, grammar) {
  if (grammar === 'python') {
    return resolvePythonImport(fromId, rawTarget, fileIds) || rawTarget;
  }
  if (!rawTarget.startsWith('./') && !rawTarget.startsWith('../')) {
    return rawTarget;
  }
  const baseDir = path.posix.dirname(fromId);
  const joined = path.posix.normalize(path.posix.join(baseDir, rawTarget));
  if (fileIds.has(joined)) return joined;
  const candidates = [
    '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.py', '.go', '.rs'
  ].flatMap((ext) => [`${joined}${ext}`, `${joined}/index${ext}`]);
  for (const candidate of candidates) {
    if (fileIds.has(candidate)) return candidate;
  }
  return rawTarget;
}

/**
 * Python import → file id: "pkg.mod" tries pkg/mod.py from the repo root,
 * ".sibling" / "..pkg.mod" resolve dot-relative to the importing file's
 * package. Returns null when nothing in the walked set matches.
 */
function resolvePythonImport(fromId, target, fileIds) {
  let base = '';
  let rest = target;
  const relative = target.match(/^(\.+)(.*)$/);
  if (relative) {
    let dir = path.posix.dirname(fromId);
    for (let i = 1; i < relative[1].length; i++) dir = path.posix.dirname(dir);
    base = dir === '.' ? '' : dir;
    rest = relative[2];
  }
  const relPath = rest ? rest.split('.').join('/') : '';
  const joined = base ? (relPath ? `${base}/${relPath}` : base) : relPath;
  if (!joined) return null;
  for (const candidate of [`${joined}.py`, `${joined}/__init__.py`]) {
    if (fileIds.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Assemble the final graph from the worker's per-file parse results and
 * write .frame/graph/graph.json + meta.json atomically-ish (temp + rename).
 *
 * parsedFiles: [{ id, grammar, symbols: [{name, kind, line}], imports: [raw] }]
 * info: the collectSourceFiles() result (caps/skips/roots)
 * extras: { status?, error?, durationMs? } — worker-level meta overrides
 */
function writeGraph(rootDir, parsedFiles, info, extras = {}) {
  const fileIds = new Set(parsedFiles.map((f) => f.id));

  const graph = {
    version: GRAPH_VERSION,
    nodes: {
      files: parsedFiles.map((f) => ({ id: f.id, lang: f.grammar, symbols: f.symbols }))
    },
    edges: {
      imports: parsedFiles.flatMap((f) =>
        f.imports.map((raw) => ({ from: f.id, to: resolveImport(f.id, raw, fileIds, f.grammar) }))
      )
    }
  };

  const meta = {
    version: GRAPH_VERSION,
    status: extras.status || 'built',
    builtAt: new Date().toISOString(),
    engine: 'web-tree-sitter',
    languages: [...new Set(parsedFiles.map((f) => f.grammar))],
    skippedLanguages: info.skippedLanguages,
    sourceRoots: info.sourceRoots,
    counts: {
      files: graph.nodes.files.length,
      symbols: graph.nodes.files.reduce((n, f) => n + f.symbols.length, 0),
      imports: graph.edges.imports.length
    },
    capsHit: info.capsHit,
    durationMs: extras.durationMs,
    error: extras.error || null
  };

  writeGraphFiles(rootDir, graph, meta);
  return meta;
}

/**
 * Write only meta.json (no graph) — used for the degraded outcomes
 * ('no-languages', 'error') so the UI and graph-query can say why.
 */
function writeMetaOnly(rootDir, status, info, extras = {}) {
  const meta = {
    version: GRAPH_VERSION,
    status,
    builtAt: new Date().toISOString(),
    engine: 'web-tree-sitter',
    languages: [],
    skippedLanguages: (info && info.skippedLanguages) || [],
    sourceRoots: (info && info.sourceRoots) || [],
    counts: { files: 0, symbols: 0, imports: 0 },
    capsHit: (info && info.capsHit) || [],
    durationMs: extras.durationMs,
    error: extras.error || null
  };
  writeGraphFiles(rootDir, null, meta);
  return meta;
}

/** Shared writer: mkdir -p .frame/graph, temp-file + rename per artifact. */
function writeGraphFiles(rootDir, graph, meta) {
  const graphDir = path.join(rootDir, '.frame', GRAPH_DIR);
  fs.mkdirSync(graphDir, { recursive: true });

  if (graph) {
    const graphPath = path.join(graphDir, 'graph.json');
    fs.writeFileSync(`${graphPath}.tmp`, JSON.stringify(graph, null, 2) + '\n');
    fs.renameSync(`${graphPath}.tmp`, graphPath);
  }
  const metaPath = path.join(graphDir, 'meta.json');
  fs.writeFileSync(`${metaPath}.tmp`, JSON.stringify(meta, null, 2) + '\n');
  fs.renameSync(`${metaPath}.tmp`, metaPath);
}

module.exports = {
  GRAPH_VERSION,
  GRAPH_DIR,
  MAX_GRAPH_FILES,
  MAX_GRAPH_DEPTH,
  MAX_FILE_SIZE,
  TIME_BUDGET_MS,
  LANGUAGE_EXT_GRAMMARS,
  collectSourceFiles,
  resolveImport,
  writeGraph,
  writeMetaOnly
};
