# Outcome — Activity Monitor

## T01 — Extract redact() into scripts/redact.js

Moved `redact()`/`redactValue()` out of `src/main/logger.js` into a new
dependency-free `scripts/redact.js`, which `logger.js` now requires and
re-exports so its public API is untouched. The extraction exists because
`.frame/bin/` scripts run in their own processes and cannot reach
`src/main/`; a second copy of a security-relevant regex set would drift.
Redaction coverage in `test/logger.test.js` now exercises the new home and
adds a re-export assertion pinning `logger`'s exported key set.

_Captured: 2026-07-26 · 3 file change(s)_

---
