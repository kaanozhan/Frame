
## T01 — Shared server rules: protocol, security, routing

Added src/shared/serverProtocol.js (hello/req/res/event validate, decode, builders, checkHello naming both versions, createPending with timeouts and rejectAll), src/shared/serverSecurity.js (256-bit token, constant-time compare, upgrade check requiring Bearer token and no Origin or 'frame-desktop', bindRule warning off localhost) and src/shared/serverRouting.js (srv- ids, remote URL normalization across scp/https/ssh, clone dir names unique by owner, ~/.ssh/config Host parsing), with three test files. Methods are restricted to 'namespace.name' so a request can never name anything else.

_Captured: 2026-11-10 · 6 file change(s)_

---
