---
keywords: notify, toast, escapeHtml, error feedback, confirm modal, boot failsafe
related: audit-q3-reliability-recovery
---
Replaced the renderer's silent-failure pattern with one feedback discipline:
`notify.js` is THE toast (single instance, textContent-only — closed the
unescaped-innerHTML hole) and `htmlUtils.js` is THE escapeHtml — the audit
counted 15 copies, implementation removed 21. All Frame-create call sites
try/catch → distinct cap-vs-backend messages (createTerminal returns null at
cap but REJECTS on backend failure — that rejection used to vanish).
Confirm modals: initial focus Cancel, Enter activates focused button only.
Boot failsafe swaps the splash to a Retry state instead of hiding into a
blank app. Parked/hidden buttons removed. Rule of record: never add a local
escapeHtml or showToast — require the shared modules.

Chain: spec.md → plan.md → tasks.md → outcome.md
