# TaskFlow - Frame Project

This project is managed with **Frame**. AI assistants should follow the rules below to keep documentation up to date.

> **Note:** This is the **sample project** that ships with Frame. It's a fictional codebase used to demonstrate Frame's workflow on realistic content. None of this code runs. When you're ready, open your own project to start real work.

---

## Task Management (tasks.json)

### Task Recognition Rules

**These ARE TASKS - add to tasks.json:**
- When the user requests a feature or change
- Decisions like "Let's do this", "Let's add this", "Improve this"
- Deferred work when we say "We'll do this later", "Let's leave it for now"
- Gaps or improvement opportunities discovered while coding
- Situations requiring bug fixes

**These are NOT TASKS:**
- Error messages and debugging sessions
- Questions, explanations, information exchange
- Temporary experiments and tests
- Work already completed and closed
- Instant fixes (like typo fixes)

### Task Creation Flow

1. Detect task patterns during conversation
2. Ask the user at an appropriate moment: "I identified these tasks from our conversation, should I add them to tasks.json?"
3. If the user approves, add to tasks.json

### Task Structure

```json
{
  "id": "unique-id",
  "title": "Short and clear title",
  "description": "Detailed explanation",
  "status": "pending | in_progress | completed",
  "priority": "high | medium | low",
  "context": "Where/how this task originated",
  "createdAt": "ISO date",
  "updatedAt": "ISO date",
  "completedAt": "ISO date | null"
}
```

### Task Status Updates

- When starting work on a task: `status: "in_progress"`
- When task is completed: `status: "completed"`, update `completedAt`
- After commit: Check and update the status of related tasks

---

## Spec-Driven Development (.frame/specs/)

Frame supports a structured `spec → plan → tasks → implement` workflow. When the user asks you to define, plan, or implement a feature, prefer this workflow over ad-hoc edits — it preserves intent and keeps `tasks.json` in sync.

### File layout

Each spec lives in its own folder:

```
.frame/specs/<slug>/
  spec.md       — what we're building (Problem, Goal, Constraints, Success Criteria, Out of Scope)
  plan.md       — how (Architecture, Files, Dependencies, Sequencing)
  tasks.md      — flat bullet list, "- T01 · description"
  status.json   — phase + metadata
```

`<slug>` is kebab-case, derived from the spec title.

### Lifecycle phases

`draft` → `specified` → `planned` → `tasks_generated` → `implementing` → `done`

Frame auto-advances phase from filesystem state (file presence). After writing each artifact, update `status.json` so `phase`, `updated_at`, and `last_phase_at` reflect reality — Frame's watcher will reconcile if you forget.

### Slash commands

When the user types a Frame slash command, write **exactly one file** and then update `status.json`:

- `/spec.new <description>` → write `spec.md` (sections: Problem, Goal, Constraints, Success Criteria, Out of Scope). Phase → `specified`.
- `/spec.plan` → read `spec.md`, write `plan.md` (sections: Architecture, Files, Dependencies, Sequencing). Phase → `planned`.
- `/spec.tasks` → read `spec.md` + `plan.md`, write `tasks.md` as a flat `- T01 · ...` bullet list (5–12 tasks, imperative voice). Phase → `tasks_generated`.

After `/spec.tasks`, **do not** also write entries to `tasks.json` — Frame's watcher imports them automatically with `source: "spec:<slug>:T<n>"` markers.

### tasks.json linkage

Spec-generated tasks carry a `source` field. Treat them like any other task — start them, complete them, update status. User-set status is preserved across spec re-imports; only title/description sync from `tasks.md`.

### When to suggest a spec

If the user describes work bigger than a one-shot edit (a new feature, a multi-file refactor, a cross-cutting fix), suggest a spec first: *"This sounds like a spec — want me to draft `.frame/specs/<slug>/spec.md`?"*

For one-line typo fixes, build errors, or clarifying questions, skip the spec — go direct.

---

## PROJECT_NOTES.md Rules

### When to Update?
- When an important architectural decision is made
- When a technology choice is made
- When an important problem is solved and the solution method is noteworthy
- When an approach is determined together with the user

### Format
Free format. Date + title is sufficient:
```markdown
### [2026-01-26] Topic title
Conversation/decision as is, with its context...
```

### Update Flow
- Update immediately after a decision is made
- You can add without asking the user (for important decisions)
- You can accumulate small decisions and add them in bulk

---

## 📝 Context Preservation (Automatic Note Taking)

Frame's core purpose is to prevent context loss. Therefore, capture important moments and ask the user.

### When to Ask?

Ask the user when one of the following situations occurs: **"Should I add this conversation to PROJECT_NOTES.md?"**

- When a task is successfully completed
- When an important architectural/technical decision is made
- When a bug is fixed and the solution method is noteworthy
- When "let's do this later" is said (in this case, also add to tasks.json)
- When a new pattern or best practice is discovered

### Completion Detection

Pay attention to these signals:
- User approval: "okay", "done", "it worked", "nice", "fixed", "yes"
- Moving from one topic to another
- User continuing after build/run succeeds

### How to Add?

1. **DON'T write a summary** - Add the conversation as is, with its context
2. **Add date** - In `### [YYYY-MM-DD] Title` format
3. **Add to Session Notes section** - At the end of PROJECT_NOTES.md

### When NOT to Ask

- For every small change (it becomes spam)
- Typo fixes, simple corrections
- If the user already said "no" or "not needed", don't ask again for the same topic in that session

### If User Says "No"

No problem, continue. The user can also say what they consider important themselves: "add this to notes"

---

## STRUCTURE.json Rules

**This file is the map of the codebase.**

### When to Update?
- When a new file/folder is created
- When a file/folder is deleted or moved
- When module dependencies change
- When an important architectural pattern is discovered (architectureNotes)

### Format
```json
{
  "modules": {
    "moduleName": {
      "path": "src/module",
      "purpose": "What this module does",
      "depends": ["otherModule"]
    }
  },
  "architectureNotes": {}
}
```

---

## General Rules

1. **Language:** Write documentation in English (except code examples)
2. **Date Format:** ISO 8601 (YYYY-MM-DDTHH:mm:ssZ)
3. **After Commit:** Check tasks.json and STRUCTURE.json
4. **Session Start:** Review pending tasks in tasks.json

---

## TaskFlow — Project Specifics

Beyond the standard Frame rules above, here's what's specific to this codebase:

**Stack:**
- Backend: Node.js 20, Express 4
- Database: PostgreSQL 16 (migrated from SQLite — see `.frame/specs/migrate-to-postgres/`)
- Auth: Google OAuth via Passport.js
- Frontend: React 18 + Vite

**Conventions:**
- Database access lives in `src/db/`; API handlers never touch SQL directly
- React components stay under 150 lines; split into sub-folders when they grow
- Commit messages: imperative mood, one-line summary + optional body

**Specs in flight:**
- `.frame/specs/add-google-oauth/` — shipped (read `outcome.md`)
- `.frame/specs/migrate-to-postgres/` — implementing (4 of 8 tasks done)
- `.frame/specs/email-notifications/` — planned, awaiting `/spec.tasks`

---

**Note:** This file is named `AGENTS.md` to be AI-tool agnostic. A `CLAUDE.md` symlink is provided for Claude Code compatibility, and a `GEMINI.md` for Gemini CLI.
