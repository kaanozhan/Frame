#!/usr/bin/env node
/**
 * Module Finder — from a file name, path, symbol or concept to the files
 *
 * Usage:
 *   node scripts/find-module.js <query>             # file, path, symbol or concept
 *   node scripts/find-module.js --list              # list all concepts
 *   node scripts/find-module.js <query> --json      # one bounded envelope on stdout
 *   node scripts/find-module.js <query> --limit 12  # up to 20 files (default 8)
 *   node scripts/find-module.js <query> --retrieval=legacy|v2
 *
 * Examples:
 *   node scripts/find-module.js github
 *   node scripts/find-module.js frameStore.js
 *   node scripts/find-module.js publishStaged
 *
 * The engine comes from --retrieval, else `project.retrieval.engine` in
 * .frame/config.json, else the shipped default (structure-retrieval.js).
 * `legacy` is the pre-STR-03 behavior, kept as the rollback path.
 *
 * Exit codes: 0 answered or no match · 1 no usable map (`unavailable`) ·
 * 2 usage error.
 */

const fs = require('fs');
const path = require('path');
// Ownership, freshness and generation status: the shared read contract.
const structureRead = require('./structure-read');
// One retrieval engine for this CLI and the search hook (STR-03).
const retrieval = require('./structure-retrieval');

const LOOKUP_SCHEMA = 'frame.lookup/1';
const DEFAULT_LIMIT = 8;

/**
 * Which project this run is about. `__dirname/..` was wrong for the shipped
 * copy: run by hand from a user project, it read Frame's own STRUCTURE.json.
 * Same rule as spec-index.js / detect-project.js.
 */
function resolveProjectRoot() {
  if (process.env.FRAME_PROJECT_ROOT) return path.resolve(process.env.FRAME_PROJECT_ROOT);
  // Shipped copy: <project>/.frame/bin/ — the project is two levels up.
  if (path.basename(__dirname) === 'bin' && path.basename(path.dirname(__dirname)) === '.frame') {
    return path.dirname(path.dirname(__dirname));
  }
  // Frame's own repo: scripts/
  if (path.basename(__dirname) === 'scripts') return path.join(__dirname, '..');
  return process.cwd();
}

const ROOT_DIR = resolveProjectRoot();

function scriptRel(name) {
  const rel = path.relative(ROOT_DIR, path.join(__dirname, name)).split(path.sep).join('/');
  return rel && !rel.startsWith('..') ? rel : `.frame/bin/${name}`;
}

function repairCommand() {
  return `node ${scriptRel('update-structure.js')} --full`;
}

/* --------------------------------- input -------------------------------- */

function parseArgs(argv) {
  const out = { json: false, list: false, limit: DEFAULT_LIMIT, engine: null, words: [], error: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--list') out.list = true;
    else if (a === '--limit' || a.startsWith('--limit=')) {
      const value = a.includes('=') ? a.slice(8) : argv[++i];
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1) out.error = `--limit takes a positive whole number, got ${JSON.stringify(value)}`;
      else out.limit = Math.min(n, retrieval.LIMITS.cliFiles);
    } else if (a === '--retrieval' || a.startsWith('--retrieval=')) {
      out.engine = a.includes('=') ? a.slice(12) : argv[++i];
    } else out.words.push(a);
  }
  return out;
}

/** --retrieval, then project.retrieval.engine, then the shipped default. */
function resolveEngine(flag) {
  const valid = (e) => retrieval.ENGINES.includes(e);
  if (flag) {
    if (valid(flag)) return { engine: flag };
    return { engine: retrieval.DEFAULT_ENGINE, note: `unknown engine ${JSON.stringify(flag)} — using ${retrieval.DEFAULT_ENGINE}` };
  }
  let configured;
  try {
    const config = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, '.frame', 'config.json'), 'utf8'));
    configured = config && config.project && config.project.retrieval && config.project.retrieval.engine;
  } catch { /* no config: the default */ }
  if (configured === undefined || configured === null) return { engine: retrieval.DEFAULT_ENGINE };
  if (valid(configured)) return { engine: configured };
  return { engine: retrieval.DEFAULT_ENGINE, note: `project.retrieval.engine ${JSON.stringify(configured)} is not an engine — using ${retrieval.DEFAULT_ENGINE}` };
}

/* ------------------------------ map and paths ----------------------------- */

function loadStructure() {
  try {
    return JSON.parse(fs.readFileSync(structureRead.resolveReadPath(ROOT_DIR), 'utf-8'));
  } catch (e) {
    return null;
  }
}

let rootReal = null;
/** A candidate is shown as present only if it is a regular file inside the project. */
function existsInProject(rel) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) return false;
  try {
    rootReal = rootReal || fs.realpathSync(ROOT_DIR);
    const real = fs.realpathSync(path.join(ROOT_DIR, rel));
    if (real !== rootReal && !real.startsWith(rootReal + path.sep)) return false;
    return fs.statSync(real).isFile();
  } catch {
    return false;
  }
}

/** The published index when it is current, else one compiled from the map. */
function v2Index() {
  const loaded = retrieval.loadLookup(ROOT_DIR);
  if (loaded.state === 'fresh') return loaded.index;
  const compiled = retrieval.indexFromMap(ROOT_DIR);
  return compiled.state === 'compiled' ? compiled.index : null;
}

/* -------------------------------- freshness ------------------------------- */

/**
 * How current the map is, from the lifecycle receipt only (STR-02). No Git,
 * no rebuild check: a lookup stays a lookup.
 */
function freshnessLines(descriptor) {
  const why = descriptor.reasons.length ? ` (${descriptor.reasons.join(', ')})` : '';
  if (descriptor.freshness === 'fresh') return ['Map: fresh · working tree'];
  if (descriptor.freshness === 'dirty') return [`⚠ Map: dirty${why} — recent changes are still being applied`];
  if (descriptor.freshness === 'stale') return [`⚠ Map: stale${why} — run: node ${scriptRel('structure-lifecycle.js')} --once`];
  return [`⚠ Map: unverified${why || ' (no lifecycle record)'} — run: node ${scriptRel('structure-lifecycle.js')} --once`];
}

/* --------------------------------- output -------------------------------- */

function listFeatures(structure) {
  const index = structure.intentIndex;
  if (!index) {
    console.error(`No intentIndex found. Run: ${repairCommand()}`);
    process.exit(1);
  }
  console.log('Available features:\n');
  for (const [feature, modules] of Object.entries(index)) {
    const files = modules.map((m) => m.file).join(', ');
    console.log(`  ${feature.padEnd(20)} → ${files}`);
  }
  console.log(`\nTotal: ${Object.keys(index).length} features, ${Object.values(index).flat().length} modules`);
}

/** The pre-STR-03 listing: one block per matched feature, with its IPC channels. */
function printLegacy(structure, result, query) {
  if (!result.groups.length) {
    console.log(`No modules found for "${query}"`);
    console.log(`Try: node ${scriptRel('find-module.js')} --list`);
    return;
  }
  for (const group of result.groups) {
    console.log(`Feature: ${group.feature}`);
    for (const mod of group.modules) {
      const desc = mod.description ? ` — ${mod.description}` : '';
      const missing = existsInProject(mod.file) ? '' : `  ⚠ file missing on disk — run: ${repairCommand()}`;
      console.log(`  ${mod.file.padEnd(42)}${desc}${missing}`);
    }
    const ipc = [];
    for (const mod of group.modules) {
      const info = (structure.modules || {})[mod.module];
      if (info && info.ipc) ipc.push(...(info.ipc.listens || []), ...(info.ipc.emits || []));
    }
    if (ipc.length) console.log(`  IPC: ${[...new Set(ipc)].join(', ')}`);
    console.log('');
  }
}

function printV2(result, query) {
  if (result.status === 'no-match') {
    console.log(`No modules found for "${query}"`);
    console.log(`Try: node ${scriptRel('find-module.js')} --list`);
    return;
  }
  const head = result.status === 'resolved' ? 'Files for' : `Candidates for`;
  console.log(`${head} "${query}"${result.status === 'ambiguous' ? ' (several match equally — pick by path)' : ''}:`);
  for (const c of result.candidates) {
    // a function answer names its line, so the file can be opened there (STR-03b)
    const where = c.line ? `${c.path}:${c.line} ${c.symbol}` : c.path;
    const desc = c.description ? ` — ${c.description}` : '';
    const missing = c.missing ? `  ⚠ missing on disk — run: ${repairCommand()}` : '';
    console.log(`  ${where.padEnd(42)}${desc}  [${c.evidence}]${missing}`);
  }
  if (result.truncated) console.log(`  … more — raise --limit (up to ${retrieval.LIMITS.cliFiles})`);
  console.log('');
}

/* ---------------------------------- main --------------------------------- */

function main() {
  const args = parseArgs(process.argv.slice(2));
  const query = args.words.join(' ');

  if (args.error) {
    console.error(`Error: ${args.error}`);
    process.exitCode = 2;
    return;
  }
  if (!args.list && !query) {
    console.log('Usage: node scripts/find-module.js <query> [--json] [--limit N] [--retrieval=legacy|v2]');
    console.log('       node scripts/find-module.js --list');
    return;
  }

  const { engine, note } = resolveEngine(args.engine);
  if (note) console.error(`⚠ ${note}`);
  const descriptor = structureRead.readDescriptor(ROOT_DIR);
  const structure = loadStructure();

  if (!structure || !structure.modules) {
    if (args.json) {
      process.stdout.write(`${JSON.stringify({ schema: LOOKUP_SCHEMA, status: 'unavailable', engine, query, reason: structure ? 'invalid-map' : 'no-map', freshness: descriptor.freshness, candidates: [], truncated: false })}\n`);
    } else {
      console.error(`Error: Could not read STRUCTURE.json — run: ${repairCommand()}`);
    }
    process.exitCode = 1;
    return;
  }

  if (args.list) {
    listFeatures(structure);
    return;
  }

  let result;
  if (engine === 'legacy') {
    result = retrieval.legacyRetrieve(structure, readCuration(), { mode: 'cli', query });
    if (result.status === 'unavailable') result = { ...result, status: 'no-match' };
    result.candidates = result.candidates.slice(0, args.json ? args.limit : result.candidates.length)
      .map((c) => (existsInProject(c.path) ? c : { ...c, missing: true }));
  } else {
    const index = v2Index();
    result = index
      ? retrieval.retrieve(index, query, { mode: 'cli', limit: args.limit, exists: existsInProject })
      : { status: 'no-match', candidates: [], truncated: false };
  }

  if (args.json) {
    const envelope = {
      schema: LOOKUP_SCHEMA,
      status: result.status,
      engine,
      query,
      freshness: descriptor.freshness,
      freshnessReasons: descriptor.reasons,
      candidates: result.candidates.slice(0, args.limit).map((c) => {
        const out = { path: c.path, evidence: c.evidence, tier: c.tier, description: c.description || '' };
        if (c.line) {
          out.line = c.line;
          out.symbol = c.symbol;
        }
        if (c.missing) out.missing = true;
        return out;
      }),
      truncated: Boolean(result.truncated) || result.candidates.length > args.limit
    };
    process.stdout.write(`${JSON.stringify(envelope)}\n`);
    return;
  }

  for (const line of freshnessLines(descriptor)) console.log(line);
  console.log('');
  const generationWarnings = structureRead.generationNotes(ROOT_DIR, structure);
  if (generationWarnings.length > 0) {
    for (const n of generationWarnings) console.log(`⚠ STRUCTURE.json ${n}`);
    console.log(`  Rebuild: ${repairCommand()}\n`);
  }
  if (engine === 'legacy') printLegacy(structure, result, query);
  else printV2(result, query);
}

function readCuration() {
  try {
    return JSON.parse(fs.readFileSync(retrieval.curationPath(__dirname), 'utf8'));
  } catch {
    return {};
  }
}

main();
