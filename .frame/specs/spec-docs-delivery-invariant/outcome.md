## T01 — Parameterize `docsManagedBlock` by block name, add `appendBlock` and `onAbsent`

Made every entry point take a block name (default: the spec section) so one document can carry several independently-versioned blocks, and added `appendBlock` — footer-aware insertion that rewrites nothing — reachable through `upgradeDoc`'s `onAbsent: 'append'`. The option lands only in the arm that previously returned `null` after every matcher failed; the marker-fragment guard now blocks appending too, so a second block never appears beside a corrupted first. Divergence from `tasks.md`: it says "the existing eleven tests", which was true when `cli-spec-command-parity` T01 recorded it — the file has since grown to 16, and all 16 pass unchanged.

_Captured: 2026-08-26 · 2 file change(s)_

---
