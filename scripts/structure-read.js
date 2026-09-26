/**
 * STRUCTURE read contract — how current is the map, and which map is it?
 *
 * The one place scripts ask about freshness. Read-only by construction:
 * Node built-ins only, never writes, never spawns, never repairs. Consumers
 * (find-module, check-freshness, module-hint, STR-03 retrieval) import it;
 * the lifecycle worker (structure-lifecycle.js) is the only writer of the
 * receipt it reads.
 *
 *   readDescriptor(root)  status without parsing the map — cheap enough for
 *                         every query (STR-03 index invalidation)
 *   readStructure(root)   the same plus the parsed map, with a digest check
 *
 * Freshness is one of:
 *   fresh    a working-tree receipt matches the artifact on disk, no change
 *            is pending, coverage is complete and the observation lease has
 *            not expired
 *   dirty    changes were observed and not yet applied
 *   stale    the lease expired (maintenance paused, closed or behind) or the
 *            last observation was incomplete
 *   unknown  no receipt (fresh clone, Frame closed, pre-lifecycle map), or
 *            the artifact no longer matches the receipt (checkout, hand edit)
 * It is never inferred from `lastUpdated`.
 *
 * Runtime contract — `.frame/runtime/structure/lifecycle.json`, written by
 * the worker only after the artifact is published:
 *
 *   { version: 1, checkout,
 *     epoch: { requested, applied },     pending when requested > applied
 *     dirty: [reason, …],                observed, not yet applied
 *     receipt: { view: 'working-tree', revision, artifactDigest,
 *                artifactStat: { ino, size, mtimeMs, ctimeMs },
 *                sourceDigest, policyDigest, curationDigest,
 *                observedAt (ISO), leaseMs,
 *                coverage, extraction } }       both 'complete' | 'partial'
 *
 * Ownership follows STR-01 / frameStore.resolvePath: the overlay first, the
 * root copy only when `config.files` names it.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_LEASE_MS = 60000 + 30000; // periodic reconciliation + default scan budget

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The owned STRUCTURE.json path (overlay first; root only when recorded). */
function resolveStructurePath(root) {
  const overlay = path.join(root, '.frame', 'STRUCTURE.json');
  if (fs.existsSync(overlay)) return overlay;
  const legacy = path.join(root, 'STRUCTURE.json');
  if (fs.existsSync(legacy)) {
    const config = readJson(path.join(root, '.frame', 'config.json'));
    if (config && config.files && Object.values(config.files).includes('STRUCTURE.json')) return legacy;
  }
  return overlay;
}

function lifecyclePath(root) {
  return path.join(root, '.frame', 'runtime', 'structure', 'lifecycle.json');
}

/** The comparable identity of a file on disk (what a writer records). */
function artifactSignature(stat) {
  return { ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
}

function sameSignature(a, b) {
  return isPlainObject(a) && isPlainObject(b)
    && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}

function nowMs(options) {
  return typeof options.now === 'function' ? options.now() : Date.now();
}

/**
 * Status of the owned map without parsing it.
 * options.now — injectable clock (ms) for tests.
 */
function readDescriptor(root, options = {}) {
  const file = resolveStructurePath(root);
  const out = {
    path: file,
    view: null,
    revision: null,
    coverage: null,
    extraction: null,
    freshness: 'unknown',
    observedAt: null,
    reasons: [],
    artifact: null
  };

  let stat;
  try {
    stat = fs.lstatSync(file);
    out.artifact = artifactSignature(stat);
  } catch (e) {
    out.reasons.push('missing-map');
    return out;
  }

  const state = readJson(lifecyclePath(root));
  const receipt = state && isPlainObject(state.receipt) ? state.receipt : null;
  if (!receipt) {
    out.reasons.push('no-receipt');
    return out;
  }

  out.view = receipt.view || null;
  out.revision = receipt.revision || null;
  out.coverage = receipt.coverage || null;
  out.extraction = receipt.extraction || null;
  out.observedAt = receipt.observedAt || null;

  if (receipt.view !== 'working-tree') {
    out.reasons.push('not-working-tree');
    return out;
  }
  if (!sameSignature(receipt.artifactStat, out.artifact)) {
    out.reasons.push('artifact-changed');
    return out;
  }

  const epoch = isPlainObject(state.epoch) ? state.epoch : {};
  const dirty = Array.isArray(state.dirty) ? state.dirty.filter((r) => typeof r === 'string') : [];
  if ((Number(epoch.requested) || 0) > (Number(epoch.applied) || 0) || dirty.length > 0) {
    out.freshness = 'dirty';
    out.reasons.push(...(dirty.length ? dirty : ['pending-changes']));
    return out;
  }

  const observed = Date.parse(receipt.observedAt || '');
  const lease = Number.isFinite(receipt.leaseMs) && receipt.leaseMs > 0 ? receipt.leaseMs : DEFAULT_LEASE_MS;
  const stale = [];
  if (receipt.coverage !== 'complete') stale.push('incomplete-coverage');
  if (!Number.isFinite(observed) || nowMs(options) > observed + lease) stale.push('lease-expired');
  if (stale.length) {
    out.freshness = 'stale';
    out.reasons.push(...stale);
    return out;
  }
  out.freshness = 'fresh';
  return out;
}

/**
 * The parsed map plus its status. A map that cannot be parsed is returned as
 * `map: null`; a receipt whose digest no longer matches the bytes on disk
 * downgrades freshness to unknown. Revision and coverage fall back to the
 * map's own `generation` block when there is no receipt.
 */
function readStructure(root, options = {}) {
  const out = readDescriptor(root, options);
  out.map = null;
  if (!out.artifact) return out;

  let bytes;
  try {
    bytes = fs.readFileSync(out.path);
  } catch (e) {
    out.freshness = 'unknown';
    out.reasons = ['map-unreadable'];
    return out;
  }
  try {
    out.map = JSON.parse(bytes.toString('utf8'));
  } catch (e) {
    out.freshness = 'unknown';
    out.reasons = ['map-unparseable'];
    return out;
  }

  const state = readJson(lifecyclePath(root));
  const receipt = state && isPlainObject(state.receipt) ? state.receipt : null;
  if (receipt && receipt.artifactDigest && out.freshness !== 'unknown') {
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    if (digest !== receipt.artifactDigest) {
      out.freshness = 'unknown';
      out.reasons = ['artifact-changed'];
    }
  }

  const generation = isPlainObject(out.map) && isPlainObject(out.map.generation) ? out.map.generation : null;
  if (generation) {
    if (!out.revision) out.revision = generation.revision || null;
    if (!out.coverage && isPlainObject(generation.inventory)) out.coverage = generation.inventory.coverage || null;
    if (!out.extraction && isPlainObject(generation.extraction)) out.extraction = generation.extraction.coverage || null;
  }
  return out;
}

module.exports = {
  readDescriptor,
  readStructure,
  resolveStructurePath,
  artifactSignature,
  lifecyclePath,
  DEFAULT_LEASE_MS
};
