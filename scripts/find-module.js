#!/usr/bin/env node
/**
 * Module Finder — Fast file lookup using STRUCTURE.json intentIndex
 *
 * Usage:
 *   node scripts/find-module.js <keyword>      # Search by feature/concept
 *   node scripts/find-module.js --list          # List all features
 *
 * Examples:
 *   node scripts/find-module.js github
 *   node scripts/find-module.js terminal
 *   node scripts/find-module.js tasks
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

// FRAME_PROJECT_ROOT lets the same script run from .frame/bin/ inside a user
// project. Frame's own callers don't set it — behavior is unchanged.
const ROOT_DIR = process.env.FRAME_PROJECT_ROOT
  ? path.resolve(process.env.FRAME_PROJECT_ROOT)
  : path.join(__dirname, '..');
const STRUCTURE_FILE = path.join(ROOT_DIR, 'STRUCTURE.json');

function loadStructure() {
  try {
    return JSON.parse(fs.readFileSync(STRUCTURE_FILE, 'utf-8'));
  } catch (e) {
    console.error('Error: Could not read STRUCTURE.json');
    process.exit(1);
  }
}

/**
 * Load the curated concept map (synonyms live here). Sits next to this
 * script both in Frame's repo (scripts/) and user projects (.frame/bin/).
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
 * One-line warning when STRUCTURE.json is stale. The date comparison is a
 * cheap pre-filter; when it fires, update-structure.js --check confirms
 * against actual content — merges/reverts dated after lastUpdated that
 * changed no module content must not produce a banner (an idempotent regen
 * couldn't clear it).
 */
function stalenessBanner(structure) {
  try {
    const lastSrcCommit = execSync('git log -1 --format=%cs -- src', {
      cwd: ROOT_DIR,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();
    if (!(lastSrcCommit && structure.lastUpdated && structure.lastUpdated < lastSrcCommit)) {
      return null;
    }

    const checker = path.join(__dirname, 'update-structure.js');
    if (fs.existsSync(checker)) {
      const r = spawnSync('node', [checker, '--check'], {
        cwd: ROOT_DIR,
        env: { ...process.env, FRAME_PROJECT_ROOT: ROOT_DIR },
        stdio: 'ignore',
        timeout: 30000
      });
      if (r.status === 0) return null; // dates disagree, content in sync
      if (r.status === 1) {
        return '⚠ STRUCTURE.json content is out of date vs src — run: npm run structure';
      }
    }
    return `⚠ STRUCTURE.json (${structure.lastUpdated}) is older than the last src commit (${lastSrcCommit}) — run: npm run structure`;
  } catch (e) {
    // Not a git repo or git unavailable — no banner
  }
  return null;
}

/**
 * Search intentIndex for matching features
 */
function searchIntentIndex(structure, keyword) {
  const index = structure.intentIndex;
  if (!index) {
    console.error('No intentIndex found in STRUCTURE.json. Run: npm run structure');
    process.exit(1);
  }

  const kw = keyword.toLowerCase();
  const results = [];

  // 1. Exact match in intentIndex keys
  for (const [feature, modules] of Object.entries(index)) {
    if (feature === kw) {
      results.push({ feature, modules, matchType: 'exact' });
    }
  }

  // 2. Synonym match from intent-map.json (e.g. "auth" → ai-tool)
  if (results.length === 0) {
    const intentMap = loadIntentMap();
    for (const [concept, entry] of Object.entries(intentMap)) {
      const synonyms = (entry.synonyms || []).map(s => s.toLowerCase());
      if (synonyms.includes(kw) && index[concept]) {
        results.push({ feature: `${concept} (synonym: "${keyword}")`, modules: index[concept], matchType: 'synonym' });
      }
    }
  }

  // 3. Partial match in intentIndex keys
  if (results.length === 0) {
    for (const [feature, modules] of Object.entries(index)) {
      if (feature.includes(kw) || kw.includes(feature)) {
        results.push({ feature, modules, matchType: 'partial' });
      }
    }
  }

  // 4. Search in module descriptions, exports, IPC channels
  if (results.length === 0) {
    const matchedModules = [];
    for (const [key, mod] of Object.entries(structure.modules)) {
      const searchable = [
        key,
        mod.description || '',
        ...(mod.exports || []),
        ...(mod.ipc?.listens || []),
        ...(mod.ipc?.emits || [])
      ].join(' ').toLowerCase();

      if (searchable.includes(kw)) {
        matchedModules.push({
          module: key,
          file: mod.file,
          description: mod.description || ''
        });
      }
    }
    if (matchedModules.length > 0) {
      results.push({ feature: `search: "${keyword}"`, modules: matchedModules, matchType: 'deep' });
    }
  }

  return results;
}

/**
 * List all features in intentIndex
 */
function listFeatures(structure) {
  const index = structure.intentIndex;
  if (!index) {
    console.error('No intentIndex found. Run: npm run structure');
    process.exit(1);
  }

  console.log('Available features:\n');
  for (const [feature, modules] of Object.entries(index)) {
    const files = modules.map(m => m.file).join(', ');
    console.log(`  ${feature.padEnd(20)} → ${files}`);
  }
  console.log(`\nTotal: ${Object.keys(index).length} features, ${Object.values(index).flat().length} modules`);
}

/**
 * Format and print results
 */
function printResults(structure, results, keyword) {
  if (results.length === 0) {
    console.log(`No modules found for "${keyword}"`);
    console.log('Try: node scripts/find-module.js --list');
    return;
  }

  for (const result of results) {
    console.log(`Feature: ${result.feature}`);
    for (const mod of result.modules) {
      const desc = mod.description ? ` — ${mod.description}` : '';
      const missing = fs.existsSync(path.join(ROOT_DIR, mod.file))
        ? ''
        : '  ⚠ file missing on disk — run: npm run structure';
      console.log(`  ${mod.file.padEnd(42)}${desc}${missing}`);
    }

    // Show related IPC channels
    const ipcChannels = [];
    for (const mod of result.modules) {
      const modInfo = structure.modules[mod.module];
      if (modInfo?.ipc) {
        ipcChannels.push(...(modInfo.ipc.listens || []), ...(modInfo.ipc.emits || []));
      }
    }
    if (ipcChannels.length > 0) {
      console.log(`  IPC: ${[...new Set(ipcChannels)].join(', ')}`);
    }
    console.log('');
  }
}

// Main
const args = process.argv.slice(2);

if (args.length === 0) {
  console.log('Usage: node scripts/find-module.js <keyword>');
  console.log('       node scripts/find-module.js --list');
  process.exit(0);
}

const structure = loadStructure();

const banner = stalenessBanner(structure);
if (banner) {
  console.log(banner + '\n');
}

if (args[0] === '--list') {
  listFeatures(structure);
} else {
  const keyword = args.join(' ');
  const results = searchIntentIndex(structure, keyword);
  printResults(structure, results, keyword);
}
