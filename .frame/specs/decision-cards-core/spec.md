---
keywords: decision cards, decisions.jsonl, decision memory, card delivery, spec close, project notes, decisions view, supersedes
related: spec-knowledge-layer, spec-close-step, decisions-view, migration-consent-scope, frame-storage-seam, codex-parity, agent-orchestration
---

# Decision cards core

## Problem

Decisions reach agents unevenly. A spec's decisions arrive through the spec
index at edit and prompt time. The 105 dated entries in this repo's
`PROJECT_NOTES.md` arrive at no deterministic moment, and nothing marks an old
one as overturned. Today's rules also let an agent add a note without asking
(`REFERENCE.md`, "Update Flow"), so what gets recorded depends on the agent.

## Goal

Every recorded decision leaves a **card**: one line in `.frame/decisions.jsonl`
holding the decision, a why of at most three sentences, keywords, files, a
`source` pointer to its story, `supersedes`/`extends`, an id and a date. The
story stays where it lives today: the spec chain for spec work, a
`PROJECT_NOTES.md` entry in today's format for spec-less work.

The core builds the card end to end for two writing moments and one reader:

- **Chat ask.** When a decision is made in conversation, the agent asks once,
  with any relation to an existing card inside the question. On a yes it writes
  the story entry and its card(s).
- **Spec close.** The turn that closes a spec writes the spec's cards beside
  its digest, and `spec-close.js` checks them as one more close item.
- **Index and delivery.** The spec index reads cards as a second source and
  drops superseded ones. Spec-less cards reach the agent through the existing
  hooks at the edit and work moments (`/spec.new`, `/spec.plan`, task runs).
  Spec cards are stored but not delivered.
- **Decisions view** shows cards with their source.
- **This repo:** its spec-less `PROJECT_NOTES.md` entries become cards the user
  approves.

## Constraints

- A project with no `decisions.jsonl` behaves exactly as today: same hints, same
  index, same Decisions view. This is the acceptance bar for the whole spec.
- From `spec-knowledge-layer`: the index stays derived and gitignored; hooks
  speak once per item per session, never block and never break; no
  `/spec.done`. Recorded decisions are respected or overturned by name.
- From `spec-close-step`: close state is read from disk only, so local and repo
  sharing modes behave alike; a card joins `CLOSE_ITEMS`; a missing card never
  blocks `done`; the reminder speaks only to the session that closed the spec; a
  meta record rides with the work it describes, never in a commit of its own.
- The spec channel does not change: spec lines keep reaching agents as today.
  Whether a spec card replaces its line is decided by the final measurement
  (roadmap step 7).
- Cards are never edited. Undo writes a card that supersedes the old one; delete
  exists only for a card written by mistake. No author field: authorship comes
  from git.
- Nothing is written from chat without the user's yes. The team's gate is the PR.
- Frame makes no model call: agents write cards, Frame validates and indexes them.
- From `migration-consent-scope`: no silent write to a user's root files. The
  `merge=union` rule for `decisions.jsonl` lives in `.frame/.gitattributes`.
- From `frame-storage-seam`: the card file's path comes from a named
  `frameStore` function, not a `path.join` at the call site.
- From `codex-parity`: every delivery also works through Codex's hooks.
- From `agent-orchestration`: workers never touch meta files, so cards from a
  parallel run are the conductor's job (out of scope here).
- Cards are written in English. `PROJECT_NOTES.md` keeps its place and its
  format; its split comes later.

## Success Criteria

- When the user says yes to recording a chat decision, then one
  `PROJECT_NOTES.md` entry in today's format and at least one card whose
  `source` points at it are written, and the agent asked exactly once.
- When the decision overturns or extends an existing card, then the question
  names that card, and the new card carries `supersedes` or `extends`.
- When the last task of a spec completes, then the closing turn writes the
  spec's cards with `source: spec:<slug>`, and `spec-close.js` reports a missing
  or malformed card as a defect while `done` stays derived as before.
- When an agent is about to edit a file listed on a spec-less card, then the
  edit-time hook delivers that card once per session, within the CLI's inline
  cap.
- When `/spec.new` or `/spec.plan` runs on a topic that matches a spec-less
  card, then the card is in that step's context.
- When a card is superseded, then the index drops it and only the newer card is
  delivered.
- When a spec card exists, then no hook delivers it.
- When two branches each add cards and are merged in repo mode, then
  `decisions.jsonl` merges without a conflict.
- When the Decisions view opens, then it lists the project's cards with their
  source, and a card's story opens from it.
- When the same deliveries run from Codex payloads, then they behave as for
  Claude Code.
- When this repo's spec-less `PROJECT_NOTES.md` entries are converted, then
  every resulting card was approved by the user.
- `npm test` passes, including tests for a project with no card file.

## Out of Scope

- Splitting `PROJECT_NOTES.md` and removing its old write instructions (step 4a).
- Decisions panel: left-nav placement, add, undo, delete (step 4b).
- Cards from task close, the conductor, and chat auto-suggestion (step 4c).
- Cold start from git history and the tour step (step 5).
- Converting old content into cards as a product feature (step 6).
- The final measurement and delivering spec cards (step 7).
- Old `PROJECT_NOTES.md` headings as a weak index source.

## Open Questions

- **How a card is written.** The agent appends the JSON line itself, or runs a
  Frame script (in the spirit of `spec-close.js`) that validates the line and
  assigns the id and date.
- **How the agent finds the card a new decision relates to** before asking: a
  script that lists candidate cards by keywords and files, or the existing
  `spec-context.js` extended to cards.
- **Prompt-time delivery of cards.** Part of this core as its last task, under a
  budget, or deferred to step 4c.
- **The Decisions view.** Cards and `PROJECT_NOTES.md` entries in one list, or
  cards as their own section beside the entries.
- **Approving this repo's converted cards.** One by one in the terminal, or as a
  reviewed batch in a single commit.
