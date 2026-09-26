/**
 * STRUCTURE generation — turn a discovered inventory into map entries.
 *
 * Two operations share entry construction, key allocation and annotation
 * merging but differ in what they replace:
 *
 *   buildFull   a complete rebuild: the generated file set becomes exactly
 *               the discovered set (deleted/excluded entries disappear).
 *   buildDelta  `--changed` / explicit files: starts from the existing map
 *               and touches only selected paths, plus entries whose file is
 *               confirmed absent. Files not in the list are never deleted.
 *
 * Identity is the normalized repository-relative `file` path. Existing module
 * keys stay bound to their file; new files take the legacy key derivation
 * when it is free and a collision-safe `@file:` key otherwise, so same-stem
 * files (model.js + model.ts, index.js + src/index.js) never overwrite each
 * other. Keys still referenced by curation stay reserved for their original
 * file after it is deleted (`curatedKeyOwners`), so a same-stem newcomer
 * never inherits someone else's curated concept.
 *
 * Authored context survives: unknown entry fields, architecture notes,
 * legacy `path/purpose/submodules` groups (`legacyModuleGroups`) and prose
 * the user wrote. Generated prose is fingerprinted in `provenance` so a later
 * scan can tell an unchanged generated description from a hand edit; prose
 * with no fingerprint is preserved conservatively.
 *
 * This module decides content only. Reading/validating the prior map,
 * locking, recovery archives and publication belong to structure-state.js.
 * Standalone: ships into `.frame/bin/` beside the language extractors.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalizeCandidatePath, compareBytes, DEFAULT_LIMITS } = require('./structure-discovery');

const ARTIFACT_VERSION = '1.1';
const GENERATION_SCHEMA = 1;
const MAX_DIAGNOSTIC_SAMPLES = 100;
const FALLBACK_PREFIX = '@file:';

// Per-language extractors (scripts/lang/*), dispatched by file extension.
const EXTRACTORS = [
  require('./lang/javascript'),
  require('./lang/python'),
  require('./lang/go'),
  require('./lang/rust'),
  require('./lang/markdown')
];
const EXT_TO_EXTRACTOR = new Map();
for (const extractor of EXTRACTORS) {
  for (const ext of extractor.extensions) EXT_TO_EXTRACTOR.set(ext, extractor);
}

// Entry fields the generator owns. Everything else on an entry is authored
// (or unknown) and is carried over by file identity.
const GENERATED_FIELDS = ['file', 'description', 'exports', 'depends', 'functions', 'ipc', 'sizeBytes', 'extraction', 'provenance'];
const GENERATED_FIELD_SET = new Set(GENERATED_FIELDS);
const GENERATED_FUNCTION_FIELDS = new Set(['line', 'params', 'purpose']);

/* ------------------------------ helpers ------------------------------ */

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/** Assign without prototype-key hazards (`__proto__`, `constructor`, …). */
function setOwn(obj, key, value) {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
  return obj;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function proseHash(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function sortedObject(entries) {
  const out = {};
  for (const [key, value] of [...entries].sort(([a], [b]) => compareBytes(a, b))) setOwn(out, key, value);
  return out;
}

function canonical(value) {
  return JSON.stringify(value);
}

/* ------------------------------- keys -------------------------------- */

/**
 * Frame's historical key: repo-relative path, a leading `src/` stripped, and
 * the extension dropped when a language extractor claims it. Unchanged from
 * update-structure.js so existing keys and curation keep meaning the same.
 */
function legacyKeyFor(relPath) {
  let rel = relPath;
  if (rel.startsWith('src/')) rel = rel.slice(4);
  const ext = path.posix.extname(rel);
  return ext && EXT_TO_EXTRACTOR.has(ext) ? rel.slice(0, -ext.length) : rel;
}

/** Collision-safe key: `@file:` + the percent-encoded complete path. */
function fallbackKeyFor(relPath) {
  return FALLBACK_PREFIX + relPath.split('/').map(encodeURIComponent).join('/');
}

/** Name tokens for auto-grouping come from the file, never a synthetic key. */
function groupingBaseName(relPath) {
  const base = relPath.split('/').pop();
  const ext = path.posix.extname(base);
  return ext && EXT_TO_EXTRACTOR.has(ext) ? base.slice(0, -ext.length) : base;
}

/* ---------------------------- extraction ----------------------------- */

const UNSUPPORTED_BOMS = [
  [0xff, 0xfe, 0x00, 0x00],
  [0x00, 0x00, 0xfe, 0xff],
  [0xff, 0xfe],
  [0xfe, 0xff]
];

function emptyFacts() {
  return { description: '', exports: [], depends: [], functions: {} };
}

/**
 * Extract semantic facts for one discovered file. Never throws: a missing
 * extractor, an oversized file, an unreadable file, an unsupported encoding
 * or an extractor exception all yield empty facts plus an explicit status.
 */
function extractFacts(rootDir, record, options = {}) {
  const fsImpl = options.fs || fs;
  const maxParseBytes = options.maxParseBytes || DEFAULT_LIMITS.maxParseBytes;
  const ext = path.posix.extname(record.path);
  const extractor = EXT_TO_EXTRACTOR.get(ext);
  if (!extractor) return { facts: emptyFacts(), extraction: { status: 'unsupported', reason: 'no-extractor' } };
  if (record.sizeBytes > maxParseBytes) {
    return { facts: emptyFacts(), extraction: { status: 'partial', reason: 'size-limit' } };
  }

  let buf;
  try {
    buf = fsImpl.readFileSync(path.join(rootDir, ...record.path.split('/')));
  } catch (err) {
    const extraction = { status: 'partial', reason: 'read-error' };
    if (err && err.code) extraction.code = err.code;
    return { facts: emptyFacts(), extraction };
  }
  if (buf.length > maxParseBytes) {
    return { facts: emptyFacts(), extraction: { status: 'partial', reason: 'size-limit' } };
  }
  if (UNSUPPORTED_BOMS.some((bom) => bom.every((byte, i) => buf[i] === byte))) {
    return { facts: emptyFacts(), extraction: { status: 'unsupported', reason: 'encoding' } };
  }

  let content = buf.toString('utf8');
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  try {
    const lines = content.split('\n');
    const facts = {
      description: extractor.extractDescription(content) || '',
      exports: extractor.extractExports(content),
      depends: extractor.extractDependencies(content),
      functions: {}
    };
    const functions = extractor.extractFunctions(content, lines);
    if (functions && Object.keys(functions).length > 0) facts.functions = functions;
    if (extractor.extractIPC) {
      const ipc = extractor.extractIPC(content);
      if (ipc.listens.length > 0 || ipc.emits.length > 0) facts.ipc = ipc;
    }
    // Round-trip drops `undefined` members exactly as the old writer did.
    return { facts: JSON.parse(JSON.stringify(facts)), extraction: { status: 'parsed' } };
  } catch (err) {
    return { facts: emptyFacts(), extraction: { status: 'partial', reason: 'parse-error' } };
  }
}

/* --------------------------- annotations ----------------------------- */

/**
 * Resolve one prose field. Returns `{ value, hash }`; hash is set only when
 * the value is generated. Authored prose — or prose without a fingerprint
 * that differs from the generated value — always wins.
 */
function resolveProse(generated, priorValue, priorHash) {
  const g = typeof generated === 'string' ? generated : '';
  const p = typeof priorValue === 'string' ? priorValue : '';
  if (!p) return { value: g, hash: g ? proseHash(g) : null };
  if (priorHash && proseHash(p) === priorHash) return { value: g, hash: g ? proseHash(g) : null };
  if (p === g) return { value: g, hash: proseHash(g) };
  // Authored, or generated before provenance existed: keep it.
  return { value: p, hash: null };
}

/** True when prose would be lost if this value disappeared. */
function isAuthoredProse(value, hash) {
  return typeof value === 'string' && value !== '' && !(hash && proseHash(value) === hash);
}

function hasAuthoredContent(entry) {
  if (!isPlainObject(entry)) return true;
  if (Object.keys(entry).some((key) => !GENERATED_FIELD_SET.has(key))) return true;
  const provenance = isPlainObject(entry.provenance) ? entry.provenance : {};
  if (isAuthoredProse(entry.description, provenance.description)) return true;
  const purposes = isPlainObject(provenance.purposes) ? provenance.purposes : {};
  for (const [name, fn] of Object.entries(isPlainObject(entry.functions) ? entry.functions : {})) {
    if (!isPlainObject(fn)) continue;
    if (Object.keys(fn).some((key) => !GENERATED_FUNCTION_FIELDS.has(key))) return true;
    if (isAuthoredProse(fn.purpose, purposes[name])) return true;
  }
  return false;
}

/**
 * Merge freshly extracted facts with the prior entry for the same file.
 * Parser facts are replaced; prose follows resolveProse; unknown fields on
 * the entry and on each function record survive. Returns the entry and
 * whether authored function annotations had to be dropped (their function
 * no longer exists), which callers route to recovery.
 */
function mergeEntry(relPath, record, extracted, priorEntry) {
  const prior = isPlainObject(priorEntry) ? priorEntry : {};
  const priorProvenance = isPlainObject(prior.provenance) ? prior.provenance : {};
  const priorPurposes = isPlainObject(priorProvenance.purposes) ? priorProvenance.purposes : {};
  const priorFunctions = isPlainObject(prior.functions) ? prior.functions : {};
  const facts = extracted.facts;
  let droppedAuthored = false;

  const description = resolveProse(facts.description, prior.description, priorProvenance.description);

  const functions = {};
  const purposeHashes = [];
  for (const name of Object.keys(facts.functions)) {
    const fresh = facts.functions[name];
    const old = hasOwn(priorFunctions, name) && isPlainObject(priorFunctions[name]) ? priorFunctions[name] : {};
    const fn = {};
    for (const key of Object.keys(fresh)) {
      if (key !== 'purpose') setOwn(fn, key, fresh[key]);
    }
    const purpose = resolveProse(fresh.purpose, old.purpose, priorPurposes[name]);
    if (purpose.value) setOwn(fn, 'purpose', purpose.value);
    if (purpose.hash) purposeHashes.push([name, purpose.hash]);
    for (const key of Object.keys(old).sort(compareBytes)) {
      if (!GENERATED_FUNCTION_FIELDS.has(key)) setOwn(fn, key, old[key]);
    }
    setOwn(functions, name, fn);
  }
  for (const name of Object.keys(priorFunctions)) {
    if (hasOwn(functions, name)) continue;
    const old = priorFunctions[name];
    if (!isPlainObject(old)) continue;
    if (Object.keys(old).some((key) => !GENERATED_FUNCTION_FIELDS.has(key)) || isAuthoredProse(old.purpose, priorPurposes[name])) {
      droppedAuthored = true;
    }
  }

  const entry = {};
  setOwn(entry, 'file', relPath);
  setOwn(entry, 'description', description.value);
  setOwn(entry, 'exports', facts.exports);
  setOwn(entry, 'depends', facts.depends);
  setOwn(entry, 'functions', functions);
  if (facts.ipc) setOwn(entry, 'ipc', facts.ipc);
  setOwn(entry, 'sizeBytes', record.sizeBytes);
  setOwn(entry, 'extraction', extracted.extraction);
  const provenance = {};
  if (description.hash) setOwn(provenance, 'description', description.hash);
  if (purposeHashes.length) setOwn(provenance, 'purposes', sortedObject(purposeHashes));
  if (Object.keys(provenance).length) setOwn(entry, 'provenance', provenance);
  for (const key of Object.keys(prior).sort(compareBytes)) {
    if (!GENERATED_FIELD_SET.has(key)) setOwn(entry, key, prior[key]);
  }
  return { entry, droppedAuthored };
}

/* ------------------------------ curation ----------------------------- */

/**
 * The curated concept → module-keys map. It lives beside the running parser
 * (scripts/ in Frame's repo, .frame/bin/ in a project) and is agent-owned:
 * generation reads it and never rewrites it. Missing or malformed → {}.
 */
function loadCuration(dir = __dirname, fsImpl = fs) {
  try {
    const map = JSON.parse(fsImpl.readFileSync(path.join(dir, 'intent-map.json'), 'utf8'));
    if (!isPlainObject(map)) return {};
    delete map._comment;
    return map;
  } catch (err) {
    return {};
  }
}

function curatedKeySet(curation) {
  const keys = new Set();
  for (const entry of Object.values(curation || {})) {
    if (!isPlainObject(entry) || !Array.isArray(entry.modules)) continue;
    for (const key of entry.modules) if (typeof key === 'string') keys.add(key);
  }
  return keys;
}

/* ---------------------------- prior map ------------------------------ */

/**
 * Index the prior map by file identity and reserve every key it uses.
 *
 * `isVerifiedFile(relPath)` decides whether a legacy `path` entry points at
 * a real, eligible file (full: the discovered set; delta: a regular-file
 * check). Everything that is neither a valid file entry nor such a legacy
 * entry is a directory-style group and is preserved under
 * `legacyModuleGroups`, keyed by its original module name.
 */
function analyzePrior(prior, curatedKeys, isVerifiedFile, diagnostics) {
  const byFile = new Map(); // file → { key, entry }
  const reserved = new Map(); // key → { kind: 'file', file } | { kind: 'group' }
  const groups = new Map(); // key → group record
  const owners = new Map(); // key → file (curated keys whose file is gone)
  const aliases = new Map(); // duplicate key → file (this run only)
  const discarded = [];

  const modules = prior && isPlainObject(prior.modules) ? prior.modules : {};
  const priorGroups = prior && isPlainObject(prior.legacyModuleGroups) ? prior.legacyModuleGroups : {};
  const priorOwners = prior && isPlainObject(prior.curatedKeyOwners) ? prior.curatedKeyOwners : {};

  for (const key of Object.keys(priorGroups).sort(compareBytes)) {
    groups.set(key, priorGroups[key]);
    reserved.set(key, { kind: 'group' });
  }

  for (const key of Object.keys(modules).sort(compareBytes)) {
    const entry = modules[key];
    if (!isPlainObject(entry)) {
      diagnostics.push({ path: key, reason: 'invalid-entry' });
      discarded.push({ key, reason: 'invalid-entry' });
      continue;
    }

    let file = null;
    if (hasOwn(entry, 'file')) {
      file = normalizeCandidatePath(entry.file);
      if (!file) {
        diagnostics.push({ path: key, reason: 'invalid-file-path' });
        discarded.push({ key, reason: 'invalid-file-path' });
        continue;
      }
    } else if (typeof entry.path === 'string') {
      const candidate = normalizeCandidatePath(entry.path);
      if (candidate && isVerifiedFile(candidate)) file = candidate;
    }

    if (!file) {
      if (reserved.has(key)) {
        if (canonical(groups.get(key)) !== canonical(entry)) {
          diagnostics.push({ path: key, reason: 'legacy-group-conflict' });
          discarded.push({ key, reason: 'legacy-group-conflict' });
        }
        continue;
      }
      groups.set(key, entry);
      reserved.set(key, { kind: 'group' });
      continue;
    }

    if (reserved.has(key)) {
      // A module key colliding with a preserved group: the group keeps it.
      diagnostics.push({ path: key, reason: 'legacy-group-conflict' });
      discarded.push({ key, file, reason: 'legacy-group-conflict' });
      continue;
    }

    if (byFile.has(file)) {
      // Two entries for one file: the key that matches the legacy
      // derivation wins, otherwise the first key bytewise.
      const current = byFile.get(file);
      const winnerIsNew = key === legacyKeyFor(file) && current.key !== legacyKeyFor(file);
      const loser = winnerIsNew ? current : { key, entry };
      if (winnerIsNew) byFile.set(file, { key, entry });
      diagnostics.push({ path: file, reason: 'duplicate-entry' });
      discarded.push({ key: loser.key, file, reason: 'duplicate-entry' });
      aliases.set(loser.key, file);
      reserved.set(key, { kind: 'file', file });
      reserved.set(loser.key, { kind: 'file', file });
      continue;
    }
    byFile.set(file, { key, entry });
    reserved.set(key, { kind: 'file', file });
  }

  // Durable bindings of curated keys whose file was deleted earlier.
  for (const key of Object.keys(priorOwners).sort(compareBytes)) {
    const file = normalizeCandidatePath(priorOwners[key]);
    if (!file || !curatedKeys.has(key)) continue; // curation dropped it: released
    if (reserved.has(key)) {
      const holder = reserved.get(key);
      if (!(holder.kind === 'file' && holder.file === file)) {
        diagnostics.push({ path: key, reason: 'curated-owner-conflict' });
      }
      continue;
    }
    owners.set(key, file);
    reserved.set(key, { kind: 'file', file });
  }
  // Duplicate keys that curation references resolve to the surviving file.
  for (const [key, file] of aliases) {
    if (curatedKeys.has(key) && !owners.has(key)) owners.set(key, file);
  }

  return { byFile, reserved, groups, owners, discarded };
}

/**
 * Allocate keys for `files` (bytewise order) given the prior analysis.
 * Returns Map(file → key). Mutates `analysis.owners` when a file whose key
 * was held for it comes back.
 */
function allocateKeys(files, analysis, assigned = new Map(), taken = new Set()) {
  const { byFile, reserved, owners } = analysis;
  const isTaken = (key) => reserved.has(key) || taken.has(key);
  const pending = [];
  for (const file of files) {
    if (byFile.has(file)) {
      assigned.set(file, byFile.get(file).key);
      taken.add(byFile.get(file).key);
      continue;
    }
    const returning = [...owners].find(([, owner]) => owner === file);
    if (returning && !taken.has(returning[0])) {
      assigned.set(file, returning[0]);
      taken.add(returning[0]);
      owners.delete(returning[0]);
      continue;
    }
    pending.push(file);
  }
  for (const file of pending.sort(compareBytes)) {
    let key = legacyKeyFor(file);
    if (isTaken(key)) {
      const base = fallbackKeyFor(file);
      key = base;
      for (let n = 2; isTaken(key); n++) key = `${base}#${n}`;
    }
    assigned.set(file, key);
    taken.add(key);
  }
  return assigned;
}

/* ---------------------------- intent index --------------------------- */

const STRUCTURAL_TOKENS = new Set(['index', 'main', 'src', 'lib', 'app', 'test', 'spec', 'mod']);

/**
 * Files the historical parser scanned — the population automatic grouping
 * keeps using: an extractor (opted in if it needs to be) and a path under
 * the detected source roots (`project.sourceRoots`, falling back to `src`
 * as before). The inventory itself is no longer limited by roots; widening
 * what feeds retrieval is STR-03's decision, not a side effect of this one.
 */
function isAutoGroupSource(relPath, languages, sourceRoots) {
  const extractor = EXT_TO_EXTRACTOR.get(path.posix.extname(relPath));
  if (!extractor) return false;
  if (extractor.optInLanguage && !languages.includes(extractor.optInLanguage)) return false;
  return sourceRoots.some((root) => root === '.' || relPath.startsWith(`${root.replace(/\\/g, '/').replace(/\/+$/, '')}/`));
}

function autoGroupRoots(projectConfig) {
  const roots = projectConfig && Array.isArray(projectConfig.sourceRoots)
    ? projectConfig.sourceRoots.filter((root) => typeof root === 'string' && root)
    : [];
  return roots.length > 0 ? roots : ['src'];
}

/**
 * intentIndex: curated concepts first, then auto-groups by shared name
 * tokens over the historical source population only — files outside the
 * source roots, docs in a code repo, config and unsupported languages never
 * dilute them. Curation may still name any indexed file.
 */
function buildIntentIndex(modules, curation, owners, projectConfig, diagnostics) {
  const languages = projectConfig && Array.isArray(projectConfig.languages) ? projectConfig.languages : [];
  const sourceRoots = autoGroupRoots(projectConfig);
  const fileToKey = new Map();
  for (const key of Object.keys(modules)) fileToKey.set(modules[key].file, key);
  const groups = {};
  const claimed = new Set();
  const toEntry = (key) => ({ module: key, file: modules[key].file, description: modules[key].description || '' });

  const resolve = (key) => {
    if (hasOwn(modules, key)) return key;
    if (owners.has(key)) {
      const holder = fileToKey.get(owners.get(key));
      if (holder) return holder;
      diagnostics.push({ path: key, reason: 'curated-key-unresolved' });
    }
    return null;
  };

  for (const concept of Object.keys(curation || {})) {
    const entry = curation[concept];
    if (!isPlainObject(entry) || !Array.isArray(entry.modules)) continue;
    const keys = [...new Set(entry.modules.filter((key) => typeof key === 'string').map(resolve).filter(Boolean))];
    if (keys.length === 0) continue;
    setOwn(groups, concept, keys.map(toEntry));
    keys.forEach((key) => claimed.add(key));
  }

  const unclaimed = Object.keys(modules).filter((key) => !claimed.has(key) && isAutoGroupSource(modules[key].file, languages, sourceRoots));
  const tokenGroups = new Map();
  for (const key of unclaimed) {
    const tokens = new Set(
      groupingBaseName(modules[key].file)
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .split(/[\s\-_.]+/)
        .map((t) => t.toLowerCase())
        .filter((t) => t.length >= 3 && !STRUCTURAL_TOKENS.has(t))
    );
    for (const token of tokens) {
      if (!tokenGroups.has(token)) tokenGroups.set(token, []);
      tokenGroups.get(token).push(key);
    }
  }
  const maxGroupSize = Math.max(2, Math.ceil(unclaimed.length * 0.25));
  for (const [name, keys] of [...tokenGroups].sort(([a], [b]) => a.localeCompare(b))) {
    if (keys.length < 2 || keys.length > maxGroupSize) continue;
    if (hasOwn(groups, name)) continue; // a curated concept owns its name
    setOwn(groups, name, keys.map(toEntry));
  }

  const sorted = {};
  for (const key of Object.keys(groups).sort()) {
    setOwn(sorted, key, groups[key].sort((a, b) => a.module.localeCompare(b.module)));
  }
  return sorted;
}

/* ----------------------------- IPC channels -------------------------- */

const IPC_VERB_TOKENS = new Set([
  'LOAD', 'GET', 'SET', 'ADD', 'REMOVE', 'DELETE', 'UPDATE', 'CREATE',
  'TOGGLE', 'REFRESH', 'START', 'RESTART', 'STOP', 'OPEN', 'CLOSE',
  'CHECK', 'RUN', 'SELECT', 'SWITCH', 'IS'
]);

/**
 * Sync `ipcChannels` from the repo-local channels file named by
 * `project.ipcChannelsFile`. Unconfigured or missing → the existing value is
 * kept untouched. Existing channels keep their category and enriched data;
 * new ones get a skeleton categorized by their own name tokens.
 */
function syncIpcChannels(existing, rootDir, projectConfig, fsImpl = fs) {
  const configured = projectConfig && projectConfig.ipcChannelsFile;
  if (!configured) return { ipcChannels: existing, synced: false };
  const ipcFile = path.join(rootDir, configured);
  if (!fsImpl.existsSync(ipcFile)) return { ipcChannels: existing, synced: false };
  const content = fsImpl.readFileSync(ipcFile, 'utf8');

  const channelMap = [];
  for (const match of content.matchAll(/^\s+(\w+):\s*'([^']+)'/gm)) channelMap.push([match[1], match[2]]);
  const deriveCategory = (key) => {
    const tokens = key.split('_').filter((t) => t && !IPC_VERB_TOKENS.has(t));
    return (tokens[0] || key.split('_')[0] || 'other').toLowerCase();
  };

  const updated = {};
  const known = new Set();
  for (const [category, channels] of Object.entries(isPlainObject(existing) ? existing : {})) {
    setOwn(updated, category, { ...channels });
    for (const key of Object.keys(channels || {})) known.add(key);
  }
  let added = 0;
  for (const [key, value] of channelMap) {
    if (known.has(key)) continue;
    known.add(key);
    const category = deriveCategory(key);
    if (!hasOwn(updated, category)) setOwn(updated, category, {});
    setOwn(updated[category], key, { name: value, direction: '', description: '' });
    added++;
  }
  return { ipcChannels: updated, synced: true, added };
}

/* ------------------------------ assembly ----------------------------- */

function defaultStructure() {
  return {
    version: ARTIFACT_VERSION,
    description: 'Auto-generated module structure',
    lastUpdated: '',
    architecture: {},
    modules: {},
    ipcChannels: {},
    dataFlow: [],
    files: {},
    conventions: {},
    intentIndex: {}
  };
}

function boundedDiagnostics(discoveryDiagnostics, generationDiagnostics) {
  const samples = [];
  let total = 0;
  let truncated = false;
  if (discoveryDiagnostics) {
    total += discoveryDiagnostics.total;
    truncated = Boolean(discoveryDiagnostics.truncated);
    samples.push(...discoveryDiagnostics.samples);
  }
  total += generationDiagnostics.length;
  for (const d of generationDiagnostics) {
    if (samples.length < MAX_DIAGNOSTIC_SAMPLES) samples.push(d);
    else truncated = true;
  }
  if (samples.length > MAX_DIAGNOSTIC_SAMPLES) {
    samples.length = MAX_DIAGNOSTIC_SAMPLES;
    truncated = true;
  }
  return { total, truncated, samples };
}

function extractionSummary(modules) {
  const counts = { parsed: 0, unsupported: 0, partial: 0 };
  for (const key of Object.keys(modules)) {
    const status = modules[key].extraction && modules[key].extraction.status;
    if (hasOwn(counts, status)) counts[status]++;
  }
  return { coverage: counts.partial > 0 ? 'partial' : 'complete', counts };
}

/**
 * Lay the generated parts over the prior map's own top-level layout, so
 * project description, architecture, conventions, architecture notes,
 * `_frame_metadata` and unknown keys survive in their original order.
 */
function assemble(prior, parts) {
  const base = prior && isPlainObject(prior) ? prior : defaultStructure();
  const out = {};
  for (const key of Object.keys(base)) setOwn(out, key, base[key]);
  setOwn(out, 'version', ARTIFACT_VERSION);
  if (!hasOwn(out, 'lastUpdated')) setOwn(out, 'lastUpdated', '');
  setOwn(out, 'modules', parts.modules);
  if (parts.ipcChannels !== undefined) setOwn(out, 'ipcChannels', parts.ipcChannels);
  setOwn(out, 'intentIndex', parts.intentIndex);
  if (isPlainObject(out.architectureNotes) && Object.keys(out.architectureNotes).length === 0) delete out.architectureNotes;

  delete out.legacyModuleGroups;
  delete out.curatedKeyOwners;
  delete out.generation;
  if (parts.groups.size) setOwn(out, 'legacyModuleGroups', sortedObject(parts.groups));
  if (parts.owners.size) setOwn(out, 'curatedKeyOwners', sortedObject(parts.owners));
  setOwn(out, 'generation', parts.generation);
  return out;
}

function sortModules(modules) {
  return sortedObject(Object.keys(modules).map((key) => [key, modules[key]]));
}

/* ------------------------------ builders ----------------------------- */

/**
 * Full rebuild from a discovery result.
 *
 * input: { rootDir, discovery, prior (validated map object or null),
 *          curation, projectConfig, fs }
 * returns { structure, report } where report carries extraction coverage,
 * diagnostics and `discarded` — authored content this build cannot keep,
 * which the caller must archive before publishing.
 */
function buildFull(input) {
  const { rootDir, discovery, prior = null, curation = {}, projectConfig = {} } = input;
  const fsImpl = input.fs || fs;
  const diagnostics = [];
  const curatedKeys = curatedKeySet(curation);
  const discovered = new Map(discovery.files.map((record) => [record.path, record]));
  const analysis = analyzePrior(prior, curatedKeys, (file) => discovered.has(file), diagnostics);

  const files = [...discovered.keys()];
  const keys = allocateKeys(files, analysis);
  const maxParseBytes = discovery.policy && discovery.policy.limits ? discovery.policy.limits.maxParseBytes : undefined;

  const modules = {};
  const discarded = [...analysis.discarded];
  for (const file of files) {
    const key = keys.get(file);
    const record = discovered.get(file);
    const priorEntry = analysis.byFile.has(file) ? analysis.byFile.get(file).entry : null;
    const extracted = extractFacts(rootDir, record, { fs: fsImpl, maxParseBytes });
    if (extracted.extraction.status === 'partial') {
      diagnostics.push({ path: file, reason: `extraction-${extracted.extraction.reason}` });
    }
    const merged = mergeEntry(file, record, extracted, priorEntry);
    if (merged.droppedAuthored) discarded.push({ key, file, reason: 'function-removed' });
    setOwn(modules, key, merged.entry);
  }

  // Entries whose file left the inventory: gone from the live map; curated
  // keys stay bound to their file; authored content goes to recovery.
  for (const [file, { key, entry }] of analysis.byFile) {
    if (discovered.has(file)) continue;
    if (curatedKeys.has(key)) analysis.owners.set(key, file);
    if (hasAuthoredContent(entry)) discarded.push({ key, file, reason: 'file-removed' });
  }

  const sortedModules = sortModules(modules);
  const intentIndex = buildIntentIndex(sortedModules, curation, analysis.owners, projectConfig, diagnostics);
  const ipc = syncIpcChannels(prior && prior.ipcChannels, rootDir, projectConfig, fsImpl);
  const extraction = extractionSummary(sortedModules);

  const generation = {
    schema: GENERATION_SCHEMA,
    mode: 'full',
    inventory: { coverage: discovery.coverage, reasons: discovery.incompleteReasons },
    extraction,
    policy: discovery.policy,
    counts: { ...discovery.counts, indexedFiles: files.length, legacyGroups: analysis.groups.size },
    diagnostics: boundedDiagnostics(discovery.diagnostics, diagnostics)
  };

  const structure = assemble(prior, {
    modules: sortedModules,
    ipcChannels: ipc.synced ? ipc.ipcChannels : undefined,
    intentIndex,
    groups: analysis.groups,
    owners: analysis.owners,
    generation
  });
  return {
    structure,
    report: { mode: 'full', inventory: generation.inventory, extraction, diagnostics, discarded }
  };
}

class DeltaBaselineError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DeltaBaselineError';
    this.code = 'E_DELTA_BASELINE';
  }
}

/**
 * Partial update from evaluatePaths() results.
 *
 * input: { rootDir, evaluation, prior, baseline: 'valid'|'missing'|'corrupt',
 *          curation, projectConfig, fs, maxParseBytes }
 *
 * A corrupt baseline is refused (DeltaBaselineError): replacing it with a
 * map of only the changed files would silently lose the rest — the caller
 * must keep it for recovery and ask for `--full`. A missing baseline yields
 * an explicitly unverified map. Entries outside the change list are kept
 * unless their file is confirmed absent (ENOENT/ENOTDIR); other filesystem
 * errors never count as deletion. A no-op returns the prior object itself
 * with `report.changed === false` so the caller writes nothing.
 */
function buildDelta(input) {
  const { rootDir, evaluation, prior = null, curation = {}, projectConfig = {} } = input;
  const baseline = input.baseline || (prior ? 'valid' : 'missing');
  if (baseline === 'corrupt') {
    throw new DeltaBaselineError('existing STRUCTURE.json is not a valid map; run a full rebuild (--full)');
  }
  const fsImpl = input.fs || fs;
  const diagnostics = [];
  const curatedKeys = curatedKeySet(curation);

  const isRegularFile = (file) => {
    try {
      return fsImpl.lstatSync(path.join(rootDir, ...file.split('/'))).isFile();
    } catch (err) {
      return false;
    }
  };
  const analysis = analyzePrior(prior, curatedKeys, isRegularFile, diagnostics);

  // Start from the existing module set, keyed by file.
  const current = new Map();
  for (const [file, { key, entry }] of analysis.byFile) current.set(file, { key, entry });

  const selected = new Map(evaluation.results.map((r) => [r.path, r]));
  const discarded = [...analysis.discarded];
  const removeFile = (file) => {
    const existing = current.get(file);
    if (!existing) return;
    current.delete(file);
    if (curatedKeys.has(existing.key)) analysis.owners.set(existing.key, file);
    if (hasAuthoredContent(existing.entry)) discarded.push({ key: existing.key, file, reason: 'file-removed' });
  };

  for (const result of evaluation.results) {
    if (result.status === 'missing' || result.status === 'excluded') removeFile(result.path);
    else if (result.status === 'error') diagnostics.push({ path: result.path, reason: result.reason, ...(result.code ? { code: result.code } : {}) });
  }

  // Confirm the rest of the map still exists — cheap per-entry lstat, never
  // a tree walk. Only ENOENT/ENOTDIR proves a deletion.
  for (const file of [...current.keys()]) {
    if (selected.has(file)) continue;
    try {
      fsImpl.lstatSync(path.join(rootDir, ...file.split('/')));
    } catch (err) {
      if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) removeFile(file);
    }
  }

  const eligible = evaluation.results.filter((r) => r.status === 'eligible');
  const taken = new Set([...current.values()].map((v) => v.key));
  const assigned = new Map([...current].map(([file, v]) => [file, v.key]));
  allocateKeys(eligible.map((r) => r.path).filter((file) => !current.has(file)), analysis, assigned, taken);

  const maxParseBytes = input.maxParseBytes
    || (prior && prior.generation && prior.generation.policy && prior.generation.policy.limits && prior.generation.policy.limits.maxParseBytes)
    || DEFAULT_LIMITS.maxParseBytes;
  for (const result of eligible) {
    const key = assigned.get(result.path);
    const priorEntry = current.has(result.path) ? current.get(result.path).entry : null;
    const extracted = extractFacts(rootDir, result.record, { fs: fsImpl, maxParseBytes });
    if (extracted.extraction.status === 'partial') {
      diagnostics.push({ path: result.path, reason: `extraction-${extracted.extraction.reason}` });
    }
    const merged = mergeEntry(result.path, result.record, extracted, priorEntry);
    if (merged.droppedAuthored) discarded.push({ key, file: result.path, reason: 'function-removed' });
    current.set(result.path, { key, entry: merged.entry });
  }

  const modules = {};
  for (const { key, entry } of current.values()) setOwn(modules, key, entry);
  const sortedModules = sortModules(modules);
  const intentIndex = buildIntentIndex(sortedModules, curation, analysis.owners, projectConfig, diagnostics);
  const ipc = syncIpcChannels(prior && prior.ipcChannels, rootDir, projectConfig, fsImpl);
  const extraction = extractionSummary(sortedModules);

  const priorGeneration = prior && isPlainObject(prior.generation) ? prior.generation : null;
  const inventory = baseline === 'missing'
    ? { coverage: 'unknown', reasons: ['no-baseline'] }
    : { coverage: 'unknown', reasons: ['delta'] };
  const generation = {
    schema: GENERATION_SCHEMA,
    mode: 'delta',
    inventory,
    extraction,
    ...(priorGeneration && priorGeneration.policy ? { policy: priorGeneration.policy } : {}),
    counts: { indexedFiles: current.size, legacyGroups: analysis.groups.size },
    diagnostics: boundedDiagnostics(null, diagnostics)
  };

  const structure = assemble(prior, {
    modules: sortedModules,
    ipcChannels: ipc.synced ? ipc.ipcChannels : undefined,
    intentIndex,
    groups: analysis.groups,
    owners: analysis.owners,
    generation
  });

  const changed = !prior || canonical(contentView(structure)) !== canonical(contentView(prior));
  return {
    structure: changed ? structure : prior,
    report: {
      mode: 'delta',
      changed,
      inventory: changed ? inventory : (priorGeneration ? priorGeneration.inventory : inventory),
      extraction,
      diagnostics,
      discarded,
      policyInputChanged: Boolean(evaluation.policyInputChanged)
    }
  };
}

/* --------------------------- serialization --------------------------- */

/**
 * The map without audit-only and timestamp fields: what a delta no-op and
 * `lastUpdated` preservation compare. `version` is excluded so an old map
 * is not rewritten merely to bump it.
 */
function contentView(structure) {
  const view = {};
  for (const key of Object.keys(structure)) {
    if (key === 'lastUpdated' || key === 'generation' || key === 'version') continue;
    setOwn(view, key, structure[key]);
  }
  return view;
}

/**
 * What `--check` compares: the file/intent/annotation payload plus the
 * effective policy. Mode, coverage, counts and diagnostics are audit-only,
 * so a map last written by a delta is not reported as drift by itself.
 */
function checkView(structure) {
  const view = contentView(structure);
  const policy = structure && isPlainObject(structure.generation) ? structure.generation.policy : undefined;
  setOwn(view, 'policy', policy === undefined ? null : policy);
  return view;
}

/**
 * Final bytes for a candidate. `lastUpdated` keeps the prior date when
 * nothing but the timestamp would change, so an unchanged tree regenerates
 * byte-identical output; `today` is injectable for tests.
 */
function serializeStructure(candidate, prior, today = new Date().toISOString().split('T')[0]) {
  const out = {};
  for (const key of Object.keys(candidate)) setOwn(out, key, candidate[key]);
  const unchanged = prior && isPlainObject(prior)
    && canonical({ ...contentView(prior), g: prior.generation, v: prior.version })
      === canonical({ ...contentView(candidate), g: candidate.generation, v: candidate.version });
  setOwn(out, 'lastUpdated', unchanged && typeof prior.lastUpdated === 'string' ? prior.lastUpdated : today);
  return JSON.stringify(out, null, 2) + '\n';
}

module.exports = {
  buildFull,
  buildDelta,
  serializeStructure,
  contentView,
  checkView,
  extractFacts,
  loadCuration,
  legacyKeyFor,
  fallbackKeyFor,
  hasAuthoredContent,
  DeltaBaselineError,
  ARTIFACT_VERSION,
  EXT_TO_EXTRACTOR
};
