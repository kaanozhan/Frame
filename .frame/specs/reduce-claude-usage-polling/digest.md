---
keywords: usage polling, claude usage, rate limit, 429, interval
related: audit-q3-performance-resources
---
Single-value fix: Claude usage poll default went 60s → 300s in
claudeUsageManager (`startPolling` default; `init()` passes no argument so
the default IS the live cadence). Motivation: 429 rate-limit errors under
normal single-user use. Initial fetch and both IPC refresh paths untouched.
Later superseded in spirit by audit-q3-performance-resources, which moved
the same poll behind pollGate visibility gating + a 5-min TTL cache.

Chain: spec.md → plan.md → tasks.md → outcome.md
