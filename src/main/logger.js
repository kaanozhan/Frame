/**
 * Logger — rotating, redacted log file for the main process.
 *
 * Wraps electron-log v5. Every line passes through redact() before it
 * reaches any transport, so no call site can accidentally persist a secret
 * (the promptLogger plaintext-capture bug is the anti-pattern this guards
 * against). File transport: <app logs dir>/main.log, 5 MB cap, 3 archives
 * (main.old.1.log … main.old.3.log). Location is documented in PRIVACY.md.
 *
 * Usage: logger.info('scopeName', 'message', err)
 * redact() is re-exported for writers that persist outside this logger
 * (promptLogger); it is defined in scripts/redact.js so the .frame/bin/
 * scripts share the same patterns.
 */

// The patterns live in scripts/redact.js so the `.frame/bin/` scripts — which
// run in their own processes and cannot reach src/main/ — share this exact
// copy instead of carrying a second one that would drift. Re-exported below,
// so this module's public API is unchanged.
const { redact, redactValue } = require('../../scripts/redact');

// electron-log is loaded lazily so this module (and redact()) stays usable
// from plain node — tests, scripts.
let electronLog = null;
const scopes = new Map();

function init() {
  if (electronLog) return;
  electronLog = require('electron-log/main');
  electronLog.initialize(); // also bridges renderer console → main log

  const file = electronLog.transports.file;
  file.maxSize = 5 * 1024 * 1024;
  file.archiveLogFn = rotateArchives;

  // Redaction hook — runs for every message on every transport.
  electronLog.hooks.push((message) => {
    message.data = message.data.map(redactValue);
    return message;
  });

  // Keep packaged-app console noise down; file transport carries the detail.
  electronLog.transports.console.level = 'info';
}

/**
 * Keep 3 archives: main.log → main.old.1.log → main.old.2.log → main.old.3.log
 * (electron-log's default keeps only one .old file).
 */
function rotateArchives(oldLogFile) {
  const fs = require('fs');
  const filePath = oldLogFile.toString();
  const base = filePath.replace(/\.log$/, '');
  try {
    fs.rmSync(`${base}.old.3.log`, { force: true });
    for (let i = 2; i >= 1; i--) {
      try {
        fs.renameSync(`${base}.old.${i}.log`, `${base}.old.${i + 1}.log`);
      } catch (e) {}
    }
    fs.renameSync(filePath, `${base}.old.1.log`);
  } catch (e) {
    // Rotation must never take the app down; worst case the file keeps growing.
  }
}

function scoped(scope) {
  if (!electronLog) return null;
  if (!scopes.has(scope)) scopes.set(scope, electronLog.scope(scope));
  return scopes.get(scope);
}

/** Pre-init calls fall back to console so early failures aren't lost. */
function emit(level, scope, args) {
  const target = scoped(scope);
  if (target) {
    target[level](...args);
  } else {
    const fallback = level === 'info' ? console.log : console.error;
    fallback(`[${scope}]`, ...args.map(redactValue));
  }
}

function info(scope, ...args) {
  emit('info', scope, args);
}

function warn(scope, ...args) {
  emit('warn', scope, args);
}

function error(scope, ...args) {
  emit('error', scope, args);
}

function getLogPath() {
  if (!electronLog) return null;
  try {
    return electronLog.transports.file.getFile().path;
  } catch (e) {
    return null;
  }
}

module.exports = { init, info, warn, error, redact, getLogPath };
