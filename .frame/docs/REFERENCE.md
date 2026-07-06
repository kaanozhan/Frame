# Frame Reference — meta-file maintenance rules

Read the relevant section of this file **before writing a Frame meta file**
(tasks.json, PROJECT_NOTES.md, STRUCTURE.json, QUICKSTART.md). The always-on
orientation lives in `AGENTS.md`; this file is loaded on demand.

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
  "title": "Short and clear title (max 60 characters)",
  "description": "AI's detailed explanation - what will be done, how it will be done, which files will be affected",
  "userRequest": "User's original request/prompt - copy exactly",
  "acceptanceCriteria": "When is this task considered complete? List of concrete criteria",
  "notes": "Important notes, decisions, alternatives that came up during discussion",
  "status": "pending | in_progress | completed",
  "priority": "high | medium | low",
  "category": "feature | fix | refactor | docs | test",
  "context": "Session date and context",
  "createdAt": "ISO date",
  "updatedAt": "ISO date",
  "completedAt": "ISO date | null"
}
```

### Task Content Rules

**title:** Short, action-oriented title
- ✅ "Add tasks button to terminal toolbar"
- ❌ "Tasks"

**description:** AI's detailed technical explanation
- What will be done (what)
- How it will be done (how) - brief technical approach
- Which files will be affected
- Minimum 2-3 sentences

**userRequest:** User's original words
- Copy the user's prompt/request exactly
- Important for preserving context
- In "User said: ..." format

**acceptanceCriteria:** Completion criteria
- Concrete, testable items
- "Task is complete when this happens" list

**notes:** Discussion notes (optional)
- Alternatives considered
- Important decisions and their reasons
- Dependencies marked as "we'll do this later"

### Task Status Updates

- When starting work on a task: `status: "in_progress"`
- When task is completed: `status: "completed"`, update `completedAt`
- After commit: Check and update the status of related tasks

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

### Context Preservation (Automatic Note Taking)

Frame's core purpose is to prevent context loss. Capture important moments
and ask the user: **"Should I add this conversation to PROJECT_NOTES.md?"**

Ask when:
- A task is successfully completed
- An important architectural/technical decision is made
- A bug is fixed and the solution method is noteworthy
- "Let's do this later" is said (in this case, also add to tasks.json)
- A new pattern or best practice is discovered

Completion signals to watch for:
- User approval: "okay", "done", "it worked", "nice", "fixed", "yes"
- Moving from one topic to another
- User continuing after build/run succeeds

How to add:
1. **DON'T write a summary** - Add the conversation as is, with its context
2. **Add date** - In `### [YYYY-MM-DD] Title` format
3. **Add to Session Notes section** - At the end of PROJECT_NOTES.md

When NOT to ask:
- For every small change (it becomes spam)
- Typo fixes, simple corrections
- If the user already said "no" or "not needed", don't ask again for the same topic in that session

If the user says "no": no problem, continue. The user can also say what they
consider important themselves: "add this to notes".

---

## STRUCTURE.json Rules

**This file is the map of the codebase.** It is auto-generated — prefer
`npm run structure` over hand-editing (only `architectureNotes` is meant for
manual insight; it is preserved verbatim across regens).

### When to Update?
- When a new file/folder is created
- When a file/folder is deleted or moved
- When module dependencies change
- When an IPC channel is added or changed
- When an important architectural pattern is discovered (architectureNotes)

### Format
```json
{
  "modules": {
    "main/tasksManager": {
      "path": "src/main/tasksManager.js",
      "purpose": "Task CRUD operations",
      "exports": ["init", "loadTasks", "addTask"],
      "depends": ["fs", "path", "shared/ipcChannels"]
    }
  },
  "ipcChannels": {
    "LOAD_TASKS": {
      "direction": "renderer → main",
      "handler": "main/tasksManager.js"
    }
  },
  "architectureNotes": {
    "circularDependencies": {
      "issue": "Description",
      "solution": "Solution"
    }
  }
}
```

### Update Rules
- Pre-commit hook updates automatically (before commit)
- Manual: `npm run structure`
- Staleness check: `npm run freshness` (phantom modules, drift, stuck tasks)
- If you added a new IPC channel, check the ipcChannels section
- Curated concept→file mapping lives in `scripts/intent-map.json`
  (agent-editable; synonyms make `find-module.js` resolve real concepts)

---

## QUICKSTART.md Rules

### When to Update?
- When installation steps change
- When new requirements are added
- When important commands change

---

## Spec-driven development — how to suggest

When a significant request appears, ask once, in plain language, before coding:

> "This is a sizable feature. Want me to handle it as a **spec** — I'll draft
> `spec.md`, then we plan it and generate tasks — or should I just implement it
> directly?"

- If the user agrees → start the spec flow (create the spec, then plan, then
  tasks). If they have the slash commands set up, point them at `/spec` etc.;
  otherwise scaffold `.frame/specs/<slug>/` per the existing structure.
- If the user says "just do it" / declines → proceed directly and **don't ask
  again for that same piece of work** in the session.
- Never force it. The spec is an offer, not a gate. The user's stated
  preference always wins.

**Do NOT suggest a spec for:** typos, one-line fixes, small tweaks, renames,
small discrete tracked work (that's a task), questions, debugging,
explanations, experiments, or anything the user says to "just do".

**For the plan step:** every `plan.md` must declare a `## Footprint` — a flat
`- <path>` list of the source files the spec touches (meta files excluded).
This is what the conductor and Frame use to schedule safely.

---

## Agent Orchestration — full detail

Frame can run **several specs in parallel**, each by its own agent in its own
git worktree, coordinated by a **conductor** agent. Open it from the Home
board ("Start Orchestrator") or the command palette (Open Orchestrator). The
unit of parallelism is the **spec** (a spec's own tasks run sequentially in
one lane); across specs run in parallel.

**Roles**
- **Conductor** — a Claude lane running `.frame/orchestration/CONDUCTOR.md`.
  It validates each assigned spec is `tasks_generated`, reads each spec's
  `## Footprint` (in `plan.md`) to detect file conflicts, dispatches
  parallel-safe specs, reviews worker reports, and merges.
- **Worker** — one Claude lane per spec, in `.frame/worktrees/<slug>` on
  branch `frame/<slug>/work`. Implements only that spec's `tasks.md` in
  order, commits to its own branch, **never pushes/merges**, and **never
  touches meta files** (tasks.json, STRUCTURE.json, PROJECT_NOTES.md,
  AGENTS.md).

**Command bus** — the conductor/worker talk to Frame via `.frame/bin/`:
`dispatch.js <slug>`, `report-done.js`, `merge.js <slug>`, `status.js`. Frame
(`orchestrationManager`) owns worktrees, the bus, a **code-enforced conflict
guard** (refuses to run a spec whose footprint overlaps an in-flight one),
and the fast-forward merge into `frame/<slug>/integration`. `main` is never
touched; promoting an integration branch / opening a PR stays a manual user
step.

---

## General Rules

1. **Language:** Write documentation in English (except code examples)
2. **Date Format:** ISO 8601 (YYYY-MM-DDTHH:mm:ssZ)
3. **After Commit:** Check tasks.json and STRUCTURE.json
4. **Session Start:** Review pending tasks in tasks.json
