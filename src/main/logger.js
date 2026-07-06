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
 * redact() is exported for writers that persist outside this logger
 * (promptLogger).
 */

const REDACT_REPLACEMENT = '[REDACTED]';

// Value-shaped secrets: recognizable token formats.
const TOKEN_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{10,}\b/g, // OpenAI / Anthropic style API keys (sk-…, sk-ant-…)
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, // GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_)
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, // GitHub fine-grained PATs
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key ids
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, // Slack tokens
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, // JWTs
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi // Authorization: Bearer …
];

// Key=value / key: value pairs with a secret-ish key. Keeps the key, drops
// the value.
const KEYED_PATTERN =
  /\b(password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|auth)(\s*[=:]\s*)(["']?)[^\s"'&;]{4,}\3/gi;

function redact(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  let out = text;
  for (const re of TOKEN_PATTERNS) {
    out = out.replace(re, REDACT_REPLACEMENT);
  }
  out = out.replace(KEYED_PATTERN, (m, key, sep, quote) => `${key}${sep}${quote}${REDACT_REPLACEMENT}${quote}`);
  return out;
}

function redactValue(value) {
  if (typeof value === 'string') return redact(value);
  if (value instanceof Error) {
    // Redact in place is unsafe (shared object) — clone the visible fields.
    const clone = new Error(redact(value.message));
    clone.name = value.name;
    clone.stack = redact(value.stack || '');
    if (value.code) clone.code = value.code;
    return clone;
  }
  return value;
}

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
