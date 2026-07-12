# {{PROJECT_NAME}} - Frame Project

This project is managed with **Frame**: durable, structured context that keeps
AI agents oriented across sessions. This file is the always-on core.
**Before writing any Frame meta file, read the matching section of
`.frame/docs/REFERENCE.md`** — the maintenance rules live there, not here.

---

## Core Working Principle

**Only do what the user asks.** Do not go beyond the scope of the request.
Additional ideas are suggestions, presented after the request is done — never
implemented without approval.

---

## Project Navigation

**Read these at the start of each session:**

1. **STRUCTURE.json** — module map, which file is where
2. **PROJECT_NOTES.md** — project vision, past decisions, session notes
3. **tasks.json** — pending tasks

**Fast file lookup** — before manual grep/glob, run:

```bash
node .frame/bin/find-module.js <keyword>   # concept/synonym → files
node .frame/bin/find-module.js --list      # all features
```

**Freshness** — `node .frame/bin/check-freshness.js` reports when this
context is likely to mislead (phantom modules, stale STRUCTURE/notes, stuck
tasks). Trust its warnings over stale entries.

---

## Spec-Driven Development

Significant work flows through a spec (`spec.md` → `plan.md` → `tasks.md`)
before code. Rough ladder: *trivial → just do it · small but worth tracking →
task · sizable feature or multi-file change → spec.* Offer a spec once for
meaningful new work — never force it.

Full workflow (file layout, lifecycle, slash commands): see
**"Spec-Driven Development"** in `.frame/docs/REFERENCE.md`.

---

## Writing Frame meta files — read the reference first

| Before writing…  | Read in `.frame/docs/REFERENCE.md` |
| ---------------- | ------------------------------------ |
| tasks.json       | "Task Management" (schema + rules)   |
| PROJECT_NOTES.md | "PROJECT_NOTES.md Rules"             |
| STRUCTURE.json   | "STRUCTURE.json Rules"               |
| QUICKSTART.md    | "QUICKSTART.md Rules"                |

Quick reminders that always apply:
- Task work: `status: "in_progress"` when starting, `"completed"` +
  `completedAt` when done; re-check statuses after commits.
- Important decisions: append to PROJECT_NOTES.md as
  `### [YYYY-MM-DD] Title` with the conversation's context (not a summary).
- Documentation in English; dates in ISO 8601.

---

*This file was automatically created by Frame.*

---

**Note:** This file is named `AGENTS.md` to be AI-tool agnostic. A `CLAUDE.md` symlink is provided for Claude Code compatibility.
