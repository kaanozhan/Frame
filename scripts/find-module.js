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

const STRUCTURE_FILE = path.join(__dirname, '..', 'STRUCTURE.json');

function loadStructure() {
  try {
    return JSON.parse(fs.readFileSync(STRUCTURE_FILE, 'utf-8'));
  } catch (e) {
    console.error('Error: Could not read STRUCTURE.json');
    process.exit(1);
  }
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

  // 2. Partial match in intentIndex keys
  if (results.length === 0) {
    for (const [feature, modules] of Object.entries(index)) {
      if (feature.includes(kw) || kw.includes(feature)) {
        results.push({ feature, modules, matchType: 'partial' });
      }
    }
  }

  // 3. Search in module descriptions, exports, IPC channels
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
function printResults(results, keyword) {
  if (results.length === 0) {
    console.log(`No modules found for "${keyword}"`);
    console.log('Try: node scripts/find-module.js --list');
    return;
  }

  for (const result of results) {
    console.log(`Feature: ${result.feature}`);
    for (const mod of result.modules) {
      const desc = mod.description ? ` — ${mod.description}` : '';
      console.log(`  ${mod.file.padEnd(42)}${desc}`);
    }

    // Show related IPC channels
    const structure = loadStructure();
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

if (args[0] === '--list') {
  listFeatures(structure);
} else {
  const keyword = args.join(' ');
  const results = searchIntentIndex(structure, keyword);
  printResults(results, keyword);
}
