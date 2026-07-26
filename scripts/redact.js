/**
 * Secret redaction — shared by the app and the `.frame/bin/` scripts.
 *
 * This used to live inside `src/main/logger.js`, which works for the main
 * process but not for the scripts Frame copies into a project's
 * `.frame/bin/`: they run in their own process (git pre-commit hook, Claude
 * Code hooks, the orchestration bus) and cannot reach `src/main/`. Rather
 * than keep two copies of a security-relevant regex set that would drift
 * apart, the patterns live here and both sides require this file —
 * `logger.js` re-exports them so its public API is unchanged, and
 * `activity-log.js` requires it as a sibling.
 *
 * Node 18, no dependencies, no Electron — usable from plain node.
 */

'use strict';

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

module.exports = { redact, redactValue, REDACT_REPLACEMENT };
