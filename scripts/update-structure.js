#!/usr/bin/env node
/**
 * STRUCTURE.json Auto-Updater
 *
 * Parses source files (per-language extractors in scripts/lang/) and updates
 * STRUCTURE.json with module info.
 * Can run in full mode (all files) or incremental mode (changed files only).
 *
 * Usage:
 *   node scripts/update-structure.js              # Full update
 *   node scripts/update-structure.js --changed    # Only git staged changes
 *   node scripts/update-structure.js --check      # Would a regen change anything? (writes nothing; exit 0/1/2)
 *   node scripts/update-structure.js file1.js file2.js  # Specific files
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// FRAME_PROJECT_ROOT lets the same script run from .frame/bin/ inside a user
// project. Frame's own pre-commit hook doesn't set it, so behavior is identical
// to before; only callers who explicitly opt in get the override.
const ROOT_DIR = process.env.FRAME_PROJECT_ROOT
  ? path.resolve(process.env.FRAME_PROJECT_ROOT)
  : path.join(__dirname, '..');
const STRUCTURE_FILE = path.join(ROOT_DIR, 'STRUCTURE.json');
const SRC_DIR = path.join(ROOT_DIR, 'src');

// Directories never scanned for source files, regardless of .gitignore.
const DEFAULT_IGNORED_DIRS = new Set([
  'node_modules', 'vendor', '.venv', 'venv', 'target', 'dist', 'build',
  '.git', '__pycache__', '.next', '.turbo', 'coverage', '.frame'
]);
// Degradation caps: a pathological tree (huge vendored dir the ignores miss,
// deep generated nesting) warns and stops instead of hanging.
const MAX_SCAN_DEPTH = 12;
const MAX_SCAN_FILES = 5000;

/** The `project` block of .frame/config.json (written by detect-project.js). */
function loadProjectConfig() {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, '.frame', 'config.json'), 'utf-8'));
    return config.project || {};
  } catch (e) {
    return {};
  }
}

/**
 * Source roots to scan: project.sourceRoots from .frame/config.json, falling
 * back to Frame's historical default ["src"] so a config without the block
 * behaves exactly like today. Only roots that exist on disk are returned.
 */
function getSourceRoots() {
  const project = loadProjectConfig();
  const configured = Array.isArray(project.sourceRoots) && project.sourceRoots.length > 0
    ? project.sourceRoots
    : ['src'];
  return configured.filter(root => {
    try { return fs.statSync(path.join(ROOT_DIR, root)).isDirectory(); } catch (e) { return false; }
  });
}

/**
 * Simple .gitignore subset: bare directory names ("dist") match anywhere,
 * anchored entries ("/build", "docs/out") match repo-relative. Wildcard and
 * negation lines are skipped — a pragmatic filter, not a gitignore engine.
 */
function loadGitignoreDirs() {
  const names = new Set();
  const paths = new Set();
  let lines = [];
  try {
    lines = fs.readFileSync(path.join(ROOT_DIR, '.gitignore'), 'utf-8').split('\n');
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

// Per-language extractors (scripts/lang/*). Each declares its extensions and
// extraction functions; the registry dispatches by file extension.
const EXTRACTORS = [require('./lang/javascript')];
const EXT_TO_EXTRACTOR = new Map();
for (const extractor of EXTRACTORS) {
  for (const ext of extractor.extensions) EXT_TO_EXTRACTOR.set(ext, extractor);
}

function allExtensions() {
  return [...EXT_TO_EXTRACTOR.keys()];
}

/**
 * Parse a source file with its language's extractor and build the module entry
 */
function parseSourceFile(filePath) {
  const lang = EXT_TO_EXTRACTOR.get(path.extname(filePath));
  if (!lang) return null;

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const moduleInfo = {
    file: path.relative(ROOT_DIR, filePath),
    description: lang.extractDescription(content),
    exports: lang.extractExports(content),
    depends: lang.extractDependencies(content),
    functions: {}
  };

  // Extract functions with line numbers
  const functions = lang.extractFunctions(content, lines);
  if (Object.keys(functions).length > 0) {
    moduleInfo.functions = functions;
  }

  // Extract IPC info when the language knows about it (Electron JS)
  if (lang.extractIPC) {
    const ipc = lang.extractIPC(content);
    if (ipc.listens.length > 0 || ipc.emits.length > 0) {
      moduleInfo.ipc = ipc;
    }
  }

  return moduleInfo;
}

/**
 * Get module key from file path: repo-relative, with a leading "src/"
 * stripped so the src-convention keys stay exactly what they always were.
 * Files under any other source root keep their full repo-relative path —
 * unambiguous across multiple roots (cmd/ + internal/, packages/*).
 */
function getModuleKey(filePath) {
  let relative = path.relative(ROOT_DIR, filePath).replace(/\\/g, '/');
  if (relative.startsWith('src/')) relative = relative.slice(4);
  const ext = path.extname(relative);
  return EXT_TO_EXTRACTOR.has(ext) ? relative.slice(0, -ext.length) : relative;
}

/**
 * Get list of changed JS files from git
 */
function getChangedFiles() {
  try {
    // Get staged changes
    const staged = execSync('git diff --cached --name-only --diff-filter=ACMR', {
      cwd: ROOT_DIR,
      encoding: 'utf-8'
    });

    // Get unstaged changes too
    const unstaged = execSync('git diff --name-only --diff-filter=ACMR', {
      cwd: ROOT_DIR,
      encoding: 'utf-8'
    });

    const roots = getSourceRoots();
    const inRoots = (f) => roots.some(root => root === '.' || f.startsWith(root.replace(/\\/g, '/') + '/'));
    const files = [...staged.split('\n'), ...unstaged.split('\n')]
      .filter(f => EXT_TO_EXTRACTOR.has(path.extname(f)) && inRoots(f))
      .map(f => path.join(ROOT_DIR, f));

    return [...new Set(files)];
  } catch (e) {
    console.error('Git error:', e.message);
    return [];
  }
}

/**
 * Walk the configured source roots collecting source files.
 * Skips the built-in ignore set plus simple .gitignore entries and hidden
 * dirs, never follows symlinks (cycles, out-of-repo trees), and caps
 * depth/file count with a warning instead of hanging on pathological trees.
 */
function getAllSourceFiles(extensions = allExtensions()) {
  const files = [];
  const seen = new Set();
  const ignore = loadGitignoreDirs();
  const warnings = new Set();

  function isIgnoredDir(name, relPath) {
    return DEFAULT_IGNORED_DIRS.has(name) || ignore.names.has(name) || ignore.paths.has(relPath);
  }

  function walk(dir, depth) {
    if (depth > MAX_SCAN_DEPTH) {
      warnings.add(`depth cap (${MAX_SCAN_DEPTH}) hit at ${path.relative(ROOT_DIR, dir)} — deeper files skipped`);
      return;
    }
    let items;
    try {
      items = fs.readdirSync(dir);
    } catch (e) {
      return;
    }
    for (const item of items) {
      if (files.length >= MAX_SCAN_FILES) {
        warnings.add(`file cap (${MAX_SCAN_FILES}) hit — remaining files skipped`);
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
        const relPath = path.relative(ROOT_DIR, fullPath).replace(/\\/g, '/');
        if (item.startsWith('.') || isIgnoredDir(item, relPath)) continue;
        walk(fullPath, depth + 1);
      } else if (extensions.some(ext => item.endsWith(ext)) && !seen.has(fullPath)) {
        seen.add(fullPath);
        files.push(fullPath);
      }
    }
  }

  for (const root of getSourceRoots()) {
    walk(root === '.' ? ROOT_DIR : path.join(ROOT_DIR, root), 0);
  }
  for (const w of warnings) console.warn(`⚠ ${w}`);
  return files;
}

/**
 * Load existing STRUCTURE.json
 */
function loadStructure() {
  try {
    return JSON.parse(fs.readFileSync(STRUCTURE_FILE, 'utf-8'));
  } catch (e) {
    // Return minimal structure if file doesn't exist
    return {
      version: "1.0",
      description: "Auto-generated module structure",
      lastUpdated: new Date().toISOString().split('T')[0],
      architecture: {},
      modules: {},
      ipcChannels: {},
      dataFlow: [],
      files: {},
      conventions: {}
    };
  }
}

/**
 * Remove modules whose file no longer exists on disk.
 * Runs in every mode so deletions are reconciled even when they never hit
 * the staged diff (the phantom-module class of bug).
 */
function reconcileDeletedModules(structure, quiet) {
  let removed = 0;
  for (const [key, mod] of Object.entries(structure.modules)) {
    const file = mod.file || path.join('src', `${key}.js`);
    if (!fs.existsSync(path.join(ROOT_DIR, file))) {
      delete structure.modules[key];
      if (!quiet) console.log(`  - Removed (missing on disk): ${key}`);
      removed++;
    }
  }
  return removed;
}

/**
 * Return a copy of an object with keys sorted alphabetically
 */
function sortKeys(obj) {
  const sorted = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return sorted;
}

/**
 * Normalize a structure for output: sorted modules, and architectureNotes —
 * hand-written insight — preserved verbatim when present, omitted entirely
 * when empty (never emit an empty object that looks populated).
 */
function normalizeStructure(structure) {
  structure.modules = sortKeys(structure.modules);
  if (structure.architectureNotes && Object.keys(structure.architectureNotes).length === 0) {
    delete structure.architectureNotes;
  }
}

/**
 * Save STRUCTURE.json.
 * Modules are sorted for stable output, and lastUpdated is only bumped when
 * content actually changed — a regen on an unchanged tree is byte-identical.
 */
function saveStructure(structure) {
  normalizeStructure(structure);

  let previous = null;
  try {
    previous = JSON.parse(fs.readFileSync(STRUCTURE_FILE, 'utf-8'));
  } catch (e) {
    // No existing file — treat as changed
  }

  const withoutTimestamp = (s) => JSON.stringify({ ...s, lastUpdated: undefined });
  if (previous && withoutTimestamp(previous) === withoutTimestamp(structure)) {
    structure.lastUpdated = previous.lastUpdated;
  } else {
    structure.lastUpdated = new Date().toISOString().split('T')[0];
  }

  fs.writeFileSync(STRUCTURE_FILE, JSON.stringify(structure, null, 2) + '\n');
  console.log(`✓ Updated STRUCTURE.json (${Object.keys(structure.modules).length} modules)`);
}

/**
 * Parse all IPC channels from ipcChannels.js and sync into STRUCTURE.json
 * Preserves existing rich data (direction, payload, description) for known channels.
 * Adds skeleton entries for new channels discovered in ipcChannels.js.
 */
function syncIPCChannels(structure, quiet) {
  const ipcFile = path.join(SRC_DIR, 'shared', 'ipcChannels.js');
  if (!fs.existsSync(ipcFile)) return;

  const content = fs.readFileSync(ipcFile, 'utf-8');

  // Extract all KEY: 'value' pairs from the IPC object
  const channelMap = {}; // KEY → 'channel-string'
  const matches = content.matchAll(/^\s+(\w+):\s*'([^']+)'/gm);
  for (const match of matches) {
    channelMap[match[1]] = match[2];
  }

  const totalChannels = Object.keys(channelMap).length;

  // Group channel keys by category prefix
  const categoryRules = [
    { prefix: ['TERMINAL_CREATE', 'TERMINAL_CREATED', 'TERMINAL_DESTROY', 'TERMINAL_DESTROYED', 'TERMINAL_INPUT_ID', 'TERMINAL_OUTPUT_ID', 'TERMINAL_RESIZE_ID', 'TERMINAL_FOCUS', 'GET_AVAILABLE_SHELLS', 'AVAILABLE_SHELLS_DATA'], category: 'multiTerminal' },
    { prefix: ['START_TERMINAL', 'RESTART_TERMINAL', 'TERMINAL_INPUT', 'TERMINAL_OUTPUT', 'TERMINAL_RESIZE'], category: 'terminal' },
    { prefix: ['SELECT_PROJECT_FOLDER', 'CREATE_NEW_PROJECT', 'PROJECT_SELECTED'], category: 'project' },
    { prefix: ['LOAD_FILE_TREE', 'FILE_TREE_DATA'], category: 'fileTree' },
    { prefix: ['LOAD_PROMPT_HISTORY', 'PROMPT_HISTORY_DATA', 'TOGGLE_HISTORY_PANEL'], category: 'history' },
    { prefix: ['RUN_COMMAND'], category: 'commands' },
    { prefix: ['LOAD_WORKSPACE', 'WORKSPACE_DATA', 'WORKSPACE_UPDATED', 'ADD_PROJECT_TO_WORKSPACE', 'REMOVE_PROJECT_FROM_WORKSPACE'], category: 'workspace' },
    { prefix: ['INITIALIZE_FRAME_PROJECT', 'FRAME_PROJECT_INITIALIZED', 'CHECK_IS_FRAME_PROJECT', 'IS_FRAME_PROJECT_RESULT', 'GET_FRAME_CONFIG', 'FRAME_CONFIG_DATA'], category: 'frame' },
    { prefix: ['READ_FILE', 'FILE_CONTENT', 'WRITE_FILE', 'FILE_SAVED'], category: 'editor' },
    { prefix: ['LOAD_TASKS', 'TASKS_DATA', 'ADD_TASK', 'UPDATE_TASK', 'DELETE_TASK', 'TASK_UPDATED', 'TOGGLE_TASKS_PANEL'], category: 'tasks' },
    { prefix: ['LOAD_PLUGINS', 'PLUGINS_DATA', 'TOGGLE_PLUGIN', 'PLUGIN_TOGGLED', 'TOGGLE_PLUGINS_PANEL', 'REFRESH_PLUGINS'], category: 'plugins' },
    { prefix: ['LOAD_CLAUDE_SESSIONS', 'REFRESH_CLAUDE_SESSIONS'], category: 'claudeSessions' },
    { prefix: ['LOAD_GITHUB_ISSUES', 'GITHUB_ISSUES_DATA', 'TOGGLE_GITHUB_PANEL', 'OPEN_GITHUB_ISSUE'], category: 'github' },
    { prefix: ['LOAD_CLAUDE_USAGE', 'CLAUDE_USAGE_DATA', 'REFRESH_CLAUDE_USAGE'], category: 'claudeUsage' },
    { prefix: ['LOAD_OVERVIEW', 'OVERVIEW_DATA', 'GET_FILE_GIT_HISTORY'], category: 'overview' },
    { prefix: ['LOAD_GIT_BRANCHES', 'SWITCH_GIT_BRANCH', 'CREATE_GIT_BRANCH', 'DELETE_GIT_BRANCH', 'LOAD_GIT_WORKTREES', 'ADD_GIT_WORKTREE', 'REMOVE_GIT_WORKTREE', 'TOGGLE_GIT_BRANCHES_PANEL'], category: 'gitBranches' },
    { prefix: ['GET_AI_TOOL_CONFIG', 'AI_TOOL_CONFIG_DATA', 'SET_AI_TOOL', 'AI_TOOL_CHANGED'], category: 'aiTool' },
  ];

  // Build lookup: KEY → category
  const keyToCategory = {};
  for (const rule of categoryRules) {
    for (const key of rule.prefix) {
      keyToCategory[key] = rule.category;
    }
  }

  // Build new ipcChannels, preserving existing rich data
  const existing = structure.ipcChannels || {};
  const updated = {};

  // Seed updated with all existing categories/channels
  for (const [cat, channels] of Object.entries(existing)) {
    updated[cat] = { ...channels };
  }

  // Add any missing channels from ipcChannels.js
  let added = 0;
  for (const [key, value] of Object.entries(channelMap)) {
    const category = keyToCategory[key] || 'other';
    if (!updated[category]) updated[category] = {};

    if (!updated[category][key]) {
      updated[category][key] = {
        name: value,
        direction: '',
        description: ''
      };
      added++;
    }
  }

  structure.ipcChannels = updated;

  const total = Object.values(updated).reduce((sum, cat) => sum + Object.keys(cat).length, 0);
  if (!quiet) console.log(`  ✓ IPC channels: ${total} total (${added} new) — parsed from ipcChannels.js`);
}

/**
 * Parse the given files into structure.modules (preserving manual
 * descriptions when the auto-extracted one is empty)
 */
function processFiles(structure, files, quiet) {
  for (const file of files) {
    try {
      const moduleInfo = parseSourceFile(file);
      if (!moduleInfo) continue; // No extractor for this extension
      const moduleKey = getModuleKey(file);

      const existing = structure.modules[moduleKey] || {};
      structure.modules[moduleKey] = {
        ...moduleInfo,
        description: moduleInfo.description || existing.description || ''
      };

      if (!quiet) console.log(`  ✓ ${moduleKey}`);
    } catch (e) {
      if (!quiet) console.error(`  ✗ ${file}: ${e.message}`);
    }
  }
}

/**
 * --check: report whether a full regen would change STRUCTURE.json
 * (ignoring lastUpdated) without writing anything. Exit 0 = in sync,
 * 1 = out of date, 2 = cannot check. Lets check-freshness.js and
 * find-module.js confirm date-based drift suspicion against actual
 * content, so merges/reverts that changed no module content don't
 * produce false staleness warnings.
 */
function runCheck() {
  if (!fs.existsSync(STRUCTURE_FILE)) {
    console.log('STRUCTURE.json missing — run: npm run structure');
    process.exit(2);
  }

  const current = loadStructure();
  const rebuilt = JSON.parse(JSON.stringify(current));

  reconcileDeletedModules(rebuilt, true);
  processFiles(rebuilt, getAllSourceFiles(), true);
  syncIPCChannels(rebuilt, true);
  generateIntentIndex(rebuilt);
  normalizeStructure(rebuilt);

  const withoutTimestamp = (s) => JSON.stringify({ ...s, lastUpdated: undefined });
  if (withoutTimestamp(current) === withoutTimestamp(rebuilt)) {
    console.log('STRUCTURE.json is in sync with src/.');
    process.exit(0);
  }
  console.log('STRUCTURE.json is out of date — run: npm run structure');
  process.exit(1);
}

/**
 * Main function
 */
function main() {
  const args = process.argv.slice(2);

  if (args.includes('--check')) {
    runCheck();
    return;
  }

  const structure = loadStructure();

  let filesToProcess = [];
  let mode = 'full';

  // Reconcile deletions against the disk in every mode, so a phantom module
  // never survives just because its deletion wasn't in the staged diff.
  const removedCount = reconcileDeletedModules(structure);

  if (args.includes('--changed')) {
    // Incremental mode: only changed files
    mode = 'incremental';
    filesToProcess = getChangedFiles();

    if (filesToProcess.length === 0 && removedCount === 0) {
      console.log('No JS changes detected.');
      return;
    }
  } else if (args.length > 0 && !args[0].startsWith('--')) {
    // Specific files mode
    mode = 'specific';
    filesToProcess = args.map(f => path.resolve(ROOT_DIR, f)).filter(f => fs.existsSync(f));
  } else {
    // Full mode: all files
    mode = 'full';
    filesToProcess = getAllSourceFiles();
    if (filesToProcess.length === 0) {
      console.warn('⚠ No source files found — review project.sourceRoots in .frame/config.json (regenerate it with detect-project.js).');
    }
  }

  console.log(`Mode: ${mode}, Processing ${filesToProcess.length} file(s)...`);

  processFiles(structure, filesToProcess, false);

  // Sync IPC channels from ipcChannels.js
  syncIPCChannels(structure);

  // Generate intent index from modules
  generateIntentIndex(structure);

  saveStructure(structure);
}

/**
 * Load the curated concept→modules map (agent-editable).
 * Lives next to this script so it works both in Frame's repo (scripts/) and
 * in user projects (.frame/bin/). Missing file → pure auto-grouping.
 */
function loadIntentMap() {
  try {
    const map = JSON.parse(fs.readFileSync(path.join(__dirname, 'intent-map.json'), 'utf-8'));
    delete map._comment;
    return map;
  } catch (e) {
    return {};
  }
}

/**
 * Generate intentIndex: curated concepts from intent-map.json first, then
 * auto-grouping by stripped filename suffix — but only for groups spanning
 * ≥ 2 files. Thin single-file intents are dropped; find-module.js's deep
 * search over module keys/descriptions still finds them.
 */
function generateIntentIndex(structure) {
  const modules = structure.modules;
  const intentMap = loadIntentMap();
  const groups = {};
  const claimed = new Set();

  const toEntry = (key) => ({
    module: key,
    file: modules[key].file,
    description: modules[key].description || ''
  });

  // 1. Curated concepts — skip module keys that no longer exist
  for (const [concept, entry] of Object.entries(intentMap)) {
    const mods = (entry.modules || []).filter(key => modules[key]);
    if (mods.length === 0) continue;
    groups[concept] = mods.map(toEntry);
    mods.forEach(key => claimed.add(key));
  }

  // 2. Auto-group unclaimed modules by stripped suffix
  const suffixes = ['Manager', 'Panel', 'UI', 'Selector', 'TabBar', 'Grid'];
  const autoGroups = {};

  for (const [key] of Object.entries(modules)) {
    if (claimed.has(key)) continue;

    const baseName = key.split('/').pop();
    let intentName = baseName;
    for (const suffix of suffixes) {
      if (intentName.endsWith(suffix) && intentName.length > suffix.length) {
        intentName = intentName.slice(0, -suffix.length);
        break;
      }
    }
    intentName = intentName.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();

    // A curated concept owns its name — an unclaimed module that happens to
    // strip to the same name stays out (deep search still finds it)
    if (groups[intentName]) continue;

    if (!autoGroups[intentName]) autoGroups[intentName] = [];
    autoGroups[intentName].push(toEntry(key));
  }

  for (const [name, mods] of Object.entries(autoGroups)) {
    if (mods.length >= 2) {
      groups[name] = mods;
    }
  }

  // Sort groups alphabetically and sort modules within each group
  const sorted = {};
  for (const key of Object.keys(groups).sort()) {
    sorted[key] = groups[key].sort((a, b) => a.module.localeCompare(b.module));
  }

  structure.intentIndex = sorted;
}

main();
