#!/usr/bin/env node
/**
 * Graph Query — Query the code graph built by Frame's onboarding analysis
 *
 * Reads .frame/graph/graph.json (written by Frame's graph builder) and
 * answers orientation questions cheaply, so an agent reaches for this
 * before cold grep. Dependency-free (fs/path/child_process only): ships
 * into user projects' .frame/bin/ and must run without node_modules.
 *
 * Usage:
 *   node scripts/graph-query.js where <symbol>    # file(s)+line defining a symbol
 *   node scripts/graph-query.js imports <file>    # who imports this file
 *   node scripts/graph-query.js deps <file>       # what this file imports
 *   node scripts/graph-query.js affects <file>    # blast radius (transitive importers)
 *
 * Examples:
 *   node scripts/graph-query.js where createWindow
 *   node scripts/graph-query.js affects src/main/logger.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// FRAME_PROJECT_ROOT lets the same script run from .frame/bin/ inside a user
// project. Frame's own callers don't set it — behavior is unchanged.
const ROOT_DIR = process.env.FRAME_PROJECT_ROOT
  ? path.resolve(process.env.FRAME_PROJECT_ROOT)
  : path.join(__dirname, '..');
const GRAPH_FILE = path.join(ROOT_DIR, '.frame', 'graph', 'graph.json');
const META_FILE = path.join(ROOT_DIR, '.frame', 'graph', 'meta.json');

function loadJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    return null;
  }
}

/**
 * Load the graph or exit with an honest, actionable message — the degraded
 * meta statuses (no-languages / error) each get their own explanation.
 */
function loadGraph() {
  const meta = loadJSON(META_FILE);
  const graph = loadJSON(GRAPH_FILE);

  if (!graph) {
    if (meta && meta.status === 'no-languages') {
      console.error('Graph not built: Frame could not detect any languages in this project.');
      console.error('Review the `project` block in .frame/config.json, then re-analyze from Frame.');
    } else if (meta && meta.status === 'error') {
      console.error(`Graph build failed: ${meta.error || 'unknown error'}`);
      console.error('Re-analyze from Frame (Overview panel → Re-analyze).');
    } else {
      console.error('Graph not built — open the project in Frame to analyze it.');
    }
    process.exit(1);
  }
  return { graph, meta };
}

/**
 * One-line warning when the graph is older than the last commit touching the
 * scanned source roots — mirrors find-module.js's stalenessBanner. Silently
 * skipped when git is unavailable (not a git repo, etc.).
 */
function stalenessBanner(meta) {
  if (!meta || !meta.builtAt) return null;
  try {
    const roots = Array.isArray(meta.sourceRoots) && meta.sourceRoots.length > 0
      ? meta.sourceRoots
      : ['.'];
    const lastCommit = execSync(`git log -1 --format=%cI -- ${roots.map((r) => `"${r}"`).join(' ')}`, {
      cwd: ROOT_DIR,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();
    if (lastCommit && meta.builtAt < lastCommit) {
      return `⚠ Code graph (${meta.builtAt.slice(0, 10)}) is older than the last source commit (${lastCommit.slice(0, 10)}) — re-analyze from Frame for fresh results.`;
    }
  } catch (e) {
    // Not a git repo or git unavailable — no banner
  }
  return null;
}

/** Normalize a user-supplied file argument to a graph file id. */
function toId(fileArg) {
  let p = fileArg.replace(/\\/g, '/');
  if (path.isAbsolute(p)) {
    p = path.relative(ROOT_DIR, p).replace(/\\/g, '/');
  }
  return p.replace(/^\.\//, '');
}

/** Find a file node by id, tolerating extension-less / suffix matches. */
function findFile(graph, fileArg) {
  const id = toId(fileArg);
  const files = graph.nodes.files;
  let file = files.find((f) => f.id === id);
  if (!file) file = files.find((f) => f.id.replace(/\.[^.]+$/, '') === id);
  if (!file) {
    const suffix = files.filter((f) => f.id.endsWith('/' + id) || f.id.endsWith('/' + id + path.extname(f.id)));
    if (suffix.length === 1) file = suffix[0];
    else if (suffix.length > 1) {
      console.error(`Ambiguous file "${fileArg}" — matches:`);
      suffix.forEach((f) => console.error(`  ${f.id}`));
      process.exit(1);
    }
  }
  if (!file) {
    console.error(`File not in graph: ${fileArg}`);
    process.exit(1);
  }
  return file;
}

/* -------------------------------- commands -------------------------------- */

function cmdWhere(graph, symbol) {
  const needle = symbol.toLowerCase();
  const exact = [];
  const partial = [];
  for (const file of graph.nodes.files) {
    for (const sym of file.symbols) {
      if (sym.name === symbol) exact.push({ file: file.id, sym });
      else if (sym.name.toLowerCase().includes(needle)) partial.push({ file: file.id, sym });
    }
  }
  const hits = exact.length > 0 ? exact : partial;
  if (hits.length === 0) {
    console.log(`No symbol matching "${symbol}" in the graph.`);
    return;
  }
  if (exact.length === 0) console.log(`No exact match — showing partial matches for "${symbol}":`);
  for (const { file, sym } of hits.slice(0, 25)) {
    console.log(`${file}:${sym.line}  ${sym.kind} ${sym.name}`);
  }
  if (hits.length > 25) console.log(`… and ${hits.length - 25} more`);
}

function cmdImports(graph, fileArg) {
  const file = findFile(graph, fileArg);
  const importers = [...new Set(
    graph.edges.imports.filter((e) => e.to === file.id).map((e) => e.from)
  )];
  if (importers.length === 0) {
    console.log(`Nothing in the graph imports ${file.id}.`);
    return;
  }
  console.log(`Imported by (${importers.length}):`);
  importers.forEach((id) => console.log(`  ${id}`));
}

function cmdDeps(graph, fileArg) {
  const file = findFile(graph, fileArg);
  const deps = [...new Set(
    graph.edges.imports.filter((e) => e.from === file.id).map((e) => e.to)
  )];
  if (deps.length === 0) {
    console.log(`${file.id} imports nothing (per the graph).`);
    return;
  }
  console.log(`${file.id} imports (${deps.length}):`);
  deps.forEach((id) => console.log(`  ${id}`));
}

/**
 * Blast radius: BFS over reverse import edges with a visited set — import
 * cycles terminate instead of hanging. Output is grouped by distance so the
 * nearest impact reads first.
 */
function cmdAffects(graph, fileArg) {
  const file = findFile(graph, fileArg);
  const reverse = new Map(); // to -> [from]
  for (const e of graph.edges.imports) {
    if (!reverse.has(e.to)) reverse.set(e.to, []);
    reverse.get(e.to).push(e.from);
  }

  const visited = new Set([file.id]);
  let frontier = [file.id];
  let depth = 0;
  const layers = [];
  while (frontier.length > 0) {
    depth++;
    const next = [];
    for (const id of frontier) {
      for (const importer of reverse.get(id) || []) {
        if (visited.has(importer)) continue;
        visited.add(importer);
        next.push(importer);
      }
    }
    if (next.length > 0) layers.push({ depth, files: next.sort() });
    frontier = next;
  }

  if (layers.length === 0) {
    console.log(`Changing ${file.id} affects nothing else in the graph.`);
    return;
  }
  const total = layers.reduce((n, l) => n + l.files.length, 0);
  console.log(`Changing ${file.id} affects ${total} file(s):`);
  for (const layer of layers) {
    console.log(`  ${layer.depth === 1 ? 'direct importers' : `${layer.depth} hops away`}:`);
    layer.files.forEach((id) => console.log(`    ${id}`));
  }
}

/* ---------------------------------- main ---------------------------------- */

function main() {
  const [command, arg] = process.argv.slice(2);
  const commands = { where: cmdWhere, imports: cmdImports, deps: cmdDeps, affects: cmdAffects };

  if (!command || !commands[command] || !arg) {
    console.log('Usage:');
    console.log('  node graph-query.js where <symbol>     # file(s)+line defining a symbol');
    console.log('  node graph-query.js imports <file>     # who imports this file');
    console.log('  node graph-query.js deps <file>        # what this file imports');
    console.log('  node graph-query.js affects <file>     # blast radius (transitive importers)');
    process.exit(command && !commands[command] ? 1 : 0);
  }

  const { graph, meta } = loadGraph();
  const banner = stalenessBanner(meta);
  if (banner) console.log(banner + '\n');

  commands[command](graph, arg);
}

main();
