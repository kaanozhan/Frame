/**
 * queueStore — one checkout's `.frame/queue.json` (work-queue spec, T02).
 *
 * One file per machine (plan D5): the Mac's main checkout, or a server clone.
 * It is machine-local (`runtime` class, D9) and written atomically. Every
 * change is a synchronous read → rule → write, so two callers in the same
 * process can never interleave on one file. The rules live in
 * shared/queueRules; this module only reads and writes.
 *
 * Used by the desktop (queueManager), by Frame Server (src/server/queue.js)
 * and by the Chief's queue tools on both.
 */

const fs = require('fs');
const path = require('path');
const rules = require('../shared/queueRules');
const fsSafe = require('./fsSafe');
const frameStore = require('./frameStore');

const FILE = 'queue.json';

function queuePath(checkout) {
  return path.join(frameStore.metaDir(checkout), FILE);
}

/** The checkout's queue, cleaned; an absent or unreadable file is an empty queue. */
function load(checkout) {
  if (!checkout) return rules.emptyQueue();
  const { data } = fsSafe.readJsonWithRecovery(queuePath(checkout));
  return rules.normalizeQueue(data || {});
}

function save(checkout, queue) {
  const file = queuePath(checkout);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const clean = rules.normalizeQueue(queue);
  fsSafe.writeFileAtomic(file, JSON.stringify(clean, null, 2) + '\n');
  return clean;
}

/**
 * Applies one rule to the stored queue and saves when it changed something.
 * `fn(queue)` returns a rules result (`{ queue, refused?, ... }`); the result
 * comes back with the saved queue.
 */
function update(checkout, fn) {
  const before = load(checkout);
  const res = fn(before) || {};
  if (res.refused || !res.queue) return { ...res, queue: before };
  const saved = save(checkout, res.queue);
  return { ...res, queue: saved };
}

/**
 * Running items whose terminal is not among `liveIds` become interrupted
 * (D19) — on load after a restart, and whenever the owner learns a terminal
 * is gone. Saves only when something changed.
 */
function reconcile(checkout, liveIds) {
  const res = rules.markInterrupted(load(checkout), liveIds);
  return res.changed ? save(checkout, res.queue) : res.queue;
}

module.exports = { FILE, queuePath, load, save, update, reconcile };
