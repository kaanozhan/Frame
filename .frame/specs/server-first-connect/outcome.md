
## T01 — Recognise ssh failures (sshErrors)

Added `src/shared/sshErrors.js`: `classify(stderr, code)` maps OpenSSH's own stderr to host-unknown / host-changed / auth / no-resolve / refused / timeout / unreachable, only on exit 255, with host-changed checked before host-unknown; `needsUser`, `describe` (one sentence per kind, `setup` action for host-unknown and auth only) and `setupCommand` (ssh-keygen only when no `~/.ssh/id_*.pub`, then `ssh-copy-id` with the host single-quoted). `test/sshErrors.test.js` covers real stderr samples with placeholder hosts, the exit-code guard, the fallback and the quoting through a real `sh`.

_Captured: 2026-11-16 · 2 file change(s)_

---
