# Frame - Project Instructions

This project is managed with **Frame**: durable, structured context that keeps
AI agents oriented across sessions. This file is the always-on core.
**Before writing any Frame meta file, read the matching section of
`.frame/docs/REFERENCE.md`** — the maintenance rules live there, not here.

> **Note:** This file is named `AGENTS.md` to be AI-tool agnostic. A
> `CLAUDE.md` symlink is provided for Claude Code compatibility.

---

## Core Working Principle

**Only do what the user asks.** Do not go beyond the scope of the request.

- Implement exactly what was requested — nothing more, nothing less.
- Do not change business logic, flow, or architecture unless explicitly asked.
- A design change means only the design changes — no refactors or new
  functionality alongside it.
- Additional ideas are **suggestions**, presented after the request is done.
  Never implement them without approval.

---

## 🧭 Project Navigation

**Read these at the start of each session:**

1. **STRUCTURE.json** — module map, which file is where
2. **PROJECT_NOTES.md** — project vision, past decisions, session notes
3. **tasks.json** — pending tasks

**Fast file lookup** — before manual grep/glob, run:

```bash
node scripts/find-module.js <keyword>   # concept/synonym → files (e.g. github, auth, worktree)
node scripts/find-module.js --list      # all features
```

**Freshness** — `npm run freshness` reports when this context is likely to
mislead (phantom modules, stale STRUCTURE/notes, stuck tasks). Trust its
warnings over stale entries.

---

## Spec-Driven Development

Significant work flows through a spec (`spec.md` → `plan.md` → `tasks.md`)
before code. When a user describes meaningful new work mid-conversation,
offer a spec once — never force it.

Rough ladder: *trivial → just do it · small but worth tracking → task ·
sizable feature or multi-file change → spec.*

How to offer, decline handling, and the plan `## Footprint` requirement:
see **"Spec-driven development"** in `.frame/docs/REFERENCE.md`.

---

## Writing Frame meta files — read the reference first

| Before writing…    | Read in `.frame/docs/REFERENCE.md`      |
| ------------------ | --------------------------------------- |
| tasks.json         | "Task Management" (schema + rules)      |
| PROJECT_NOTES.md   | "PROJECT_NOTES.md Rules"                 |
| STRUCTURE.json     | "STRUCTURE.json Rules" (usually auto: `npm run structure`) |
| QUICKSTART.md      | "QUICKSTART.md Rules"                    |

Quick reminders that always apply:
- Task work: set `status: "in_progress"` when starting, `"completed"` +
  `completedAt` when done; re-check statuses after commits.
- Important decisions: append to PROJECT_NOTES.md as
  `### [YYYY-MM-DD] Title` with the conversation's context (not a summary).
- Documentation in English; dates in ISO 8601.

---

## Agent Orchestration (summary)

Frame runs several specs in parallel — one **worker** agent per spec in its
own git worktree (`.frame/worktrees/<slug>`, branch `frame/<slug>/work`),
coordinated by a **conductor** (`.frame/orchestration/CONDUCTOR.md`) that
schedules by each plan's `## Footprint` and merges. Workers implement only
their spec's `tasks.md`, never push/merge, and **never touch meta files**
(tasks.json, STRUCTURE.json, PROJECT_NOTES.md, AGENTS.md). Command bus:
`.frame/bin/` (`dispatch.js`, `report-done.js`, `merge.js`, `status.js`).
`main` is never touched — promotion/PR stays manual.

Full roles and rules: **"Agent Orchestration"** in `.frame/docs/REFERENCE.md`.

---

*Managed by Frame. Maintenance reference: `.frame/docs/REFERENCE.md`*
