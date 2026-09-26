/**
 * STRUCTURE discovery — which files a project map must contain.
 *
 * One inventory policy, independent of the project's architecture and of
 * which languages Frame can parse: walk from the project root, apply the
 * declared exclusions, and report every eligible project-owned text file.
 * Parser support only enriches an entry later (structure-generation.js); it
 * never decides whether the entry exists. detect-project.js's source roots
 * and its workspace cap are advisory and play no part here.
 *
 * Policy, in the order it is applied to each entry:
 *
 *   1. Hard exclusions — `.git` and `.frame` anywhere, Frame's generated
 *      delivery files, and the legacy root meta files named in
 *      `config.files` together with their recovery copies. Not configurable.
 *   2. Default directory names (node_modules, dist, build, …) — the base
 *      decision for a directory. `project.structure.ignoredDirectories`
 *      replaces the whole set, so a project whose own source lives in
 *      `build/` can include it deliberately.
 *   3. Repository `.gitignore` files, outer to inner, each evaluated relative
 *      to its own directory. Only an explicit match or negation changes the
 *      inherited decision; within a file the last matching line wins.
 *   4. `project.structure.exclude` — root-relative gitignore rules, last.
 *
 * An excluded directory is never entered, so no rule underneath it can
 * re-include anything (Git's own rule). `.git/info/exclude` and machine-
 * global excludes are deliberately not read: this is a reproducible project
 * scan policy, not `git status` membership. Matching is case-sensitive on
 * every platform for the same reason.
 *
 * Standalone: ships into `.frame/bin/` and runs with no node_modules, no
 * Git and no network. Never follows symlinks, never reads outside the root,
 * never executes project code.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ignore = require('./structure-ignore');

const POLICY_VERSION = 1;

// Frame's historical dependency/output directory set (update-structure.js),
// minus `.git` and `.frame`, which are hard exclusions below.
const DEFAULT_IGNORED_DIRECTORIES = Object.freeze([
  '.next', '.turbo', '.venv', '__pycache__', 'build', 'coverage', 'dist',
  'node_modules', 'target', 'vendor', 'venv'
]);

// Excluded by name at any depth, whatever their type.
const HARD_EXCLUDED_NAMES = Object.freeze(['.git', '.frame']);

// Files Frame itself generates inside a user's tree (root-relative).
const GENERATED_DELIVERY_PATHS = Object.freeze(['.claude/rules/frame.md']);

// fsSafe's companions of a meta file: `<file>.bak`, `<file>.tmp`,
// `<file>.corrupt-<timestamp>`.
const RECOVERY_SUFFIXES = Object.freeze(['.bak', '.tmp']);
const CORRUPT_INFIX = '.corrupt-';

const DEFAULT_LIMITS = Object.freeze({
  maxEntries: 100000,
  maxFiles: 50000,
  maxDepth: 128,
  timeoutMs: 30000,
  maxParseBytes: 2 * 1024 * 1024
});

const SAMPLE_BYTES = 8192;
const MAX_DIAGNOSTIC_SAMPLES = 100;

// Known source, configuration and documentation extensions — eligible
// without sampling. Anything else (and extensionless files) is sampled.
const TEXT_EXTENSIONS = new Set([
  // languages
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx', '.py', '.pyi',
  '.go', '.rs', '.rb', '.java', '.kt', '.kts', '.scala', '.groovy', '.swift',
  '.m', '.mm', '.c', '.h', '.cc', '.cpp', '.cxx', '.hh', '.hpp', '.hxx',
  '.cs', '.fs', '.vb', '.php', '.pl', '.pm', '.lua', '.r', '.dart', '.ex',
  '.exs', '.erl', '.hrl', '.hs', '.ml', '.mli', '.clj', '.cljs', '.elm',
  '.jl', '.nim', '.zig', '.v', '.sol', '.vue', '.svelte', '.astro',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.psm1', '.bat', '.cmd',
  '.sql', '.graphql', '.gql', '.proto', '.tf', '.hcl', '.nix', '.gradle',
  '.cmake', '.mk',
  // markup, styles, data, config
  '.html', '.htm', '.xml', '.svg', '.css', '.scss', '.sass', '.less',
  '.json', '.jsonc', '.json5', '.yaml', '.yml', '.toml', '.ini', '.cfg',
  '.conf', '.properties', '.env', '.lock', '.csv', '.tsv',
  // documentation
  '.md', '.mdx', '.markdown', '.rst', '.adoc', '.txt', '.tex'
]);

// Known binary formats — classified without reading them.
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.icns', '.webp', '.tif',
  '.tiff', '.avif', '.heic', '.psd', '.pdf', '.zip', '.gz', '.tgz', '.bz2',
  '.xz', '.7z', '.rar', '.zst', '.jar', '.war', '.class', '.exe', '.dll',
  '.so', '.dylib', '.a', '.o', '.obj', '.lib', '.wasm', '.node', '.woff',
  '.woff2', '.ttf', '.otf', '.eot', '.mp3', '.mp4', '.m4a', '.wav', '.ogg',
  '.flac', '.webm', '.mov', '.avi', '.mkv', '.sqlite', '.sqlite3', '.db',
  '.pyc', '.pyo'
]);

const STRUCTURE_KEYS = new Set(['ignoredDirectories', 'exclude', 'limits']);

class StructurePolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StructurePolicyError';
    this.code = 'E_STRUCTURE_POLICY';
  }
}

/** Bytewise (UTF-8) ordering — the same on every platform and locale. */
function compareBytes(a, b) {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/* ------------------------------ policy ------------------------------- */

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate `project.structure` and merge it over the defaults. Invalid input
 * throws StructurePolicyError — a typo must never silently widen or narrow
 * coverage.
 */
function resolvePolicy(raw) {
  if (raw === undefined || raw === null) raw = {};
  if (!isPlainObject(raw)) throw new StructurePolicyError('project.structure must be an object');

  for (const key of Object.keys(raw)) {
    if (!STRUCTURE_KEYS.has(key)) {
      throw new StructurePolicyError(`project.structure.${key} is not a recognized setting`);
    }
  }

  let ignoredDirectories = [...DEFAULT_IGNORED_DIRECTORIES];
  let ignoredDirectoriesSource = 'default';
  if (raw.ignoredDirectories !== undefined) {
    if (!Array.isArray(raw.ignoredDirectories)) {
      throw new StructurePolicyError('project.structure.ignoredDirectories must be an array of directory names');
    }
    for (const name of raw.ignoredDirectories) {
      if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[/\\]/.test(name)) {
        throw new StructurePolicyError(`project.structure.ignoredDirectories: invalid directory name ${JSON.stringify(name)}`);
      }
    }
    ignoredDirectories = [...new Set(raw.ignoredDirectories)];
    ignoredDirectoriesSource = 'config';
  }
  ignoredDirectories.sort(compareBytes);

  let exclude = [];
  if (raw.exclude !== undefined) {
    if (!Array.isArray(raw.exclude) || raw.exclude.some((rule) => typeof rule !== 'string')) {
      throw new StructurePolicyError('project.structure.exclude must be an array of gitignore-style strings');
    }
    exclude = [...raw.exclude];
  }

  const limits = { ...DEFAULT_LIMITS };
  if (raw.limits !== undefined) {
    if (!isPlainObject(raw.limits)) throw new StructurePolicyError('project.structure.limits must be an object');
    for (const [key, value] of Object.entries(raw.limits)) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULT_LIMITS, key)) {
        throw new StructurePolicyError(`project.structure.limits.${key} is not a recognized limit`);
      }
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new StructurePolicyError(`project.structure.limits.${key} must be a positive finite integer`);
      }
      limits[key] = value;
    }
  }

  return { ignoredDirectories, ignoredDirectoriesSource, exclude, limits };
}

/**
 * Read the inputs discovery needs from `.frame/config.json`: the optional
 * `project.structure` block and the legacy `config.files` record (the same
 * fingerprint frameStore.resolvePath trusts). A missing config is normal; a
 * malformed one is a policy error because coverage cannot be determined.
 */
function loadProjectStructureConfig(rootDir, fsImpl = fs) {
  let raw;
  try {
    raw = fsImpl.readFileSync(path.join(rootDir, '.frame', 'config.json'), 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { structure: undefined, legacyFiles: [] };
    throw new StructurePolicyError(`.frame/config.json is unreadable: ${err.code || err.message}`);
  }
  let config;
  try {
    config = JSON.parse(raw);
  } catch (err) {
    throw new StructurePolicyError('.frame/config.json is not valid JSON');
  }
  if (!isPlainObject(config)) throw new StructurePolicyError('.frame/config.json must contain an object');
  const project = isPlainObject(config.project) ? config.project : {};
  const legacyFiles = isPlainObject(config.files)
    ? Object.values(config.files).filter((name) => typeof name === 'string' && name && !/[/\\]/.test(name))
    : [];
  return { structure: project.structure, legacyFiles: [...new Set(legacyFiles)].sort(compareBytes) };
}

/* ---------------------------- matching ------------------------------ */

function createMatcher(rules) {
  return ignore({ ignoreCase: false }).add(rules);
}

/**
 * Test one path against one rule set without re-deciding its parents.
 * The public `test()` re-walks parent directories inside that single rule
 * set, which is wrong once several sets are layered (a later layer may have
 * re-included the parent). Frame owns traversal, so a path is only ever
 * tested after every ancestor was included — exactly Git's per-path check.
 * Relies on the pinned 7.0.5 internals; test/structureDiscovery pins it.
 */
function matchOne(matcher, relPath) {
  return matcher._rules.test(relPath, true, 'regex');
}

function isRecoveryName(name, base) {
  if (RECOVERY_SUFFIXES.some((suffix) => name === base + suffix)) return true;
  return name.startsWith(base + CORRUPT_INFIX);
}

function buildHardRules(legacyFiles) {
  const rootPaths = new Set(GENERATED_DELIVERY_PATHS);
  for (const name of legacyFiles) rootPaths.add(name);
  return {
    rootPaths,
    legacyFiles,
    // Documented in the policy summary so coverage is inspectable.
    summary: [
      ...HARD_EXCLUDED_NAMES.map((name) => `**/${name}`),
      ...GENERATED_DELIVERY_PATHS,
      ...legacyFiles.flatMap((name) => [name, `${name}.bak`, `${name}.tmp`, `${name}.corrupt-*`])
    ]
  };
}

/**
 * Files Frame itself writes into the user's tree (legacy meta files, their
 * recovery companions, generated delivery copies). They come and go with
 * Frame's own writes — a `.bak` appears after the first publish — so they
 * are skipped without being counted: counting them would change the map on
 * the run after every write.
 */
function isFrameArtifact(hard, relPath, name, isRootLevel) {
  if (hard.rootPaths.has(relPath)) return true;
  return isRootLevel && hard.legacyFiles.some((base) => isRecoveryName(name, base));
}

function isHardExcluded(hard, relPath, name, isRootLevel) {
  return HARD_EXCLUDED_NAMES.includes(name) || isFrameArtifact(hard, relPath, name, isRootLevel);
}

/**
 * Decide an entry whose ancestors are all included. Returns null when the
 * entry is included, otherwise the reason it is excluded.
 */
function policyDecision(ctx, relPath, name, isDir, layers) {
  let excludedBy = isDir && ctx.defaultDirs.has(name) ? 'default' : null;
  const candidateFor = (base) => {
    const rel = base ? relPath.slice(base.length + 1) : relPath;
    return isDir ? `${rel}/` : rel;
  };
  for (const layer of layers) {
    const result = matchOne(layer.matcher, candidateFor(layer.base));
    if (result.ignored) excludedBy = 'gitignore';
    else if (result.unignored) excludedBy = null;
  }
  if (ctx.configMatcher) {
    const result = matchOne(ctx.configMatcher, candidateFor(''));
    if (result.ignored) excludedBy = 'config';
    else if (result.unignored) excludedBy = null;
  }
  return excludedBy;
}

/* -------------------------- classification -------------------------- */

const UTF8_BOM = [0xef, 0xbb, 0xbf];

function startsWith(buf, bytes) {
  if (buf.length < bytes.length) return false;
  return bytes.every((byte, i) => buf[i] === byte);
}

/**
 * Classify a leading byte sample. BOMs are recognized before the NUL test,
 * because UTF-16/32 text is full of NUL bytes. Returns
 * `{ binary: true }` or `{ binary: false, encoding }` where encoding is one
 * of utf-8, utf-8-bom, utf-16le, utf-16be, utf-32le, utf-32be, unknown.
 * `wholeFile` says the sample is the entire file (no boundary to excuse).
 */
function classifySample(buf, wholeFile = false) {
  if (startsWith(buf, [0xff, 0xfe, 0x00, 0x00])) return { binary: false, encoding: 'utf-32le' };
  if (startsWith(buf, [0x00, 0x00, 0xfe, 0xff])) return { binary: false, encoding: 'utf-32be' };
  if (startsWith(buf, UTF8_BOM)) return { binary: false, encoding: 'utf-8-bom' };
  if (startsWith(buf, [0xff, 0xfe])) return { binary: false, encoding: 'utf-16le' };
  if (startsWith(buf, [0xfe, 0xff])) return { binary: false, encoding: 'utf-16be' };
  if (buf.includes(0)) return { binary: true };
  try {
    // stream: a multi-byte character cut by the sample boundary is not an
    // error — unless the sample is the whole file, where it is invalid.
    new TextDecoder('utf-8', { fatal: true }).decode(buf, { stream: !wholeFile });
    return { binary: false, encoding: 'utf-8' };
  } catch (err) {
    return { binary: false, encoding: 'unknown' };
  }
}

function readSample(fsImpl, absPath, size) {
  const length = Math.min(size, SAMPLE_BYTES);
  const buf = Buffer.alloc(length);
  if (length === 0) return buf;
  const fd = fsImpl.openSync(absPath, 'r');
  try {
    let offset = 0;
    while (offset < length) {
      const read = fsImpl.readSync(fd, buf, offset, length - offset, offset);
      if (read === 0) break;
      offset += read;
    }
    return buf.subarray(0, offset);
  } finally {
    fsImpl.closeSync(fd);
  }
}

/**
 * Classify one regular file. Returns `{ eligible: true, record }`,
 * `{ eligible: false, reason: 'binary' }`, or throws when a needed sample
 * cannot be read.
 */
function classifyFile(fsImpl, absPath, relPath, size) {
  const ext = path.extname(relPath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) return { eligible: false, reason: 'binary' };
  if (TEXT_EXTENSIONS.has(ext)) {
    return { eligible: true, record: { path: relPath, sizeBytes: size, classifiedBy: 'extension' } };
  }
  const sample = classifySample(readSample(fsImpl, absPath, size), size <= SAMPLE_BYTES);
  if (sample.binary) return { eligible: false, reason: 'binary' };
  return {
    eligible: true,
    record: { path: relPath, sizeBytes: size, classifiedBy: 'content', encoding: sample.encoding }
  };
}

/* ----------------------------- traversal ---------------------------- */

function emptyCounts() {
  return {
    visitedEntries: 0,
    traversedDirectories: 0,
    eligibleFiles: 0,
    unreadable: 0,
    binaryFiles: 0,
    symlinks: 0,
    specialFiles: 0,
    excludedFiles: { hard: 0, gitignore: 0, config: 0 },
    prunedDirectories: { hard: 0, default: 0, gitignore: 0, config: 0, depth: 0 }
  };
}

function createContext(rootDir, options) {
  const fsImpl = options.fs || fs;
  const policy = options.policy || resolvePolicy(options.structure);
  const legacyFiles = [...(options.legacyFiles || [])].sort(compareBytes);
  const hard = buildHardRules(legacyFiles);
  const now = options.now || Date.now;
  return {
    rootDir,
    fs: fsImpl,
    policy,
    hard,
    now,
    signal: options.signal || null,
    deadline: now() + policy.limits.timeoutMs,
    defaultDirs: new Set(policy.ignoredDirectories),
    configMatcher: policy.exclude.length > 0 ? createMatcher(policy.exclude) : null,
    counts: emptyCounts(),
    reasons: new Set(),
    diagnostics: { total: 0, truncated: false, samples: [] },
    ignoreFiles: [],
    stopped: null
  };
}

function diagnose(ctx, relPath, reason, err) {
  ctx.diagnostics.total++;
  if (ctx.diagnostics.samples.length < MAX_DIAGNOSTIC_SAMPLES) {
    const sample = { path: relPath || '.', reason };
    if (err && err.code) sample.code = err.code;
    ctx.diagnostics.samples.push(sample);
  } else {
    ctx.diagnostics.truncated = true;
  }
}

/** Mark coverage partial; `stop` also ends the walk. */
function incomplete(ctx, reason, relPath, err, stop) {
  ctx.reasons.add(reason);
  diagnose(ctx, relPath, reason, err);
  if (stop) ctx.stopped = reason;
}

function checkBudget(ctx, relPath) {
  if (ctx.stopped) return false;
  if (ctx.signal && ctx.signal.aborted) {
    incomplete(ctx, 'cancelled', relPath, null, true);
    return false;
  }
  if (ctx.now() > ctx.deadline) {
    incomplete(ctx, 'timeout', relPath, null, true);
    return false;
  }
  return true;
}

function joinRel(dirRel, name) {
  return dirRel ? `${dirRel}/${name}` : name;
}

/** Load `<dir>/.gitignore` as a new innermost layer, if it exists. */
function loadIgnoreLayer(ctx, absDir, relDir, layers) {
  const relPath = joinRel(relDir, '.gitignore');
  const absPath = path.join(absDir, '.gitignore');
  let stat;
  try {
    stat = ctx.fs.lstatSync(absPath);
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return { layers, ok: true };
    return { layers, ok: false, err, relPath };
  }
  // Git does not follow a symlinked .gitignore in the working tree.
  if (!stat.isFile()) return { layers, ok: true };
  let content;
  try {
    content = ctx.fs.readFileSync(absPath);
  } catch (err) {
    return { layers, ok: false, err, relPath };
  }
  ctx.ignoreFiles.push({ path: relPath, sha256: sha256(content) });
  const text = content.toString('utf8').replace(/^﻿/, '');
  return { layers: [...layers, { base: relDir, matcher: createMatcher(text) }], ok: true };
}

function walkDirectory(ctx, absDir, relDir, depth, parentLayers, files) {
  if (!checkBudget(ctx, relDir)) return;

  let names;
  try {
    names = ctx.fs.readdirSync(absDir);
  } catch (err) {
    ctx.counts.unreadable++;
    incomplete(ctx, 'unreadable', relDir, err, false);
    return;
  }
  names = names.map(String).sort(compareBytes);

  // An unreadable ignore file leaves the policy for this subtree unknown:
  // skip the subtree rather than guess, and say so.
  let layers = parentLayers;
  if (names.includes('.gitignore')) {
    const loaded = loadIgnoreLayer(ctx, absDir, relDir, parentLayers);
    if (!loaded.ok) {
      ctx.counts.unreadable++;
      incomplete(ctx, 'unreadable', loaded.relPath, loaded.err, false);
      return;
    }
    layers = loaded.layers;
  }

  const subdirs = [];
  for (const name of names) {
    const relPath = joinRel(relDir, name);
    if (!checkBudget(ctx, relPath)) return;
    if (isFrameArtifact(ctx.hard, relPath, name, relDir === '')) continue;
    ctx.counts.visitedEntries++;
    if (ctx.counts.visitedEntries > ctx.policy.limits.maxEntries) {
      incomplete(ctx, 'limit-maxEntries', relPath, null, true);
      return;
    }

    const absPath = path.join(absDir, name);
    let stat;
    try {
      stat = ctx.fs.lstatSync(absPath);
    } catch (err) {
      ctx.counts.unreadable++;
      incomplete(ctx, 'unreadable', relPath, err, false);
      continue;
    }

    const isDir = stat.isDirectory();
    if (isHardExcluded(ctx.hard, relPath, name, relDir === '')) {
      if (isDir) ctx.counts.prunedDirectories.hard++;
      else ctx.counts.excludedFiles.hard++;
      continue;
    }
    if (stat.isSymbolicLink()) {
      ctx.counts.symlinks++;
      continue;
    }
    if (!isDir && !stat.isFile()) {
      ctx.counts.specialFiles++;
      continue;
    }

    const excludedBy = policyDecision(ctx, relPath, name, isDir, layers);
    if (excludedBy) {
      if (isDir) ctx.counts.prunedDirectories[excludedBy]++;
      else ctx.counts.excludedFiles[excludedBy]++;
      continue;
    }

    if (isDir) {
      if (depth + 1 > ctx.policy.limits.maxDepth) {
        ctx.counts.prunedDirectories.depth++;
        incomplete(ctx, 'limit-maxDepth', relPath, null, false);
        continue;
      }
      subdirs.push({ absPath, relPath });
      continue;
    }

    let classified;
    try {
      classified = classifyFile(ctx.fs, absPath, relPath, stat.size);
    } catch (err) {
      ctx.counts.unreadable++;
      incomplete(ctx, 'unreadable', relPath, err, false);
      continue;
    }
    if (!classified.eligible) {
      ctx.counts.binaryFiles++;
      continue;
    }
    if (files.length >= ctx.policy.limits.maxFiles) {
      incomplete(ctx, 'limit-maxFiles', relPath, null, true);
      return;
    }
    files.push(classified.record);
  }

  for (const sub of subdirs) {
    if (ctx.stopped) return;
    ctx.counts.traversedDirectories++;
    walkDirectory(ctx, sub.absPath, sub.relPath, depth + 1, layers, files);
  }
}

function policySummary(ctx) {
  return {
    version: POLICY_VERSION,
    caseSensitive: true,
    hardExclusions: ctx.hard.summary,
    ignoredDirectories: ctx.policy.ignoredDirectories,
    ignoredDirectoriesSource: ctx.policy.ignoredDirectoriesSource,
    ignoreFiles: [...ctx.ignoreFiles].sort((a, b) => compareBytes(a.path, b.path)),
    exclude: ctx.policy.exclude,
    limits: ctx.policy.limits
  };
}

/**
 * Walk `rootDir` and return the eligible-file inventory.
 *
 * options:
 *   structure    raw `project.structure` block (validated here), or
 *   policy       an already-resolved policy
 *   legacyFiles  names from `config.files` (hard-excluded at the root)
 *   fs, now, signal   injection points for tests and cancellation
 *
 * Result: { coverage: 'complete'|'partial', incompleteReasons, files,
 *           counts, diagnostics, policy }. `files` is sorted bytewise by
 * path. Throws StructurePolicyError on invalid policy, and a plain error
 * when the root itself is not a directory.
 */
function discover(rootDir, options = {}) {
  const ctx = createContext(rootDir, options);
  let rootStat;
  try {
    rootStat = ctx.fs.statSync(rootDir);
  } catch (err) {
    throw new Error(`project root is not accessible: ${err.code || err.message}`);
  }
  if (!rootStat.isDirectory()) throw new Error('project root is not a directory');

  const files = [];
  walkDirectory(ctx, rootDir, '', 0, [], files);
  files.sort((a, b) => compareBytes(a.path, b.path));
  ctx.counts.eligibleFiles = files.length;

  const incompleteReasons = [...ctx.reasons].sort(compareBytes);
  return {
    coverage: incompleteReasons.length === 0 ? 'complete' : 'partial',
    incompleteReasons,
    files,
    counts: ctx.counts,
    diagnostics: ctx.diagnostics,
    policy: policySummary(ctx)
  };
}

/** discover() with policy and legacy names read from `.frame/config.json`. */
function discoverProject(rootDir, options = {}) {
  const fsImpl = options.fs || fs;
  const loaded = loadProjectStructureConfig(rootDir, fsImpl);
  return discover(rootDir, { ...options, structure: loaded.structure, legacyFiles: loaded.legacyFiles });
}

/* ---------------------- candidate evaluation (delta) ----------------------- */

function isMissingError(err) {
  return Boolean(err) && (err.code === 'ENOENT' || err.code === 'ENOTDIR');
}

/**
 * Evaluate specific root-relative paths under the same policy as a full walk,
 * reading only each candidate's ancestor directories and their ignore files.
 * Used by `--changed` / explicit-file updates, which must not walk the tree.
 *
 * Returns, per input path (normalized, deduplicated, sorted):
 *   { path, status: 'eligible', record }
 *   { path, status: 'excluded', reason }   policy/binary/symlink/special/depth
 *   { path, status: 'missing' }            confirmed absent (ENOENT/ENOTDIR)
 *   { path, status: 'error', reason, code } could not be decided — never
 *                                           treat this as a deletion
 * plus `policyInputChanged` (a candidate is a .gitignore) and the policy
 * summary covering the ignore files that were read.
 */
function evaluatePaths(rootDir, relPaths, options = {}) {
  const ctx = createContext(rootDir, options);
  const layerCache = new Map(); // relDir → { layers, ok, err, relPath }
  const dirDecision = new Map(); // relDir → null | { status, reason, code }

  // Ignore layers in effect for entries of `relDir`: the root's .gitignore
  // and every ancestor's, outer to inner, including relDir's own.
  const layersFor = (relDir) => {
    if (layerCache.has(relDir)) return layerCache.get(relDir);
    const parent = relDir === ''
      ? { layers: [], ok: true }
      : layersFor(relDir.includes('/') ? relDir.slice(0, relDir.lastIndexOf('/')) : '');
    const entry = parent.ok
      ? loadIgnoreLayer(ctx, relDir === '' ? rootDir : path.join(rootDir, ...relDir.split('/')), relDir, parent.layers)
      : parent;
    layerCache.set(relDir, entry);
    return entry;
  };

  // Is every ancestor directory of `relDir` (inclusive) traversable?
  const checkDir = (relDir) => {
    if (relDir === '') return null;
    if (dirDecision.has(relDir)) return dirDecision.get(relDir);
    const cut = relDir.lastIndexOf('/');
    const parentRel = cut === -1 ? '' : relDir.slice(0, cut);
    const name = cut === -1 ? relDir : relDir.slice(cut + 1);
    let decision = checkDir(parentRel);
    if (!decision) {
      const depth = relDir.split('/').length;
      const absDir = path.join(rootDir, ...relDir.split('/'));
      let stat = null;
      try {
        stat = ctx.fs.lstatSync(absDir);
      } catch (err) {
        decision = isMissingError(err) ? { status: 'missing' } : { status: 'error', reason: 'unreadable', code: err.code };
      }
      if (!decision && isHardExcluded(ctx.hard, relDir, name, parentRel === '')) decision = { status: 'excluded', reason: 'hard' };
      else if (!decision && stat.isSymbolicLink()) decision = { status: 'excluded', reason: 'symlink' };
      else if (!decision && !stat.isDirectory()) decision = { status: 'missing' };
      if (!decision) {
        const parentLayers = layersFor(parentRel);
        if (!parentLayers.ok) decision = { status: 'error', reason: 'unreadable', code: parentLayers.err && parentLayers.err.code };
        else {
          const excludedBy = policyDecision(ctx, relDir, name, true, parentLayers.layers);
          if (excludedBy) decision = { status: 'excluded', reason: excludedBy };
          else if (depth > ctx.policy.limits.maxDepth) decision = { status: 'excluded', reason: 'depth' };
        }
      }
    }
    dirDecision.set(relDir, decision || null);
    return decision || null;
  };

  const normalized = [...new Set(relPaths.map(normalizeCandidatePath).filter(Boolean))].sort(compareBytes);
  const results = [];
  for (const relPath of normalized) {
    const cut = relPath.lastIndexOf('/');
    const parentRel = cut === -1 ? '' : relPath.slice(0, cut);
    const name = cut === -1 ? relPath : relPath.slice(cut + 1);

    const ancestor = checkDir(parentRel);
    if (ancestor) {
      results.push({ path: relPath, ...ancestor });
      continue;
    }
    const absPath = path.join(rootDir, ...relPath.split('/'));
    let stat;
    try {
      stat = ctx.fs.lstatSync(absPath);
    } catch (err) {
      results.push(isMissingError(err)
        ? { path: relPath, status: 'missing' }
        : { path: relPath, status: 'error', reason: 'unreadable', code: err.code });
      continue;
    }
    if (isHardExcluded(ctx.hard, relPath, name, parentRel === '')) {
      results.push({ path: relPath, status: 'excluded', reason: 'hard' });
      continue;
    }
    if (stat.isSymbolicLink()) {
      results.push({ path: relPath, status: 'excluded', reason: 'symlink' });
      continue;
    }
    if (stat.isDirectory()) {
      // A directory is not a file entry; any file entry at this path is gone.
      results.push({ path: relPath, status: 'missing' });
      continue;
    }
    if (!stat.isFile()) {
      results.push({ path: relPath, status: 'excluded', reason: 'special' });
      continue;
    }
    const parentLayers = layersFor(parentRel);
    if (!parentLayers.ok) {
      results.push({ path: relPath, status: 'error', reason: 'unreadable', code: parentLayers.err && parentLayers.err.code });
      continue;
    }
    const excludedBy = policyDecision(ctx, relPath, name, false, parentLayers.layers);
    if (excludedBy) {
      results.push({ path: relPath, status: 'excluded', reason: excludedBy });
      continue;
    }
    try {
      const classified = classifyFile(ctx.fs, absPath, relPath, stat.size);
      results.push(classified.eligible
        ? { path: relPath, status: 'eligible', record: classified.record }
        : { path: relPath, status: 'excluded', reason: classified.reason });
    } catch (err) {
      results.push({ path: relPath, status: 'error', reason: 'unreadable', code: err.code });
    }
  }
  // A changed ignore file can re-decide paths that are not in this list;
  // only a full scan can reconcile that.
  const policyInputChanged = normalized.some((rel) => rel === '.gitignore' || rel.endsWith('/.gitignore'));
  return { results, policyInputChanged, policy: policySummary(ctx) };
}

/**
 * Normalize a candidate path to root-relative POSIX form. Only the platform's
 * own separator is converted — a literal backslash inside a POSIX filename is
 * part of the name. Absolute, empty and out-of-root paths return null.
 */
function normalizeCandidatePath(input) {
  if (typeof input !== 'string' || !input) return null;
  let rel = path.sep === '\\' ? input.replace(/\\/g, '/') : input;
  if (rel.startsWith('/') || /^[A-Za-z]:\//.test(rel)) return null;
  const parts = [];
  for (const part of rel.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') return null;
    parts.push(part);
  }
  return parts.length ? parts.join('/') : null;
}

module.exports = {
  discover,
  discoverProject,
  evaluatePaths,
  resolvePolicy,
  loadProjectStructureConfig,
  normalizeCandidatePath,
  classifySample,
  compareBytes,
  StructurePolicyError,
  DEFAULT_LIMITS,
  DEFAULT_IGNORED_DIRECTORIES,
  HARD_EXCLUDED_NAMES,
  GENERATED_DELIVERY_PATHS,
  TEXT_EXTENSIONS,
  SAMPLE_BYTES,
  MAX_DIAGNOSTIC_SAMPLES
};
