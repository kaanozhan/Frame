/**
 * fsSafe — durable state-file primitives
 *
 * Every manager that persists JSON state (tasks, workspace, user settings,
 * tool config, spec status, orchestration bus) writes through here so that a
 * crash or full disk mid-write can never leave only a truncated file behind:
 *
 *   writeFileAtomic      — tmp file + fsync + atomic rename, with a `.bak`
 *                          of the previous good copy taken before overwrite
 *   readJsonWithRecovery — parse; on corruption move the broken file aside
 *                          (never delete it) and restore from `.bak`
 *   safeWatch            — fs.watch with an `error` handler attached, so a
 *                          deleted/renamed watch root degrades instead of
 *                          crashing the main process
 */

const fs = require('fs');

/**
 * Atomically replace `filePath` with `data`.
 *
 * Write goes to `<file>.tmp` in the same directory (same filesystem, so the
 * rename is atomic), is fsync'd to disk, then renamed over the target. If a
 * non-empty previous copy exists it is saved to `<file>.bak` first — at every
 * instant there is a complete old file, a complete new file, or a complete
 * `.bak`. Throws on failure; callers keep their existing try/catch contract.
 */
function writeFileAtomic(filePath, data) {
  // Preserve the current good copy. Skip empty files — an empty `.bak` can't
  // be recovered from and would shadow an older usable one.
  try {
    const st = fs.statSync(filePath);
    if (st.size > 0) fs.copyFileSync(filePath, filePath + '.bak');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const tmpPath = filePath + '.tmp';
  const fd = fs.openSync(tmpPath, 'w');
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, filePath);
}

/**
 * Read and parse a JSON state file with corruption recovery.
 *
 * Returns `{ data, source, error }`:
 *   • parses            → { data, source: 'file', error: null }
 *   • missing (ENOENT)  → { data: null, source: null, error: null } — fresh
 *     start, not corruption
 *   • corrupt           → the broken file is moved aside to
 *     `<file>.corrupt-<timestamp>` (never deleted), then `.bak` is tried:
 *       – `.bak` parses → it is restored as the live file and returned as
 *         { data, source: 'bak', error }
 *       – no usable `.bak` → { data: null, source: null, error }. The corrupt
 *         original is already safe aside, so a caller that falls back to a
 *         default can save without destroying recoverable data.
 */
function readJsonWithRecovery(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { data: null, source: null, error: null };
    return { data: null, source: null, error: err };
  }

  let parseError;
  try {
    return { data: JSON.parse(raw), source: 'file', error: null };
  } catch (err) {
    parseError = err;
  }

  // Corrupt: preserve the broken file aside before anything can overwrite it.
  try {
    fs.renameSync(filePath, `${filePath}.corrupt-${Date.now()}`);
  } catch (err) {
    // Can't move it — leave it in place; we still must not clobber it, but
    // that's now the caller's save path writing over a file we failed to
    // preserve. Report the parse error either way.
  }

  try {
    const bakRaw = fs.readFileSync(filePath + '.bak', 'utf8');
    const data = JSON.parse(bakRaw);
    // Restore the good copy as the live file (the corrupt one is gone, so
    // this cannot overwrite the .bak with garbage).
    writeFileAtomic(filePath, bakRaw);
    return { data, source: 'bak', error: parseError };
  } catch (err) {
    return { data: null, source: null, error: parseError };
  }
}

/**
 * fs.watch with an `error` listener attached to the returned watcher.
 *
 * The bare `try/catch` around `fs.watch(...)` at call sites only catches
 * synchronous creation failure; a watch root deleted at runtime emits an
 * async `error` event that, unhandled, crashes the main process. Synchronous
 * creation errors still throw — call sites keep their existing try/catch.
 *
 * @param {string} target - file or directory to watch
 * @param {object|null} options - fs.watch options (may be null)
 * @param {Function} listener - change listener
 * @param {Function} [onError] - optional callback after the watcher is closed
 */
function safeWatch(target, options, listener, onError) {
  const watcher = fs.watch(target, options || undefined, listener);
  watcher.on('error', (err) => {
    console.error(`fsSafe: watcher error on ${target}:`, err.message);
    try {
      watcher.close();
    } catch (e) {}
    if (typeof onError === 'function') onError(err);
  });
  return watcher;
}

module.exports = { writeFileAtomic, readJsonWithRecovery, safeWatch };
