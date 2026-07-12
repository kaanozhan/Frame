#!/usr/bin/env node
/**
 * Project Stack Detector
 *
 * Reads manifest files (package.json, pyproject.toml, Cargo.toml, go.mod, …)
 * — never source contents — and infers languages, package manager, source
 * roots, layout and install/dev/build/test commands. The result is persisted
 * as the `project` block in .frame/config.json so every Frame consumer
 * (structure parser, templates) reads a *detected* input instead of assuming
 * Frame's own repo shape (src/ + JS + npm).
 *
 * Degrades honestly: unknown stack → languages [], sourceRoots ["."],
 * confidence "none" — downstream consumers must say so, never guess.
 *
 * Dependency-free (fs/path only): ships into user projects' .frame/bin/ and
 * must run without node_modules.
 *
 * Usage:
 *   node scripts/detect-project.js                 # print detection JSON
 *   node scripts/detect-project.js --write         # also persist into .frame/config.json
 *   node scripts/detect-project.js /path/to/repo   # detect a different root
 *
 * Module usage:
 *   const { detectProject, writeProjectConfig } = require('./detect-project');
 */

const fs = require('fs');
const path = require('path');

// Directories never considered source roots and skipped when scanning for
// package markers. Mirrors the walker's ignore set in update-structure.js.
const IGNORED_DIRS = new Set([
  'node_modules', 'vendor', '.venv', 'venv', 'target', 'dist', 'build',
  '.git', '__pycache__', '.next', '.turbo', 'coverage', '.frame'
]);

// Conventional source-root names checked when a manifest gives no hint.
const CONVENTIONAL_ROOTS = ['src', 'lib', 'app', 'server', 'client'];

// Cap for expanded monorepo package roots — beyond this the walker should
// scan the workspace base dir instead of an endless explicit list.
const MAX_WORKSPACE_ROOTS = 24;

/* ----------------------------- fs helpers ------------------------------ */

function exists(p) {
  try { return fs.existsSync(p); } catch (_) { return false; }
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch (_) { return false; }
}

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch (_) { return null; }
}

function readText(p) {
  try { return fs.readFileSync(p, 'utf-8'); } catch (_) { return null; }
}

/** Top-level directories of root, excluding ignored and hidden ones. */
function listDirs(root) {
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { return []; }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !IGNORED_DIRS.has(e.name))
    .map((e) => e.name);
}

/**
 * Expand workspace glob patterns ("packages/*", "crates/*", literal dirs)
 * into existing directories. For each package dir, prefer its src/ child
 * when present. Negation patterns are ignored.
 */
function expandWorkspaceGlobs(root, patterns) {
  const roots = [];
  for (const pattern of patterns) {
    if (!pattern || pattern.startsWith('!')) continue;
    const starIdx = pattern.indexOf('*');
    if (starIdx === -1) {
      if (isDir(path.join(root, pattern))) roots.push(pattern);
      continue;
    }
    const base = pattern.slice(0, starIdx).replace(/\/$/, '');
    const baseAbs = path.join(root, base);
    if (!isDir(baseAbs)) continue;
    for (const dir of listDirs(baseAbs)) {
      const pkgRel = path.join(base, dir);
      const srcRel = path.join(pkgRel, 'src');
      roots.push(isDir(path.join(root, srcRel)) ? srcRel : pkgRel);
      if (roots.length >= MAX_WORKSPACE_ROOTS) return roots;
    }
  }
  return roots;
}

/* -------------------------- language detectors ------------------------- */
// Each detector returns null (not this stack) or:
// { language, packageManager, commands, markers, sourceRoots, layout }

function detectJavaScript(root) {
  const pkg = readJSON(path.join(root, 'package.json'));
  const hasPkg = exists(path.join(root, 'package.json'));
  const hasPnpmWs = exists(path.join(root, 'pnpm-workspace.yaml'));
  if (!hasPkg && !hasPnpmWs) return null;

  const markers = [];
  if (hasPkg) markers.push('package.json');
  if (hasPnpmWs) markers.push('pnpm-workspace.yaml');

  const hasTs = exists(path.join(root, 'tsconfig.json'));
  if (hasTs) markers.push('tsconfig.json');

  let pm = 'npm';
  if (exists(path.join(root, 'bun.lockb')) || exists(path.join(root, 'bun.lock'))) pm = 'bun';
  else if (hasPnpmWs || exists(path.join(root, 'pnpm-lock.yaml'))) pm = 'pnpm';
  else if (exists(path.join(root, 'yarn.lock'))) pm = 'yarn';

  const scripts = (pkg && pkg.scripts) || {};
  const commands = { install: `${pm} install`, dev: null, build: null, test: null };
  if (scripts.dev) commands.dev = `${pm} run dev`;
  else if (scripts.start) commands.dev = pm === 'npm' ? 'npm start' : `${pm} start`;
  if (scripts.build) commands.build = `${pm} run build`;
  if (scripts.test && !/no test specified/.test(scripts.test)) {
    commands.test = pm === 'npm' ? 'npm test' : `${pm} test`;
  }

  // Workspaces → monorepo layout with per-package roots
  let wsPatterns = [];
  if (pkg && pkg.workspaces) {
    wsPatterns = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces.packages || [];
  }
  if (hasPnpmWs) {
    const yaml = readText(path.join(root, 'pnpm-workspace.yaml')) || '';
    for (const m of yaml.matchAll(/^\s*-\s*['"]?([^'"#\s]+)/gm)) wsPatterns.push(m[1]);
  }
  if (wsPatterns.length > 0) {
    const roots = expandWorkspaceGlobs(root, wsPatterns);
    if (roots.length > 0) {
      return {
        language: hasTs ? 'typescript' : 'javascript',
        packageManager: pm, commands, markers,
        sourceRoots: roots, layout: 'monorepo'
      };
    }
  }

  return {
    language: hasTs ? 'typescript' : 'javascript',
    packageManager: pm, commands, markers,
    sourceRoots: CONVENTIONAL_ROOTS.filter((d) => isDir(path.join(root, d))),
    layout: 'single'
  };
}

function detectPython(root) {
  const markers = ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile', 'manage.py']
    .filter((f) => exists(path.join(root, f)));
  if (markers.length === 0) return null;

  const pyproject = readText(path.join(root, 'pyproject.toml')) || '';
  const requirements = readText(path.join(root, 'requirements.txt')) || '';

  let pm = 'pip';
  if (/\[tool\.poetry\]/.test(pyproject)) pm = 'poetry';
  else if (exists(path.join(root, 'uv.lock'))) pm = 'uv';
  else if (exists(path.join(root, 'Pipfile'))) pm = 'pipenv';

  const commands = { install: null, dev: null, build: null, test: null };
  if (pm === 'poetry') commands.install = 'poetry install';
  else if (pm === 'uv') commands.install = 'uv sync';
  else if (pm === 'pipenv') commands.install = 'pipenv install';
  else if (exists(path.join(root, 'requirements.txt'))) commands.install = 'pip install -r requirements.txt';

  const isDjango = exists(path.join(root, 'manage.py'));
  const hasPytest = /pytest/.test(pyproject) || /pytest/.test(requirements);
  if (isDjango) commands.dev = 'python manage.py runserver';
  if (hasPytest) commands.test = pm === 'poetry' ? 'poetry run pytest' : 'pytest';
  else if (isDjango) commands.test = 'python manage.py test';

  // Source roots: top-level packages (dirs with __init__.py), src/ layout included
  const sourceRoots = [];
  for (const dir of listDirs(root)) {
    if (exists(path.join(root, dir, '__init__.py'))) sourceRoots.push(dir);
    else if (dir === 'src' && listDirs(path.join(root, 'src'))
      .some((d) => exists(path.join(root, 'src', d, '__init__.py')))) sourceRoots.push('src');
  }

  return { language: 'python', packageManager: pm, commands, markers, sourceRoots, layout: 'single' };
}

function detectRust(root) {
  const cargo = readText(path.join(root, 'Cargo.toml'));
  if (cargo === null) return null;

  const commands = { install: null, dev: null, build: 'cargo build', test: 'cargo test' };
  const membersMatch = /\[workspace\][^[]*members\s*=\s*\[([^\]]*)\]/s.exec(cargo);
  if (membersMatch) {
    const patterns = membersMatch[1].split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    const roots = expandWorkspaceGlobs(root, patterns);
    return {
      language: 'rust', packageManager: 'cargo', commands, markers: ['Cargo.toml'],
      sourceRoots: roots.length > 0 ? roots : [], layout: 'monorepo'
    };
  }

  return {
    language: 'rust', packageManager: 'cargo', commands, markers: ['Cargo.toml'],
    sourceRoots: isDir(path.join(root, 'src')) ? ['src'] : [], layout: 'single'
  };
}

function detectGo(root) {
  if (!exists(path.join(root, 'go.mod'))) return null;
  return {
    language: 'go', packageManager: 'go',
    commands: { install: 'go mod download', dev: null, build: 'go build ./...', test: 'go test ./...' },
    markers: ['go.mod'],
    sourceRoots: ['cmd', 'internal', 'pkg'].filter((d) => isDir(path.join(root, d))),
    layout: 'single'
  };
}

function detectRuby(root) {
  if (!exists(path.join(root, 'Gemfile'))) return null;
  return {
    language: 'ruby', packageManager: 'bundler',
    commands: {
      install: 'bundle install', dev: null, build: null,
      test: exists(path.join(root, 'Rakefile')) ? 'bundle exec rake test' : null
    },
    markers: ['Gemfile'],
    sourceRoots: ['app', 'lib'].filter((d) => isDir(path.join(root, d))),
    layout: 'single'
  };
}

/** Docs repo heuristic: no manifest matched, top-level files mostly Markdown. */
function detectDocs(root) {
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { return null; }
  const files = entries.filter((e) => e.isFile() && !e.name.startsWith('.'));
  let md = files.filter((f) => f.name.endsWith('.md')).length;
  for (const dir of listDirs(root)) {
    try {
      md += fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith('.md')).length;
    } catch (_) { /* unreadable dir — skip */ }
  }
  if (md < 3) return null;
  return {
    language: 'markdown', packageManager: null,
    commands: { install: null, dev: null, build: null, test: null },
    markers: [],
    sourceRoots: isDir(path.join(root, 'docs')) ? ['docs'] : ['.'],
    layout: 'docs'
  };
}

/* ------------------------------ assembly ------------------------------- */

/**
 * Detect the project at rootDir. Always returns a `project` block —
 * an unknown stack yields languages [], sourceRoots ["."], confidence "none".
 */
function detectProject(rootDir) {
  const root = path.resolve(rootDir);
  const detected = [detectJavaScript, detectPython, detectRust, detectGo, detectRuby]
    .map((fn) => fn(root))
    .filter(Boolean);

  if (detected.length === 0) {
    const docs = detectDocs(root);
    if (docs) {
      return {
        languages: [docs.language],
        packageManager: null,
        sourceRoots: docs.sourceRoots,
        layout: 'docs',
        commands: docs.commands,
        markers: docs.markers,
        detectedAt: new Date().toISOString(),
        confidence: 'low'
      };
    }
    return {
      languages: [],
      packageManager: null,
      sourceRoots: ['.'],
      layout: 'unknown',
      commands: { install: null, dev: null, build: null, test: null },
      markers: [],
      detectedAt: new Date().toISOString(),
      confidence: 'none'
    };
  }

  const primary = detected[0];
  const sourceRoots = [...new Set(detected.flatMap((d) => d.sourceRoots))];
  return {
    languages: detected.map((d) => d.language),
    packageManager: primary.packageManager,
    sourceRoots: sourceRoots.length > 0 ? sourceRoots : ['.'],
    layout: detected.some((d) => d.layout === 'monorepo') ? 'monorepo' : primary.layout,
    commands: primary.commands,
    markers: [...new Set(detected.flatMap((d) => d.markers))],
    detectedAt: new Date().toISOString(),
    confidence: 'high'
  };
}

/**
 * Merge a detected project block into <root>/.frame/config.json, preserving
 * every other key — including repo-local keys inside `project` that
 * detection doesn't produce (e.g. ipcChannelsFile), so a re-run never wipes
 * hand-set config. Throws when the project has no .frame/ directory —
 * detection is only persisted into initialized Frame projects.
 */
function writeProjectConfig(rootDir, project) {
  const frameDir = path.join(path.resolve(rootDir), '.frame');
  if (!isDir(frameDir)) {
    throw new Error(`.frame directory not found at ${frameDir} — initialize the project with Frame first`);
  }
  const configPath = path.join(frameDir, 'config.json');
  const config = readJSON(configPath) || {};
  config.project = { ...(config.project || {}), ...project };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  return configPath;
}

/* -------------------------------- CLI ---------------------------------- */

function defaultRoot() {
  if (process.env.FRAME_PROJECT_ROOT) return path.resolve(process.env.FRAME_PROJECT_ROOT);
  // Inside a user project this file lives at .frame/bin/detect-project.js;
  // in Frame's own repo at scripts/detect-project.js.
  if (path.basename(__dirname) === 'bin' && path.basename(path.dirname(__dirname)) === '.frame') {
    return path.join(__dirname, '..', '..');
  }
  if (path.basename(__dirname) === 'scripts') return path.join(__dirname, '..');
  return process.cwd();
}

function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const positional = args.filter((a) => !a.startsWith('--'));
  const root = positional[0] ? path.resolve(positional[0]) : defaultRoot();

  const project = detectProject(root);
  console.log(JSON.stringify(project, null, 2));

  if (project.confidence === 'none') {
    console.error('⚠ Could not detect a stack — scanning repo root. Review the result and edit .frame/config.json manually.');
  }

  if (write) {
    try {
      const configPath = writeProjectConfig(root, project);
      console.error(`✓ project block written to ${configPath}`);
    } catch (err) {
      console.error(`✗ ${err.message}`);
      process.exitCode = 1;
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = { detectProject, writeProjectConfig };
