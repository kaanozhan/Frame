## T01 — Parameterize `docsManagedBlock` by block name, add `appendBlock` and `onAbsent`

Made every entry point take a block name (default: the spec section) so one document can carry several independently-versioned blocks, and added `appendBlock` — footer-aware insertion that rewrites nothing — reachable through `upgradeDoc`'s `onAbsent: 'append'`. The option lands only in the arm that previously returned `null` after every matcher failed; the marker-fragment guard now blocks appending too, so a second block never appears beside a corrupted first. Divergence from `tasks.md`: it says "the existing eleven tests", which was true when `cli-spec-command-parity` T01 recorded it — the file has since grown to 16, and all 16 pass unchanged.

_Captured: 2026-08-26 · 2 file change(s)_

---
## T02 — The pure doc-health report

Added `src/shared/docsHealth.js`: given the documents' texts, the managed blocks they should carry and an existence predicate, it returns every `.frame/…` path the prose names but that is not on disk, plus a per-block state. Paths are read from backticked prose and fenced commands alike; placeholders and bare directories are dropped. The state is four-valued on purpose — `managed`, `legacy`, `absent`, `unmatched` — because collapsing the last two is what would put a second protocol beside a user's own; heading detection is loose enough that a hand-written variant still reads as an existing section, and `upgradeDoc` serves as the oracle for the legacy gate so the report always agrees with what the repair pass will do. Run against this repository's own docs it reports both as `unmatched` with `ok: false`, reproducing the diagnosis this spec started from.

_Captured: 2026-08-26 · 2 file change(s)_

---
