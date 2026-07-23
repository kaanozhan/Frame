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

<!-- frame:managed:spec-section v=1 -->
## Spec-Driven Development (.frame/specs/)

Frame supports a structured `spec → plan → tasks → implement` workflow. When the user asks you to define, plan, or implement a feature, prefer this workflow over ad-hoc edits — it preserves intent and keeps `tasks.json` in sync.

### File layout

Each spec lives in its own folder:

```
.frame/specs/<slug>/
  spec.md       — what we're building
  plan.md       — how (architecture, files, footprint, sequencing)
  tasks.md      — flat bullet list, "- T01 · description"
  status.json   — phase + metadata
```

`<slug>` is kebab-case, derived from the spec title.

### Lifecycle phases

`draft` → `specified` → `planned` → `tasks_generated` → `implementing` → `done`

Frame auto-advances phase from filesystem state (file presence). The command templates below tell you exactly which `status.json` updates to make; Frame's watcher reconciles if anything is missed.

### Running spec commands — the self-serve protocol

The four spec commands are `spec.new`, `spec.plan`, `spec.tasks` and `spec.implement`. Whether the user types them as slash commands or asks conversationally ("plan the auth spec", "implement the tasks"), the flow is **never improvised from memory** — each command's current flow lives in a template file that Frame keeps staged in the project. Run one like this:

**1. Resolve the target spec.** An explicitly named spec always wins. Otherwise list the specs (`.frame/specs/*/status.json`) whose phase the command acts on — `spec.plan` → `specified`, `spec.tasks` → `planned`, `spec.implement` → `tasks_generated` or `implementing`. Exactly one candidate → take it silently; zero or several → present the candidates and ask. `spec.new` creates a new spec: derive the kebab-case slug from the title.

**2. Resolve the template.** Take the first that exists:

1. `.frame/templates/commands/<tool>/<command>.md` — project override
2. `.frame/runtime/commands/<tool>/<command>.md` — staged by Frame on project open

`<tool>` is the directory matching your CLI (Claude Code → `claude-code`). If neither file exists, say so and ask the user to open this project in Frame once so it stages the current templates — then stop. **Do not reconstruct the flow from this file, from memory, or from an older prompt.**

**3. Interpolate the placeholders.** Replace each `{placeholder}` token in the template:

| Placeholder | Value |
| --- | --- |
| `{project_path}` | absolute path of the project root |
| `{slug}` | the spec's slug |
| `{title}` | the spec's title (from `status.json`; for `spec.new`, the new title) |
| `{description}` | the user's description (`spec.new` only; empty otherwise) |
| `{report_template_path}` | `.frame/runtime/commands/<tool>/plan-report-template.html` |
| `{report_generator_path}` | `.frame/runtime/commands/<tool>/build-implement-report.mjs` |

**4. Follow the interpolated template exactly**, including every `status.json` update it prescribes. The template is the flow; this section only tells you how to find it.

**5. Autonomous implement ceiling.** `spec.implement`'s autonomous mode needs permission flags that only a fresh, flagged launch can carry — a running session cannot acquire them. If the user picks autonomous conversationally, do what the template says: record the choice in the spec's `status.json` and hand off — the user clicks Implement on the spec's page in Frame and picks Autonomous, or runs `node .frame/bin/implement-launch.js <slug>` in a fresh terminal. Never run a degraded imitation silently.

### tasks.json linkage

After `spec.tasks`, **do not** also write entries to `tasks.json` — Frame's watcher imports them automatically with `source: "spec:<slug>:T<n>"` markers. Spec-generated tasks carry that `source` field; treat them like any other task — start them, complete them, update status. User-set status is preserved across spec re-imports; only title/description sync from `tasks.md`.

### When to suggest a spec (steer the conversation)

Spec-driven is Frame's core way of working, so when a user describes meaningful
new work **mid-conversation**, gently steer them toward a spec instead of
silently diving into code. Suggest a spec only for **significant work** — don't
make this a reflex on every message.

**Suggest a spec for:**
- A new **feature** or capability ("users should be able to …", "add a … system")
- A change that will touch **multiple files / modules** or affect architecture
- Anything that clearly benefits from a **plan and ordered tasks** before coding
- Work the user describes vaguely/largely that would benefit from being scoped first

**Do NOT suggest a spec for:**
- Typos, one-line fixes, small tweaks, renames → just do it
- Small, discrete tracked work → that's a task (`tasks.json`)
- Questions, debugging, explanations, experiments
- Anything the user explicitly says to "just do" / "do directly"

Rough ladder: *trivial → just do it · small but worth tracking → task · sizable
feature or multi-file change → spec.*

Ask once, in plain language, before coding. If they agree, start the spec flow
(`spec.new` → `spec.plan` → `spec.tasks`). If they decline or say "just do
it", proceed directly and **don't ask again for that same piece of work** in the
session. Never force it — the spec is an offer, not a gate; the user's stated
preference always wins.
<!-- /frame:managed:spec-section -->
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
