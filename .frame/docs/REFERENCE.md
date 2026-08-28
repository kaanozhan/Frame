# Frame Reference — meta-file maintenance rules

Read the relevant section of this file **before writing a Frame meta file**
(`.frame/tasks.json`, `.frame/PROJECT_NOTES.md`, `.frame/STRUCTURE.json`,
`.frame/QUICKSTART.md`). The always-on orientation lives in `.frame/AGENTS.md`;
this file is loaded on demand.

---

## Task Management (tasks.json)

### Task Recognition Rules

**These ARE TASKS - add to .frame/tasks.json:**
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
2. Ask the user at an appropriate moment: "I identified these tasks from our conversation, should I add them to .frame/tasks.json?"
3. If the user approves, add to .frame/tasks.json

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
and ask the user: **"Should I add this conversation to .frame/PROJECT_NOTES.md?"**

Ask when:
- A task is successfully completed
- An important architectural/technical decision is made
- A bug is fixed and the solution method is noteworthy
- "Let's do this later" is said (in this case, also add to .frame/tasks.json)
- A new pattern or best practice is discovered

Completion signals to watch for:
- User approval: "okay", "done", "it worked", "nice", "fixed", "yes"
- Moving from one topic to another
- User continuing after build/run succeeds

How to add:
1. **DON'T write a summary** - Add the conversation as is, with its context
2. **Add date** - In `### [YYYY-MM-DD] Title` format
3. **Add to Session Notes section** - At the end of .frame/PROJECT_NOTES.md

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

<!-- frame:managed:spec-section v=2 -->
## Spec-Driven Development (.frame/specs/)

Frame supports a structured `spec → plan → tasks → implement` workflow. When the user asks you to define, plan, or implement a feature, prefer this workflow over ad-hoc edits — it preserves intent and keeps `.frame/tasks.json` in sync.

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

### .frame/tasks.json linkage

After `spec.tasks`, **do not** also write entries to `.frame/tasks.json` — Frame's watcher imports them automatically with `source: "spec:<slug>:T<n>"` markers. Spec-generated tasks carry that `source` field; treat them like any other task — start them, complete them, update status. User-set status is preserved across spec re-imports; only title/description sync from `tasks.md`.

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
- Small, discrete tracked work → that's a task (`.frame/tasks.json`)
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
  touches meta files** (.frame/tasks.json, .frame/STRUCTURE.json, .frame/PROJECT_NOTES.md,
  .frame/AGENTS.md).

**Command bus** — the conductor/worker talk to Frame via `.frame/bin/`:
`dispatch.js <slug>`, `report-done.js`, `merge.js <slug>`, `status.js`. Frame
(`orchestrationManager`) owns worktrees, the bus, a **code-enforced conflict
guard** (refuses to run a spec whose footprint overlaps an in-flight one),
and the fast-forward merge into `frame/<slug>/integration`. `main` is never
touched; promoting an integration branch / opening a PR stays a manual user
step.

---

## Spec Knowledge Layer

The spec archive doubles as durable memory: what was done, why that path won
(rejected alternatives included), and what actually happened. The layer
delivers it deterministically.

**Index (generated — never edit, never commit).**
`.frame/index/spec-index.json`, built by `scripts/spec-index.js` from spec
artifacts: plan `## Footprint` (intent) + outcome `Files touched:` (actuals)
+ `spec.md`/`digest.md` front-matter (`keywords:/related:/supersedes:`).
Git adds enrichment only (renames, post-close stale flags). Two views:
`topics` (slug → catalog record) and `files` (path → chronological records,
newest = current truth; flags: `current`, `stale`, `laterSpecs`, `inflight`,
`movedTo`). Phase filter: done → full records; planned/implementing →
in-flight warnings; specified → topics only; `superseded_by` in status.json
→ excluded. Frame refreshes it on spec status writes (debounced
`ensureFresh`); it rebuilds lazily on read paths. **Orchestration workers
never regenerate it** (extension of the meta-file rule).

**digest.md** — written when a spec's last task completes (spec.implement /
WORKER.md step): front-matter + ≤15 lines from *outcome actuals* (what, why
this path won, result, rules established) + the chain line. It is the entry
point, not the substitute: on a hit, read
`spec.md → plan.md → tasks.md → outcome.md`.

**Delivery.** Claude Code sessions get history injected by hooks
(`scripts/spec-hint.js` via `.claude/settings.json`): PreToolUse on
Edit/Write (moment of intent — deliberately not Grep/Read), UserPromptSubmit
for topics. Once per file/topic per session; 3+ specs on one file → one line
each + pointer (entries are never dropped); `FRAME_SPEC_HINT_MODE=signal`
switches to signal-only. Hooks are read-only and never-break: any failure →
exit 0, silence. `spec.plan`'s evidence pass and worker prompts preload
footprint history; `spec.new` embeds the full catalog for relatedness
evaluation. Other CLIs use the advisory commands in .frame/AGENTS.md
(`spec-context.js`).

**Rules that always apply.** Respect recorded decisions or overturn them
explicitly — never silently contradict a prior spec. Treat `STALE` records
as leads to verify, not truth. Declare `supersedes:` when a spec replaces
one; mark dead specs with `"superseded_by"` in their status.json.

---

## Activity Monitor

**What it is.** A record of the work Frame does *on its own* — and only
that. The filter is one rule: record it when Frame is the trigger (a timer,
a watcher, a hook, a guard, a recovery); do not record it when the user's
gesture is the trigger and the result is already on screen. Opening a panel
is absent; the watcher cascade a click sets off is present.

**Why it exists.** Roughly half of Frame's background work runs in processes
the app cannot see — the git pre-commit hook, Claude Code's tool hooks, the
orchestration bus, `implement-launch.js` with the app closed — and the rest
is invisible by nature. Before this layer, `spec-hint.js` exited silently on
eleven different paths, so "ran and stayed quiet" was indistinguishable from
"never fired" and from "never installed".

**Where the pieces live.**

| Piece | File | Role |
| --- | --- | --- |
| Append contract | `scripts/activity-log.js` | JSONL append, bucket keys, rotation, prune. Shipped to `.frame/bin/`, so out-of-process scripts write through the same file. |
| Redaction | `scripts/redact.js` | Shared with `logger.js`; one copy, both worlds. |
| Registry | `src/shared/activityEvents.js` | Every recordable event, its kind, its field enums, its label. Pure. |
| App wrapper | `src/main/activityLog.js` | Ring buffer, rate cap, burst aggregation, self-write stamp, IPC. |
| UI | `src/renderer/activityPanel.js`, `activityRail.js` | Side panel + fixed outer-edge rail. |

**Two kinds of event, and the second one matters most.** An `action` is work
that happened. A `suppression` is work a guard prevented — a poll skipped on
a hidden window, an index rebuild that was already fresh, a hook quiet
because the file was covered this session. Without suppressions the panel
shows silence, and silence means either "healthy, nothing needed" or "dead".
Suppressions render muted, never hidden.

**Storage.** `~/.frame/activity/<key>/activity.jsonl`, outside the
repository (Frame never edits a project's `.gitignore`). The key derives
from the **absolute** project path — never `path.basename`, which is the
collision `promptLogger` still has. 2 MB rotation into one generation, plus
a 7-day sweep reusing `spec-hint.js`'s `STATE_TTL_MS`.

**Rules for adding a source.**

1. Declare the event in `src/shared/activityEvents.js` first — an
   undeclared event is dropped, and that is what stops the drift
   `perfMonitor.js` accumulated.
2. Fields are enums, counts, durations, paths and slugs. **Never add a
   free-form text field**; that is how a prompt or an error message
   eventually lands on disk.
3. Any registry change updates `PRIVACY.md` in the same commit.
4. Recording must never break its host: guarded require in `.frame/bin/`
   scripts, lazy require in early-boot modules, no stdout, no throw.
5. Suppressions declare `repeats` so an aggregated burst reports its true
   count. `collapsed` is a different fact — a debounce folding filesystem
   events — and the two must not be conflated.

**Not in scope (Tier 1).** Repo-mutation records and `.frame/bin/`
version-drift detection (Tier 2); orchestration bus, PTY and IPC detail
(Tier 3); agent access to the record.

---

## General Rules

1. **Language:** Write documentation in English (except code examples)
2. **Date Format:** ISO 8601 (YYYY-MM-DDTHH:mm:ssZ)
3. **After Commit:** Check `.frame/tasks.json` and `.frame/STRUCTURE.json`
4. **Session Start:** Review pending tasks in `.frame/tasks.json`
