---
keywords: decision cards, decisions.jsonl, decision memory, card delivery, spec close, supersedes, decisions view
related: spec-knowledge-layer, spec-close-step, decisions-view, frame-storage-seam, codex-parity, migration-consent-scope
---
Added decision cards: one JSON line per decision in `.frame/decisions.jsonl`, written by `decision.js add`, delivered to agents at edit, prompt, `/spec.new` and task-run time, owed by every closing spec, and listed in a Decision cards view.

- Writing: agents run `decision.js add`, which assigns the id (`<YYYYMMDD>-<6 hex>`) and UTC date, checks that a `spec:<slug>` or `notes:<date> <title>` source resolves, and that `supersedes`/`extends` name a *current* card. Cards are never edited; a newer card supersedes an old one. `related` lists candidate cards for the one question an agent asks before recording a chat decision.
- Reading: cards are read from the file on every use, not through the spec index (rejected: the installed 2.8.2 app rewrites the index with its own code, and the index watcher sees only `.frame/specs/`). Torn or invalid lines are skipped and named, never fatal.
- Delivery: only spec-less cards reach agents; spec cards are stored, checked and listed but never sent by a hook (D6, left to the final measurement). Cards are what gives way under a host's inline cap, one line each before any is dropped; a card is sent at most once per session across edit and prompt.
- Rules: a new managed block, `frame:managed:decision-section`, overrides the user-owned "add without asking" line; its prose never names `.frame/decisions.jsonl` as a path, because docsHealth flags named paths that are missing. Repo mode merges the file by union through `.frame/.gitattributes`.
- Close: `cards` is a close item owed only where `decision.js` exists; without it, `spec-close.js` output and every hint are byte-identical to before, and the no-card hook output is pinned against `8ce2aa8`.
- Deviations: `LOAD_DECISION_CARDS` landed in T07, not T08, because the renderer reads no files and task runs needed the cards; the close eval's finished fixtures carry a card (approved by the user). Converting this repo's spec-less notes into cards is left to the migration branch (D3).

Revised 2026-10-24: the cards view is named "Decisions" and the dock tab "Project Notes" now, not when the dock tab retires (plan D2); the dock tab still lists PROJECT_NOTES.md entries.

Chain: spec.md → plan.md → tasks.md → outcome.md
