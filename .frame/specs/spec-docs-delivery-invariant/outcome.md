## T01 — Parameterize `docsManagedBlock` by block name, add `appendBlock` and `onAbsent`

Made every entry point take a block name (default: the spec section) so one document can carry several independently-versioned blocks, and added `appendBlock` — footer-aware insertion that rewrites nothing — reachable through `upgradeDoc`'s `onAbsent: 'append'`. The option lands only in the arm that previously returned `null` after every matcher failed; the marker-fragment guard now blocks appending too, so a second block never appears beside a corrupted first. Divergence from `tasks.md`: it says "the existing eleven tests", which was true when `cli-spec-command-parity` T01 recorded it — the file has since grown to 16, and all 16 pass unchanged.

_Captured: 2026-08-26 · 2 file change(s)_

---
## T02 — The pure doc-health report

Added `src/shared/docsHealth.js`: given the documents' texts, the managed blocks they should carry and an existence predicate, it returns every `.frame/…` path the prose names but that is not on disk, plus a per-block state. Paths are read from backticked prose and fenced commands alike; placeholders and bare directories are dropped. The state is four-valued on purpose — `managed`, `legacy`, `absent`, `unmatched` — because collapsing the last two is what would put a second protocol beside a user's own; heading detection is loose enough that a hand-written variant still reads as an existing section, and `upgradeDoc` serves as the oracle for the legacy gate so the report always agrees with what the repair pass will do. Run against this repository's own docs it reports both as `unmatched` with `ok: false`, reproducing the diagnosis this spec started from.

_Captured: 2026-08-26 · 2 file change(s)_

---
## T03 — Ensure the target before the pointer, and append where nothing conflicts

`upgradeSpecDocs` now builds a `docsHealth` report first and acts on it: an `unmatched` section is skipped and reported, an `absent` one is appended to, and AGENTS.md's pointer is written only once REFERENCE.md has been read back and confirmed to carry the block. It returns the report rather than nothing, so a broken invariant has somewhere to go. Divergence from `plan.md`, tightened while implementing: the plan gated the pointer on the target *existing*, but a REFERENCE.md that exists while carrying the user's own section would still leave the pointer aimed at a document without the protocol — the original bug in a softer form — so the gate became "the target carries the block", verified by reading it back. Tests are end-to-end over temp projects on purpose: a green `docsManagedBlock` suite is exactly what shipped alongside the delivery gap.

_Captured: 2026-08-26 · 3 file change(s)_

---
## T04 — Re-ensure the artifacts on open

Extracted `ensureCodexWrapper` from `runProjectInit` as a synchronous create-if-absent, added `ensureProjectArtifacts` (which calls `ensureSpecDrivenArtifacts` when spec-driven is on), and wired both into `specManager`'s `WATCH_SPECS` handler between command staging and `upgradeSpecDocs` — the order is the fix. `ensureSpecDrivenArtifacts` has always known how to create REFERENCE.md, expressly for pre-split projects, but its only callers were enable/disable and a pre-split project already has the flag on, so the branch never ran. Two divergences: `src/main/specManager.js` was not in `plan.md`'s Files, so the run stopped and resumed only after the user approved adding it — `plan.md` and the plan report now carry it; and `upgradeSpecDocs` was changed to survey twice, deciding from the state it found but reporting the state it leaves, because returning the pre-pass report would have the popover complain about a section the same pass had just repaired. The original v2.4.0 repro now comes out with the stale flow gone **and** the deep flow reachable in a single open.

_Captured: 2026-08-26 · 4 file change(s)_

---
