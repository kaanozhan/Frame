#!/usr/bin/env node
/**
 * STRUCTURE.json Auto-Updater
 *
 * Parses JS files and updates STRUCTURE.json with module info.
 * Can run in full mode (all files) or incremental mode (changed files only).
 *
 * Usage:
 *   node scripts/update-structure.js              # Full update
 *   node scripts/update-structure.js --changed    # Only git staged changes
 *   node scripts/update-structure.js file1.js file2.js  # Specific files
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const STRUCTURE_FILE = path.join(ROOT_DIR, 'STRUCTURE.json');
const SRC_DIR = path.join(ROOT_DIR, 'src');

/**
 * Parse a JS file and extract module information
 */
function parseJSFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const moduleInfo = {
    file: path.relative(ROOT_DIR, filePath),
    description: extractDescription(content),
    exports: extractExports(content),
    depends: extractDependencies(content),
    functions: {}
  };

  // Extract functions with line numbers
  const functions = extractFunctions(content, lines);
  if (Object.keys(functions).length > 0) {
    moduleInfo.functions = functions;
  }

  // Extract IPC info if relevant
  const ipc = extractIPC(content);
  if (ipc.listens.length > 0 || ipc.emits.length > 0) {
    moduleInfo.ipc = ipc;
  }

  return moduleInfo;
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
 * Extract module.exports
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

  return exports;
}

/**
 * Extract require() dependencies
 */
function extractDependencies(content) {
  const deps = [];
  const matches = content.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g);

  for (const match of matches) {
    const dep = match[1];
    // Convert relative paths to module names
    if (dep.startsWith('./') || dep.startsWith('../')) {
      // Convert to module path format
      const normalized = dep.replace(/^\.\.?\//, '').replace(/\.js$/, '');
      deps.push(normalized);
    } else {
      // External module
      deps.push(dep);
    }
  }

  return [...new Set(deps)]; // Remove duplicates
}

/**
 * Extract function definitions with line numbers
 */
function extractFunctions(content, lines) {
  const functions = {};

  // Match function declarations: function name(params) {
  const funcRegex = /^(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/gm;
  let match;

  while ((match = funcRegex.exec(content)) !== null) {
    const name = match[1];
    const params = match[2].split(',').map(p => p.trim()).filter(p => p);
    const lineNum = content.substring(0, match.index).split('\n').length;

    // Try to extract purpose from preceding comment
    const purpose = extractFunctionPurpose(lines, lineNum - 1);

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
  }

  // Match const name = function(params) or const name = (params) =>
  const constFuncRegex = /^(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function\s*)?\(([^)]*)\)\s*(?:=>)?\s*[{]/gm;

  while ((match = constFuncRegex.exec(content)) !== null) {
    const name = match[1];
    if (functions[name]) continue; // Skip if already found

    const params = match[2].split(',').map(p => p.trim()).filter(p => p);
    const lineNum = content.substring(0, match.index).split('\n').length;
    const purpose = extractFunctionPurpose(lines, lineNum - 1);

    functions[name] = {
      line: lineNum,
      params: params.length > 0 ? params : undefined,
      purpose: purpose || undefined
    };

    Object.keys(functions[name]).forEach(key => {
      if (functions[name][key] === undefined) {
        delete functions[name][key];
      }
    });
  }

  return functions;
}

/**
 * Extract function purpose from preceding comment
 */
function extractFunctionPurpose(lines, lineIndex) {
  // Look at previous lines for JSDoc or single-line comment
  for (let i = lineIndex - 1; i >= Math.max(0, lineIndex - 5); i--) {
    const line = lines[i].trim();

    // JSDoc @description or first line after /**
    if (line.startsWith('*') && !line.startsWith('*/') && !line.startsWith('/**')) {
      const text = line.replace(/^\*\s*/, '').trim();
      if (text && !text.startsWith('@')) {
        return text;
      }
    }

    // Single line comment
    if (line.startsWith('//')) {
      return line.replace(/^\/\/\s*/, '').trim();
    }

    // Stop if we hit code
    if (line && !line.startsWith('*') && !line.startsWith('/')) {
      break;
    }
  }

  return null;
}

/**
 * Extract IPC channel usage
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

/**
 * Get module key from file path
 */
function getModuleKey(filePath) {
  const relative = path.relative(SRC_DIR, filePath);
  return relative.replace(/\.js$/, '').replace(/\\/g, '/');
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

    const files = [...staged.split('\n'), ...unstaged.split('\n')]
      .filter(f => f.endsWith('.js') && f.startsWith('src/'))
      .map(f => path.join(ROOT_DIR, f));

    return [...new Set(files)];
  } catch (e) {
    console.error('Git error:', e.message);
    return [];
  }
}

/**
 * Get list of deleted JS files from git
 */
function getDeletedFiles() {
  try {
    const deleted = execSync('git diff --cached --name-only --diff-filter=D', {
      cwd: ROOT_DIR,
      encoding: 'utf-8'
    });

    return deleted.split('\n')
      .filter(f => f.endsWith('.js') && f.startsWith('src/'));
  } catch (e) {
    return [];
  }
}

/**
 * Get all JS files in src directory
 */
function getAllJSFiles(dir = SRC_DIR) {
  const files = [];

  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...getAllJSFiles(fullPath));
    } else if (item.endsWith('.js')) {
      files.push(fullPath);
    }
  }

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
 * Save STRUCTURE.json
 */
function saveStructure(structure) {
  structure.lastUpdated = new Date().toISOString().split('T')[0];
  fs.writeFileSync(STRUCTURE_FILE, JSON.stringify(structure, null, 2) + '\n');
  console.log(`✓ Updated STRUCTURE.json (${Object.keys(structure.modules).length} modules)`);
}

/**
 * Parse all IPC channels from ipcChannels.js and sync into STRUCTURE.json
 * Preserves existing rich data (direction, payload, description) for known channels.
 * Adds skeleton entries for new channels discovered in ipcChannels.js.
 */
function syncIPCChannels(structure) {
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
  console.log(`  ✓ IPC channels: ${total} total (${added} new) — parsed from ipcChannels.js`);
}

/**
 * Main function
 */
function main() {
  const args = process.argv.slice(2);
  const structure = loadStructure();

  let filesToProcess = [];
  let mode = 'full';

  if (args.includes('--changed')) {
    // Incremental mode: only changed files
    mode = 'incremental';
    filesToProcess = getChangedFiles();

    // Handle deleted files
    const deleted = getDeletedFiles();
    for (const file of deleted) {
      const key = getModuleKey(path.join(ROOT_DIR, file));
      if (structure.modules[key]) {
        delete structure.modules[key];
        console.log(`- Removed: ${key}`);
      }
    }

    if (filesToProcess.length === 0 && deleted.length === 0) {
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
    filesToProcess = getAllJSFiles();
  }

  console.log(`Mode: ${mode}, Processing ${filesToProcess.length} file(s)...`);

  for (const file of filesToProcess) {
    try {
      const moduleKey = getModuleKey(file);
      const moduleInfo = parseJSFile(file);

      // Preserve manually added fields (like detailed descriptions)
      const existing = structure.modules[moduleKey] || {};
      structure.modules[moduleKey] = {
        ...moduleInfo,
        // Keep manual description if auto-extracted is empty
        description: moduleInfo.description || existing.description || ''
      };

      console.log(`  ✓ ${moduleKey}`);
    } catch (e) {
      console.error(`  ✗ ${file}: ${e.message}`);
    }
  }

  // Sync IPC channels from ipcChannels.js
  syncIPCChannels(structure);

  // Generate intent index from modules
  generateIntentIndex(structure);

  saveStructure(structure);
}

/**
 * Generate intentIndex from module keys
 * Groups related modules by feature name (e.g. githubManager + githubPanel → "github")
 */
function generateIntentIndex(structure) {
  const modules = structure.modules;
  const groups = {};

  // Suffixes to strip for grouping
  const suffixes = ['Manager', 'Panel', 'UI', 'Selector', 'TabBar', 'Grid'];

  // Special aliases: module base name → intent name
  const aliases = {
    'pty': 'terminal',
    'ptyManager': 'terminal',
    'terminal': 'terminal',
    'terminalManager': 'terminal',
    'terminalGrid': 'terminal',
    'terminalTabBar': 'terminal',
    'multiTerminalUI': 'terminal',
    'promptLogger': 'history',
    'historyPanel': 'history',
    'fileTree': 'file-tree',
    'fileTreeUI': 'file-tree',
    'ipcChannels': 'ipc',
    'frameConstants': 'frame-config',
    'frameTemplates': 'frame-config',
    'frameProject': 'frame-config',
    'sidebarResize': 'sidebar',
    'projectListUI': 'sidebar',
    'structureMap': 'structure',
    'claudeUsageManager': 'claude-usage',
    'claudeSessionsManager': 'claude-sessions',
    'gitBranchesManager': 'git-branches',
    'aiToolManager': 'ai-tool',
    'aiToolSelector': 'ai-tool'
  };

  for (const [key, mod] of Object.entries(modules)) {
    const parts = key.split('/');
    const baseName = parts[parts.length - 1]; // e.g. "githubManager"

    let intentName;

    // Check aliases first
    if (aliases[baseName]) {
      intentName = aliases[baseName];
    } else {
      // Strip known suffixes to get the feature name
      intentName = baseName;
      for (const suffix of suffixes) {
        if (intentName.endsWith(suffix) && intentName.length > suffix.length) {
          intentName = intentName.slice(0, -suffix.length);
          break;
        }
      }
      // Convert camelCase to kebab-case
      intentName = intentName.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
    }

    if (!groups[intentName]) {
      groups[intentName] = [];
    }

    groups[intentName].push({
      module: key,
      file: mod.file,
      description: mod.description || ''
    });
  }

  // Sort groups alphabetically and sort modules within each group
  const sorted = {};
  for (const key of Object.keys(groups).sort()) {
    sorted[key] = groups[key].sort((a, b) => a.module.localeCompare(b.module));
  }

  structure.intentIndex = sorted;
}

main();
