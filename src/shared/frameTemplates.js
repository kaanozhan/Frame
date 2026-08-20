/**
 * Frame Templates
 * Templates for auto-generated Frame project files
 * Each template includes instructions header for Claude Code
 */

const managedBlock = require('./docsManagedBlock');

/**
 * Get current date in YYYY-MM-DD format
 */
function getDateString() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Get current ISO timestamp
 */
function getISOTimestamp() {
  return new Date().toISOString();
}

/**
 * Spec-section versioning (cli-spec-command-parity).
 *
 * The spec sections in REFERENCE.md and AGENTS.md are managed blocks —
 * wrapped in versioned markers (see src/shared/docsManagedBlock.js) so Frame
 * can upgrade its own text in place on project open without touching user
 * prose. Bump SPEC_SECTION_VERSION whenever SPEC_DRIVEN_SECTION or
 * SPEC_DRIVEN_CORE_SECTION changes; docs stamped with an older version are
 * rewritten on next open, docs stamped current are left alone (so user tweaks
 * inside the block survive between identical Frame versions).
 */
const SPEC_SECTION_VERSION = 1;

/**
 * Previous shipped generations of the spec sections, preserved byte-for-byte
 * as legacy migration matchers: a project doc that still contains one of
 * these texts verbatim (whitespace-normalized) was written by Frame and never
 * touched by the user, so the one-time migration to a managed block is safe.
 * Never edit these — they must match what older Frames actually wrote.
 */
const LEGACY_SPEC_DRIVEN_SECTION = `## Spec-Driven Development (.frame/specs/)

Frame supports a structured \`spec → plan → tasks → implement\` workflow. When the user asks you to define, plan, or implement a feature, prefer this workflow over ad-hoc edits — it preserves intent and keeps \`tasks.json\` in sync.

### File layout

Each spec lives in its own folder:

\`\`\`
.frame/specs/<slug>/
  spec.md       — what we're building (Problem, Goal, Constraints, Success Criteria, Out of Scope)
  plan.md       — how (Architecture, Files, Dependencies, Sequencing)
  tasks.md      — flat bullet list, "- T01 · description"
  status.json   — phase + metadata
\`\`\`

\`<slug>\` is kebab-case, derived from the spec title.

### Lifecycle phases

\`draft\` → \`specified\` → \`planned\` → \`tasks_generated\` → \`implementing\` → \`done\`

Frame auto-advances phase from filesystem state (file presence). After writing each artifact, update \`status.json\` so \`phase\`, \`updated_at\`, and \`last_phase_at\` reflect reality — Frame's watcher will reconcile if you forget.

### Slash commands

When the user types a Frame slash command, write **exactly one file** and then update \`status.json\`:

- \`/spec.new <description>\` → write \`spec.md\` (sections: Problem, Goal, Constraints, Success Criteria, Out of Scope). Phase → \`specified\`.
- \`/spec.plan\` → read \`spec.md\`, write \`plan.md\` (sections: Architecture, Files, Dependencies, Sequencing). Phase → \`planned\`.
- \`/spec.tasks\` → read \`spec.md\` + \`plan.md\`, write \`tasks.md\` as a flat \`- T01 · ...\` bullet list (5–12 tasks, imperative voice). Phase → \`tasks_generated\`.

After \`/spec.tasks\`, **do not** also write entries to \`tasks.json\` — Frame's watcher imports them automatically with \`source: "spec:<slug>:T<n>"\` markers.

### tasks.json linkage

Spec-generated tasks carry a \`source\` field. Treat them like any other task — start them, complete them, update status. User-set status is preserved across spec re-imports; only title/description sync from \`tasks.md\`.

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
- Small, discrete tracked work → that's a task (\`tasks.json\`)
- Questions, debugging, explanations, experiments
- Anything the user explicitly says to "just do" / "do directly"

Rough ladder: *trivial → just do it · small but worth tracking → task · sizable
feature or multi-file change → spec.*

Ask once, in plain language, before coding. If they agree, start the spec flow
(\`/spec.new\` → \`/spec.plan\` → \`/spec.tasks\`). If they decline or say "just do
it", proceed directly and **don't ask again for that same piece of work** in the
session. Never force it — the spec is an offer, not a gate; the user's stated
preference always wins.`;

const LEGACY_SPEC_DRIVEN_CORE_SECTION = `## Spec-Driven Development

Significant work flows through a spec (\`spec.md\` → \`plan.md\` → \`tasks.md\`)
before code. Rough ladder: *trivial → just do it · small but worth tracking →
task · sizable feature or multi-file change → spec.* Offer a spec once for
meaningful new work — never force it.

Full workflow (file layout, lifecycle, slash commands): see
**"Spec-Driven Development"** in \`.frame/docs/REFERENCE.md\`.`;

/**
 * Oldest shipped generation of the full section (before the "steer the
 * conversation" rewrite): AGENTS.md predating the AGENTS/REFERENCE split
 * carried the full section, so both full-section generations are legal
 * AGENTS.md matchers. REFERENCE.md was born after the rewrite and only ever
 * carried the newer text.
 */
const LEGACY_SPEC_DRIVEN_SECTION_V0 = `## Spec-Driven Development (.frame/specs/)

Frame supports a structured \`spec → plan → tasks → implement\` workflow. When the user asks you to define, plan, or implement a feature, prefer this workflow over ad-hoc edits — it preserves intent and keeps \`tasks.json\` in sync.

### File layout

Each spec lives in its own folder:

\`\`\`
.frame/specs/<slug>/
  spec.md       — what we're building (Problem, Goal, Constraints, Success Criteria, Out of Scope)
  plan.md       — how (Architecture, Files, Dependencies, Sequencing)
  tasks.md      — flat bullet list, "- T01 · description"
  status.json   — phase + metadata
\`\`\`

\`<slug>\` is kebab-case, derived from the spec title.

### Lifecycle phases

\`draft\` → \`specified\` → \`planned\` → \`tasks_generated\` → \`implementing\` → \`done\`

Frame auto-advances phase from filesystem state (file presence). After writing each artifact, update \`status.json\` so \`phase\`, \`updated_at\`, and \`last_phase_at\` reflect reality — Frame's watcher will reconcile if you forget.

### Slash commands

When the user types a Frame slash command, write **exactly one file** and then update \`status.json\`:

- \`/spec.new <description>\` → write \`spec.md\` (sections: Problem, Goal, Constraints, Success Criteria, Out of Scope). Phase → \`specified\`.
- \`/spec.plan\` → read \`spec.md\`, write \`plan.md\` (sections: Architecture, Files, Dependencies, Sequencing). Phase → \`planned\`.
- \`/spec.tasks\` → read \`spec.md\` + \`plan.md\`, write \`tasks.md\` as a flat \`- T01 · ...\` bullet list (5–12 tasks, imperative voice). Phase → \`tasks_generated\`.

After \`/spec.tasks\`, **do not** also write entries to \`tasks.json\` — Frame's watcher imports them automatically with \`source: "spec:<slug>:T<n>"\` markers.

### tasks.json linkage

Spec-generated tasks carry a \`source\` field. Treat them like any other task — start them, complete them, update status. User-set status is preserved across spec re-imports; only title/description sync from \`tasks.md\`.

### When to suggest a spec

If the user describes work bigger than a one-shot edit (a new feature, a multi-file refactor, a cross-cutting fix), suggest a spec first: *"This sounds like a spec — want me to draft \`.frame/specs/<slug>/spec.md\`?"*

For one-line typo fixes, build errors, or clarifying questions, skip the spec — go direct.`;

/**
 * Legacy matchers per doc: REFERENCE.md only ever carried the newest legacy
 * full section; AGENTS.md carried the short core pointer since the
 * AGENTS/REFERENCE split, and either full-section generation before it.
 * docsManagedBlock.upgradeDoc migrates a section to a managed block only
 * when it matches one of these.
 */
const REFERENCE_SPEC_LEGACY_MATCHERS = [LEGACY_SPEC_DRIVEN_SECTION];
const AGENTS_SPEC_LEGACY_MATCHERS = [
  LEGACY_SPEC_DRIVEN_CORE_SECTION,
  LEGACY_SPEC_DRIVEN_SECTION,
  LEGACY_SPEC_DRIVEN_SECTION_V0
];

/**
 * Spec-Driven Development section — the full self-serve protocol shipped to
 * .frame/docs/REFERENCE.md. Current generation: teaches a CLI session asked
 * conversationally to run a spec command to find and follow the staged
 * template instead of improvising the flow from memory. Emitted wrapped in
 * managed-block markers (SPEC_SECTION_VERSION).
 */
const SPEC_DRIVEN_SECTION = `## Spec-Driven Development (.frame/specs/)

Frame supports a structured \`spec → plan → tasks → implement\` workflow. When the user asks you to define, plan, or implement a feature, prefer this workflow over ad-hoc edits — it preserves intent and keeps \`tasks.json\` in sync.

### File layout

Each spec lives in its own folder:

\`\`\`
.frame/specs/<slug>/
  spec.md       — what we're building
  plan.md       — how (architecture, files, footprint, sequencing)
  tasks.md      — flat bullet list, "- T01 · description"
  status.json   — phase + metadata
\`\`\`

\`<slug>\` is kebab-case, derived from the spec title.

### Lifecycle phases

\`draft\` → \`specified\` → \`planned\` → \`tasks_generated\` → \`implementing\` → \`done\`

Frame auto-advances phase from filesystem state (file presence). The command templates below tell you exactly which \`status.json\` updates to make; Frame's watcher reconciles if anything is missed.

### Running spec commands — the self-serve protocol

The four spec commands are \`spec.new\`, \`spec.plan\`, \`spec.tasks\` and \`spec.implement\`. Whether the user types them as slash commands or asks conversationally ("plan the auth spec", "implement the tasks"), the flow is **never improvised from memory** — each command's current flow lives in a template file that Frame keeps staged in the project. Run one like this:

**1. Resolve the target spec.** An explicitly named spec always wins. Otherwise list the specs (\`.frame/specs/*/status.json\`) whose phase the command acts on — \`spec.plan\` → \`specified\`, \`spec.tasks\` → \`planned\`, \`spec.implement\` → \`tasks_generated\` or \`implementing\`. Exactly one candidate → take it silently; zero or several → present the candidates and ask. \`spec.new\` creates a new spec: derive the kebab-case slug from the title.

**2. Resolve the template.** Take the first that exists:

1. \`.frame/templates/commands/<tool>/<command>.md\` — project override
2. \`.frame/runtime/commands/<tool>/<command>.md\` — staged by Frame on project open

\`<tool>\` is the directory matching your CLI (Claude Code → \`claude-code\`). If neither file exists, say so and ask the user to open this project in Frame once so it stages the current templates — then stop. **Do not reconstruct the flow from this file, from memory, or from an older prompt.**

**3. Interpolate the placeholders.** Replace each \`{placeholder}\` token in the template:

| Placeholder | Value |
| --- | --- |
| \`{project_path}\` | absolute path of the project root |
| \`{slug}\` | the spec's slug |
| \`{title}\` | the spec's title (from \`status.json\`; for \`spec.new\`, the new title) |
| \`{description}\` | the user's description (\`spec.new\` only; empty otherwise) |
| \`{report_template_path}\` | \`.frame/runtime/commands/<tool>/plan-report-template.html\` |
| \`{report_generator_path}\` | \`.frame/runtime/commands/<tool>/build-implement-report.mjs\` |

**4. Follow the interpolated template exactly**, including every \`status.json\` update it prescribes. The template is the flow; this section only tells you how to find it.

**5. Autonomous implement ceiling.** \`spec.implement\`'s autonomous mode needs permission flags that only a fresh, flagged launch can carry — a running session cannot acquire them. If the user picks autonomous conversationally, do what the template says: record the choice in the spec's \`status.json\` and hand off — the user clicks Implement on the spec's page in Frame and picks Autonomous, or runs \`node .frame/bin/implement-launch.js <slug>\` in a fresh terminal. Never run a degraded imitation silently.

### tasks.json linkage

After \`spec.tasks\`, **do not** also write entries to \`tasks.json\` — Frame's watcher imports them automatically with \`source: "spec:<slug>:T<n>"\` markers. Spec-generated tasks carry that \`source\` field; treat them like any other task — start them, complete them, update status. User-set status is preserved across spec re-imports; only title/description sync from \`tasks.md\`.

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
- Small, discrete tracked work → that's a task (\`tasks.json\`)
- Questions, debugging, explanations, experiments
- Anything the user explicitly says to "just do" / "do directly"

Rough ladder: *trivial → just do it · small but worth tracking → task · sizable
feature or multi-file change → spec.*

Ask once, in plain language, before coding. If they agree, start the spec flow
(\`spec.new\` → \`spec.plan\` → \`spec.tasks\`). If they decline or say "just do
it", proceed directly and **don't ask again for that same piece of work** in the
session. Never force it — the spec is an offer, not a gate; the user's stated
preference always wins.`;

/**
 * Short Spec-Driven section for the lean AGENTS.md core — the ladder and a
 * pointer; the full workflow lives in .frame/docs/REFERENCE.md. Emitted
 * wrapped in managed-block markers (SPEC_SECTION_VERSION).
 */
const SPEC_DRIVEN_CORE_SECTION = `## Spec-Driven Development

Significant work flows through a spec (\`spec.md\` → \`plan.md\` → \`tasks.md\`)
before code. Rough ladder: *trivial → just do it · small but worth tracking →
task · sizable feature or multi-file change → spec.* Offer a spec once for
meaningful new work — never force it.

Spec commands (\`spec.new\` / \`spec.plan\` / \`spec.tasks\` / \`spec.implement\`)
are **never run from memory** — each one's current flow is a staged template.
The self-serve protocol (resolve spec → resolve template → interpolate →
follow exactly) lives in **"Spec-Driven Development"** in
\`.frame/docs/REFERENCE.md\`.`;

/**
 * The spec sections as actually emitted into docs: wrapped in managed-block
 * markers stamped with the current version, so new projects are born managed
 * and the upgrade driver can version-gate them later.
 */
function renderSpecSection() {
  return managedBlock.renderBlock(SPEC_DRIVEN_SECTION, SPEC_SECTION_VERSION);
}

function renderSpecCoreSection() {
  return managedBlock.renderBlock(SPEC_DRIVEN_CORE_SECTION, SPEC_SECTION_VERSION);
}

/**
 * AGENTS.md template - the lean always-on core read by AI coding tools
 * (Claude Code, Codex CLI, etc.) every session: orientation only. The
 * maintenance ceremony lives in .frame/docs/REFERENCE.md
 * (getReferenceTemplate) and is loaded on demand.
 *
 * options:
 *   specDriven: include the short Spec-Driven Development section. Init
 *               passes true (the feature is on for new projects); the
 *               parameter stays explicit because pre-existing projects that
 *               opted out must not get the section back on re-emit.
 */
/**
 * Render the Project Facts section for AGENTS.md from the detected project
 * block. The section exists even without detection — its job is to make the
 * agent RECORD the user's real stack, not to celebrate Frame's bookkeeping.
 */
function formatProjectFacts(project) {
  const record = `Record this project's own stack, conventions, entrypoints and commands here
as you learn them; correct anything detection got wrong. **Never assume this
project's shape generalizes** — verify layout/language/tooling before baking
an assumption into code or docs.`;

  if (!project || !project.languages || project.languages.length === 0) {
    return `## Project Facts

*Frame couldn't detect this project's stack.* ${record}`;
  }

  const cmds = project.commands || {};
  const cmd = (c) => (c ? `\`${c}\`` : '*unknown — record it here*');
  const roots = (project.sourceRoots || [])
    .map(r => (r === '.' ? '*repo root*' : `\`${r}/\``))
    .join(', ') || '*repo root*';

  return `## Project Facts (detected — verify, then keep true)

- **Languages:** ${project.languages.join(', ')}
- **Package manager:** ${project.packageManager || '*none detected*'}
- **Source roots:** ${roots}
- **Layout:** ${project.layout || 'single'}
- **Install:** ${cmd(cmds.install)} · **Dev:** ${cmd(cmds.dev)} · **Build:** ${cmd(cmds.build)} · **Test:** ${cmd(cmds.test)}

${record}`;
}

/**
 * options:
 *   specDriven:    include the short Spec-Driven Development section.
 *   global:        render Frame's single user-scoped copy instead of a
 *                  per-project file — no Project Facts (there is no one
 *                  project to state facts about) and no creation stamp.
 *   referencePath: where the maintenance reference lives, since the global
 *                  copy sits beside this file rather than in `.frame/docs/`.
 */
function getAgentsTemplate(projectName, options) {
  const opts = options || {};
  const specDriven = opts.specDriven === true;
  const isGlobal = opts.global === true;
  const referencePath = opts.referencePath || '.frame/docs/REFERENCE.md';
  const date = getDateString();

  const heading = isGlobal
    ? `# Frame — Agent Instructions

These are **Frame's own** conventions, and they apply in every project Frame
opens. They live here, once, outside every repository: updating Frame updates
every project and writes to none of them. The repository you are working in
owns its code conventions; this file owns the Frame meta-workflow.
**Before writing any Frame meta file, read the matching section of
\`${referencePath}\`** — the maintenance rules live there, not here.`
    : `# ${projectName} - Frame Project

This project is managed with **Frame**: durable, structured context that keeps
AI agents oriented across sessions. This file is the always-on core.
**Before writing any Frame meta file, read the matching section of
\`${referencePath}\`** — the maintenance rules live there, not here.`;

  return `${heading}

---
${isGlobal ? '' : `
${formatProjectFacts(opts.project)}

---
`}
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

\`\`\`bash
node .frame/bin/find-module.js <keyword>   # concept/synonym → files
node .frame/bin/find-module.js --list      # all features
\`\`\`

**Spec history** — before working a topic or changing a file, check what
earlier specs did there and why (Claude Code sessions also get this injected
automatically via hooks; other CLIs: run it yourself):

\`\`\`bash
node .frame/bin/spec-context.js <keyword>       # topic → related specs
node .frame/bin/spec-context.js --file <path>   # file → who changed it, why
\`\`\`

On a hit, read the chain (\`spec.md → plan.md → tasks.md → outcome.md\`)
before working — respect recorded decisions or overturn them explicitly,
never silently.

**Freshness** — \`node .frame/bin/check-freshness.js\` reports when this
context is likely to mislead (phantom modules, stale STRUCTURE/notes, stuck
tasks). Trust its warnings over stale entries.

${specDriven ? `---

${renderSpecCoreSection()}

` : ''}---

## Writing Frame meta files — read the reference first

| Before writing…  | Read in \`${referencePath}\` |
| ---------------- | ------------------------------------ |
| tasks.json       | "Task Management" (schema + rules)   |
| PROJECT_NOTES.md | "PROJECT_NOTES.md Rules"             |
| STRUCTURE.json   | "STRUCTURE.json Rules"               |
| QUICKSTART.md    | "QUICKSTART.md Rules"                |

Quick reminders that always apply:
- Task work: \`status: "in_progress"\` when starting, \`"completed"\` +
  \`completedAt\` when done; re-check statuses after commits.
- Important decisions: append to PROJECT_NOTES.md as
  \`### [YYYY-MM-DD] Title\` with the conversation's context (not a summary).
- Documentation in English; dates in ISO 8601.
${isGlobal ? '' : `
---

*This file was automatically created by Frame.*
*Creation date: ${date}*
`}`;
}

/**
 * REFERENCE.md template — the reference-on-demand companion to the lean
 * AGENTS.md core. Holds the maintenance ceremony an agent only needs when
 * it is about to write a Frame meta file. Written to .frame/docs/ on init
 * and on the spec-driven upgrade path. Tool-agnostic.
 */
function getReferenceTemplate(projectName) {
  const date = getDateString();
  return `# ${projectName} — Frame Reference

Read the relevant section of this file **before writing a Frame meta file**
(tasks.json, PROJECT_NOTES.md, STRUCTURE.json, QUICKSTART.md). The always-on
orientation lives in \`AGENTS.md\`; this file is loaded on demand.

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

\`\`\`json
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
\`\`\`

### Task Status Updates

- When starting work on a task: \`status: "in_progress"\`
- When task is completed: \`status: "completed"\`, update \`completedAt\`
- After commit: Check and update the status of related tasks

---

${renderSpecSection()}

---

## PROJECT_NOTES.md Rules

### When to Update?
- When an important architectural decision is made
- When a technology choice is made
- When an important problem is solved and the solution method is noteworthy
- When an approach is determined together with the user

### Format
Free format. Date + title is sufficient:
\`\`\`markdown
### [2026-01-26] Topic title
Conversation/decision as is, with its context...
\`\`\`

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
2. **Add date** - In \`### [YYYY-MM-DD] Title\` format
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
\`\`\`json
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
\`\`\`

---

## QUICKSTART.md Rules

### When to Update?
- When installation steps change
- When new requirements are added
- When important commands change

---

## Where Frame's context reaches

Frame's context follows Frame's terminal. A session started **inside Frame** —
whether Frame composed the command or you typed \`claude\`, \`codex\` or
\`gemini\` yourself — is pointed at this project's Frame layers at launch,
because \`.frame/bin\` is first on that terminal's \`PATH\` and the wrapper
there hands the real CLI Frame's preamble. A session started in any other
terminal gets the tool's own defaults: Frame writes nothing to your shell
configuration and nothing outside \`.frame/\`.

If you are reading this in a session that knew nothing about Frame until now,
that is the boundary, not a bug — and \`FRAME_NO_WRAP=1 <tool>\` is how you
cross back the other way, running the CLI unwrapped inside Frame.

---

## General Rules

1. **Language:** Write documentation in English (except code examples)
2. **Date Format:** ISO 8601 (YYYY-MM-DDTHH:mm:ssZ)
3. **After Commit:** Check tasks.json and STRUCTURE.json
4. **Session Start:** Review pending tasks in tasks.json

---

*This file was automatically created by Frame.*
*Creation date: ${date}*
`;
}

/**
 * STRUCTURE.json template
 */
function getStructureTemplate(projectName, project) {
  const p = project || {};
  return {
    _frame_metadata: {
      purpose: "Project structure and module map for AI assistants",
      forAI: "Read this file FIRST when starting work on this project. It maps modules to files and intents. Update it when you add new modules or change the architecture.",
      lastUpdated: getDateString(),
      generatedBy: "Frame"
    },
    version: "1.0",
    description: `${projectName} - update this description`,
    architecture: {
      languages: p.languages || [],
      layout: p.layout || "",
      sourceRoots: p.sourceRoots || [],
      notes: ""
    },
    modules: {},
    intentIndex: {}
  };
}

/**
 * PROJECT_NOTES.md template
 */
function getNotesTemplate(projectName) {
  const date = getDateString();
  return `# ${projectName} - Project Notes

## Project Vision

*What is this project? Why does it exist? Who is it for?*

---

## Session Notes

### [${date}] Initial Setup
- Frame project initialized
`;
}

/**
 * tasks.json template
 */
function getTasksTemplate(projectName) {
  return {
    _frame_metadata: {
      purpose: "Task tracking for the project",
      forAI: "Check this file to understand what tasks are pending, in progress, or completed. Update task status as you work. Add new tasks when discovered during development. Follow the task recognition rules in AGENTS.md. IMPORTANT: Tasks live in a single flat 'tasks' array; the per-task 'status' field ('pending' | 'in_progress' | 'completed') is the single source of truth — to change a task's state, only update its status field (do not move or duplicate it). Include userRequest (original user prompt), detailed description, and acceptanceCriteria for each task.",
      lastUpdated: getDateString(),
      generatedBy: "Frame"
    },
    project: projectName,
    version: "1.2",
    lastUpdated: getISOTimestamp(),
    tasks: [],
    taskSchema: {
      _comment: "This schema shows the expected structure for each task",
      id: "unique-id (task-xxx format)",
      title: "Short actionable title (max 60 chars)",
      description: "Claude's detailed explanation - what, how, which files affected",
      userRequest: "Original user prompt/request - copy verbatim",
      acceptanceCriteria: "When is this task done? Concrete testable criteria",
      notes: "Discussion notes, alternatives considered, dependencies (optional)",
      status: "pending | in_progress | completed",
      priority: "high | medium | low",
      category: "feature | fix | refactor | docs | test",
      context: "Session date and context",
      createdAt: "ISO timestamp",
      updatedAt: "ISO timestamp",
      completedAt: "ISO timestamp | null"
    },
    metadata: {
      totalCreated: 0,
      totalCompleted: 0
    },
    categories: {
      feature: "New features",
      fix: "Bug fixes",
      refactor: "Code improvements",
      docs: "Documentation",
      test: "Testing",
      research: "Research and exploration"
    }
  };
}

/**
 * QUICKSTART.md template
 */
function getQuickstartTemplate(projectName, project) {
  const date = getDateString();
  const p = project || {};
  const cmds = p.commands || {};
  // An unknown command renders as an explicit TODO — never a wrong guess.
  const todo = "# TODO: confirm — Frame couldn't detect this";
  const stackLine = p.languages && p.languages.length > 0
    ? `**Stack (detected — verify):** ${p.languages.join(', ')}${p.packageManager ? ` · ${p.packageManager}` : ''}\n\n`
    : '';
  const roots = (p.sourceRoots && p.sourceRoots.length > 0 ? p.sourceRoots : ['src'])
    .filter(r => r !== '.');
  const tree = [
    `${projectName}/`,
    '├── .frame/           # Frame configuration',
    ...roots.map(r => `├── ${r}/`),
    '└── ...'
  ].join('\n');

  return `<!-- FRAME AUTO-GENERATED FILE -->
<!-- Purpose: Quick onboarding guide for developers and AI assistants -->
<!-- For AI assistants: Read this FIRST to quickly understand how to work with this project. Contains setup instructions, common commands, and key files to know. -->
<!-- Last Updated: ${date} -->

# ${projectName} - Quick Start Guide

${stackLine}## Setup

\`\`\`bash
# Clone and enter
git clone <repo-url>
cd ${projectName}

# Install dependencies
${cmds.install || todo}
\`\`\`

## Common Commands

\`\`\`bash
# Development
${cmds.dev || todo}

# Build
${cmds.build || todo}

# Test
${cmds.test || todo}
\`\`\`

## Key Files

| File | Purpose |
|------|---------|
| \`STRUCTURE.json\` | Module map and architecture |
| \`PROJECT_NOTES.md\` | Decisions and context |
| \`tasks.json\` | Task tracking |
| \`QUICKSTART.md\` | This file |

## Project Structure

\`\`\`
${tree}
\`\`\`

## For AI Assistants

1. **First**: Read \`STRUCTURE.json\` for architecture overview
2. **Then**: Check \`PROJECT_NOTES.md\` for current context and decisions
3. **Check**: \`tasks.json\` for pending tasks
4. **Follow**: Existing code patterns and conventions
5. **Update**: These files as you make changes

## Quick Context

*Add a brief summary of what this project does and its current state here*
`;
}

/**
 * .frame/config.json template
 */
function getFrameConfigTemplate(projectName, options = {}) {
  return {
    version: "1.0",
    name: projectName,
    description: "",
    createdAt: getISOTimestamp(),
    initializedBy: "Frame",
    settings: {
      // The only per-project setting besides features: whether .frame/ is
      // machine-local (hidden via .git/info/exclude) or shared in the
      // repository. Chosen at init, changeable in Project Settings.
      gitSharing: options.gitSharing === 'repo' ? 'repo' : 'local'
    },
    features: {
      // Spec-Driven Development defaults ON for new projects: the spec
      // commands ship at init, so an AI session can write specs from day
      // one — the flag being off only hid them from the Specs panel. The
      // init modal and Project Settings can turn it off.
      specDriven: options.specDriven !== false
    }
    // No `files` block. It was a manifest of the root files init created, and
    // since the overlay (1202ab2) init creates none — so writing it would
    // claim authorship of files Frame never touched. `embeddedMigration`
    // treats that block as proof of a pre-overlay init and moves what it
    // names, which on a fresh project would be the user's own files.
  };
}

/**
 * Wrapper script that hands a tool Frame's launch context.
 *
 * The old wrappers hunted for a root `AGENTS.md` and told the tool to read it.
 * The overlay plants no such file, so the wrapper passes Frame's launch
 * preamble instead — as a flag when the CLI has one, positionally when it does
 * not.
 *
 * Since `terminal-context-boundary` this is the **only** injection path:
 * `.frame/bin` goes first on the `PATH` of every terminal Frame spawns, so a
 * hand-typed `claude` and a Frame-composed dispatch resolve to the same
 * script. Two consequences shape the template:
 *
 *   1. **It must not exec itself.** With its own directory first on `PATH`,
 *      `exec claude` from a wrapper named `claude` is an infinite loop. The
 *      real binary is resolved at run time with the wrapper's own directory
 *      removed from the search path — at run time, not baked in at write
 *      time, so a version-manager switch or a reinstall is picked up instead
 *      of going stale until the next project open.
 *   2. **It emits the tool's own flags**, from the injection record, so
 *      Claude's `--append-system-prompt` / `--settings` are produced here
 *      rather than composed a second time by `aiToolManager`.
 *
 * The preamble is read from a file rather than baked into the script: it is
 * multi-line prose containing quotes and backticks, and every one of those is
 * a way to break a generated shell script. A missing preamble degrades to
 * `exec <real> "$@"`, so a half-written `.frame/` costs the user their context
 * but never their terminal. The user's own arguments always ride through as
 * `"$@"`.
 *
 * @param {string} toolCommand - the real CLI to resolve and exec
 * @param {object} [options]
 * @param {string} [options.promptFlag] - flag carrying the prompt, '' for positional
 * @param {string} [options.settingsFlag] - flag carrying the settings file, '' for none
 * @param {string} [options.preambleFile] - project-relative preamble path
 * @param {string} [options.settingsFile] - project-relative settings path
 */
function getWrapperTemplate(toolCommand, options) {
  const opts = options || {};
  const promptFlag = opts.promptFlag || '';
  const settingsFlag = opts.settingsFlag || '';
  const preambleFile = opts.preambleFile || '.frame/runtime/preamble.txt';
  const settingsFile = opts.settingsFile || '.frame/runtime/claude-settings.json';

  // A tool with no prompt flag takes the preamble positionally; one with a
  // flag gets `<flag> <preamble>`. Either way it is one array element per
  // argument, so nothing depends on word splitting.
  const promptArgs = promptFlag
    ? `("${promptFlag}" "$(cat "$PREAMBLE_FILE")")`
    : `("$(cat "$PREAMBLE_FILE")")`;

  const settingsBlock = settingsFlag
    ? `
# ${settingsFlag} rides along only when the file is actually there — the
# settings payload is optional, the preamble is not.
if [ -n "$PROJECT_ROOT" ] && [ -f "$SETTINGS_FILE" ]; then
  frame_args+=("${settingsFlag}" "$SETTINGS_FILE")
fi
`
    : '';

  return `#!/usr/bin/env bash
# Frame AI Tool Wrapper for ${toolCommand}
# Hands ${toolCommand} Frame's launch context. Generated file — Frame rewrites
# it whenever the content changes; edits will be lost.

# This wrapper's own directory is first on PATH, so resolving the real CLI by
# name would find this script again. Drop that directory, then look.
self_dir() {
  cd "$(dirname "\${BASH_SOURCE[0]}")" 2>/dev/null && pwd
}

SELF_DIR="$(self_dir)"

path_without_self() {
  local out="" entry
  local IFS=:
  for entry in $PATH; do
    [ -z "$entry" ] && continue
    [ "$entry" = "$SELF_DIR" ] && continue
    out="\${out:+$out:}$entry"
  done
  printf '%s' "$out"
}

REAL_CLI="$(PATH="$(path_without_self)" command -v ${toolCommand} 2>/dev/null)"

if [ -z "$REAL_CLI" ]; then
  echo "Frame: ${toolCommand} was not found on PATH." >&2
  exit 127
fi

# The escape hatch. \`command ${toolCommand}\` is not one — it bypasses shell
# functions and aliases, not a PATH lookup, so it finds this script too.
if [ -n "$FRAME_NO_WRAP" ]; then
  exec "$REAL_CLI" "$@"
fi

# Locate the project root by walking up to the directory holding .frame/
find_project_root() {
  local dir="$PWD"
  while [ "$dir" != "/" ]; do
    if [ -d "$dir/.frame" ]; then
      echo "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  return 1
}

PROJECT_ROOT=$(find_project_root)
PREAMBLE_FILE="$PROJECT_ROOT/${preambleFile}"
SETTINGS_FILE="$PROJECT_ROOT/${settingsFile}"

if [ -n "$PROJECT_ROOT" ] && [ -f "$PREAMBLE_FILE" ]; then
  frame_args=${promptArgs}
${settingsBlock}  exec "$REAL_CLI" "\${frame_args[@]}" "$@"
else
  exec "$REAL_CLI" "$@"
fi
`;
}

/**
 * The Windows wrapper: `.frame\bin\<id>.cmd`.
 *
 * Same job as `getWrapperTemplate` — catch a hand-typed `claude` and hand it
 * Frame's launch context — but it exists on different terms:
 *
 *   * **`.cmd`, not `.ps1`.** Only `.cmd` is in the default `PATHEXT`, and
 *     `PATHEXT` is what makes a bare `claude` resolve to a file that is not an
 *     executable. `cmd`, `powershell` and `pwsh` consult it; Git Bash does
 *     not — it looks for an exact filename, so that lane gets its context from
 *     the launch Frame composes and nothing from here.
 *   * **It passes a path, never the prose.** Which is the only reason this can
 *     stay plain batch. A wrapper that had to embed a 9-line preamble carrying
 *     backticks would need a Node trampoline between the shell and an
 *     interactive CLI; one that passes two paths needs nothing.
 *
 * Returns `''` for a tool with no `promptFileFlag`. There is no batch spelling
 * of the string form, and a wrapper that cannot do its job would still shadow
 * a working CLI — worse than no wrapper at all.
 *
 * Three details are load-bearing and easy to lose in a later edit:
 *
 *   1. **It must not find itself.** `.frame\bin` leads `PATH`, so `where`
 *      reports this file before the real CLI. The loop takes the first hit
 *      whose directory is not `%~dp0`, resolved at run time so a
 *      version-manager switch is picked up without a rewrite.
 *   2. **It defers when Frame's flag is already on the line.** A launch Frame
 *      composed resolves through here too, so finding `promptFileFlag` in `%*`
 *      means someone already owns the injection. One route, never two.
 *   3. **Every branch jumps to one `call` and a bare `exit /b`.** `cmd.exe`
 *      expands variables when it *parses* a parenthesised block, so an
 *      `exit /b %ERRORLEVEL%` inside an `if (…)` would report the code from
 *      before the `call`. Jumping to a single tail leaves the child's exit
 *      code untouched — and `%ERRORLEVEL%` never appears in this file.
 *
 * @param {string} toolCommand - the real CLI to resolve and run
 * @param {object} [options]
 * @param {string} [options.promptFileFlag] - flag taking the preamble's path; '' means no wrapper
 * @param {string} [options.settingsFlag] - flag taking the settings file, '' for none
 * @param {string} [options.preambleFile] - project-relative preamble path
 * @param {string} [options.settingsFile] - project-relative settings path
 * @returns {string} the file's content, or '' for a tool that cannot be wrapped here
 */
function getCmdWrapperTemplate(toolCommand, options) {
  const opts = options || {};
  const promptFileFlag = opts.promptFileFlag || '';
  if (!promptFileFlag) return '';

  const settingsFlag = opts.settingsFlag || '';
  const preambleFile = toBackslashes(opts.preambleFile || '.frame/runtime/preamble.txt');
  const settingsFile = toBackslashes(opts.settingsFile || '.frame/runtime/claude-settings.json');

  // The settings file is optional in a way the preamble is not: without it a
  // session loses its hooks, without the preamble there is nothing to inject.
  const settingsBlock = settingsFlag
    ? `
set "FRAME_SETTINGS=%FRAME_ROOT%\\${settingsFile}"
if not exist "%FRAME_SETTINGS%" goto :frame_run
set FRAME_FLAGS=%FRAME_FLAGS% ${settingsFlag} "%FRAME_SETTINGS%"
`
    : '';

  return `@echo off
setlocal EnableExtensions
rem Frame AI Tool Wrapper for ${toolCommand} (Windows).
rem Hands ${toolCommand} Frame's launch context. Generated file — Frame rewrites
rem it whenever the content changes; edits will be lost.

set "FRAME_SELF=%~dp0"
set "FRAME_REAL="

rem This file's own directory leads PATH, so \`where\` reports it before the real
rem CLI. Take the first hit that does not live here.
for /f "delims=" %%I in ('where "${toolCommand}" 2^>nul') do (
  if not defined FRAME_REAL if /i not "%%~dpI"=="%FRAME_SELF%" set "FRAME_REAL=%%I"
)

if defined FRAME_REAL goto :frame_resolved
>&2 echo Frame: ${toolCommand} was not found on PATH.
exit /b 127

:frame_resolved
set "FRAME_FLAGS="

rem The escape hatch, honoured here exactly as in the POSIX wrapper.
if defined FRAME_NO_WRAP goto :frame_run

rem One injection route, not two: a launch Frame composed resolves through this
rem file as well, so its flags are already on the line. Whoever composed first
rem owns the injection.
set "FRAME_COMPOSED="
call :frame_scan_args %*
if defined FRAME_COMPOSED goto :frame_run

set "FRAME_ROOT="
call :frame_find_root "%CD%"
if not defined FRAME_ROOT goto :frame_run

set "FRAME_PREAMBLE=%FRAME_ROOT%\\${preambleFile}"
if not exist "%FRAME_PREAMBLE%" goto :frame_run
set FRAME_FLAGS=${promptFileFlag} "%FRAME_PREAMBLE%"
${settingsBlock}
:frame_run
call "%FRAME_REAL%" %FRAME_FLAGS% %*
exit /b

:frame_scan_args
rem Is Frame's own flag already on the line? Compared one argument at a time
rem with %~1 rather than by searching the whole of %*: %~1 strips the quotes
rem cmd put there, so a user argument containing a space, an ampersand or a
rem pipe is compared as a value instead of being re-parsed as syntax.
if "%~1"=="" goto :eof
if /i "%~1"=="${promptFileFlag}" set "FRAME_COMPOSED=1"
shift
goto :frame_scan_args

:frame_find_root
rem Walk up from %1 to the directory holding .frame\\, the same walk the POSIX
rem wrapper does. Leaves FRAME_ROOT empty outside a Frame project. Every path
rem stays quoted, because a project under Documents has a space in it as often
rem as not.
set "FRAME_TRY=%~1"

:frame_find_root_step
if exist "%FRAME_TRY%\\.frame\\" goto :frame_find_root_hit
for %%P in ("%FRAME_TRY%\\..") do set "FRAME_UP=%%~fP"
if /i "%FRAME_UP%"=="%FRAME_TRY%" goto :eof
set "FRAME_TRY=%FRAME_UP%"
goto :frame_find_root_step

:frame_find_root_hit
set "FRAME_ROOT=%FRAME_TRY%"
goto :eof
`;
}

// A project-relative path as batch spells it. The rest of Frame carries these
// with forward slashes — Windows file APIs accept them in arguments — but a
// generated batch file reads better, and `if exist` behaves more predictably,
// with the native separator.
function toBackslashes(value) {
  return String(value == null ? '' : value).replace(/\//g, '\\');
}

/**
 * A shell function name Frame is willing to define.
 *
 * Tool ids come from a registry the user can add to, and a custom id is free
 * text. Anything that would not parse as a function name is skipped rather
 * than escaped: a broken definition would take the whole init file down with
 * it, and losing one tool's function is cheaper than losing every tool's.
 */
function isDefinableToolId(id) {
  return typeof id === 'string' && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(id);
}

// Single-quote for a generated shell file. Both POSIX shells and fish treat
// `'` as fully literal with no escape inside it, so a quote in the path is
// closed, escaped and reopened.
function shellQuote(value) {
  return `'${String(value == null ? '' : value).replace(/'/g, "'\\''")}'`;
}

// The same job for PowerShell, whose single-quoted string is literal too — no
// backtick escapes inside it, which is exactly why it is used here — and
// escapes a quote by doubling it.
function psQuote(value) {
  return `'${String(value == null ? '' : value).replace(/'/g, "''")}'`;
}

/**
 * The init file a lane sources at startup.
 *
 * `.frame/bin` first on `PATH` was never enough on its own: rc files run
 * *after* Frame sets the environment, and nvm, Homebrew and pyenv all prepend
 * their own directory — so a `codex` installed by `npm i -g` won not because
 * anything was wrong, but because it got to reorder the list last. This file
 * runs last instead, and does two things:
 *
 * 1. Moves `.frame/bin` back to the front of an **exported** `PATH`, so
 *    subshells — where functions do not reach — keep the base guarantee.
 * 2. Defines one function per configured tool. A function is resolved before
 *    any `PATH` search, which removes the ordering question entirely.
 *
 * Each function is a **router**, not a second injection point: it delegates to
 * `"$FRAME_BIN/<id>"`, which stays the only thing that composes the preamble
 * and the only thing that honours `FRAME_NO_WRAP=1` — so the escape hatch
 * behaves identically whether the tool was reached through the function or
 * through `PATH`. When the wrapper file is missing the function falls back to
 * `command <id>`, which bypasses shell functions (so it cannot recurse into
 * itself) while still going through `PATH`.
 *
 * @param {object} options
 * @param {string} options.family - 'posix' (zsh/bash/sh), 'fish' or 'powershell'
 * @param {string} options.binDir - absolute path to the project's .frame/bin
 * @param {string[]} options.toolIds - configured tool ids, one function each
 * @returns {string} the file's content, or '' for a family Frame cannot serve
 */
function getShellInitTemplate(options) {
  const opts = options || {};
  const family = opts.family || '';
  const binDir = opts.binDir || '';
  const toolIds = (Array.isArray(opts.toolIds) ? opts.toolIds : []).filter(isDefinableToolId);

  if (!binDir) return '';
  if (family === 'fish') return fishInitTemplate(binDir, toolIds);
  if (family === 'posix') return posixInitTemplate(binDir, toolIds);
  if (family === 'powershell') return powershellInitTemplate(binDir, toolIds);
  return '';
}

function posixInitTemplate(binDir, toolIds) {
  const functions = toolIds
    .map(
      (id) => `${id}() {
  if [ -x "$FRAME_BIN/${id}" ]; then
    "$FRAME_BIN/${id}" "$@"
  else
    command ${id} "$@"
  fi
}`
    )
    .join('\n\n');

  return `# Frame shell setup — sourced by zsh, bash and sh in terminals Frame opens.
# Generated file; Frame rewrites it whenever the content changes. Nothing
# outside .frame/ is touched, and nothing here runs in a shell Frame did not
# open.

FRAME_BIN=${shellQuote(binDir)}
export FRAME_BIN

# Move FRAME_BIN to the front of PATH — the reason this file exists. Written
# with prefix/suffix removal instead of splitting on ":", because zsh does not
# word-split unquoted parameters and this same file is sourced by zsh and bash.
__frame_path_front() {
  __frame_rest="$PATH"
  __frame_out=""
  while [ -n "$__frame_rest" ]; do
    case "$__frame_rest" in
      *:*) __frame_item="\${__frame_rest%%:*}"; __frame_rest="\${__frame_rest#*:}" ;;
      *) __frame_item="$__frame_rest"; __frame_rest="" ;;
    esac
    [ -z "$__frame_item" ] && continue
    [ "$__frame_item" = "$FRAME_BIN" ] && continue
    __frame_out="\${__frame_out:+$__frame_out:}$__frame_item"
  done
  PATH="$FRAME_BIN\${__frame_out:+:$__frame_out}"
  export PATH
  unset __frame_rest __frame_out __frame_item
}
__frame_path_front
unset -f __frame_path_front 2>/dev/null

# One function per configured tool. Resolved before any PATH search, so where
# the user's rc files put their own directories stops mattering.
${functions}
`;
}

/**
 * The PowerShell init file, dot-sourced at spawn by `powershell` and `pwsh`.
 *
 * Same argument as the POSIX one, with a Windows name attached: nvm-windows
 * prepends its own directory when the user's profile runs, which is *after*
 * Frame set the environment, so `.frame\bin` leading `PATH` is a guarantee the
 * profile can quietly undo. A function is resolved before any `PATH` search,
 * so it cannot be.
 *
 * The fallback resolves with `-CommandType Application`, which excludes
 * functions and aliases. That is what keeps a function named `claude` from
 * finding itself and recursing until the stack gives out — the PowerShell
 * spelling of the POSIX file's `command <id>`.
 */
function powershellInitTemplate(binDir, toolIds) {
  const functions = toolIds
    .map(
      (id) => `function ${id} {
    $frameWrapper = Join-Path $env:FRAME_BIN '${id}.cmd'
    if (Test-Path -LiteralPath $frameWrapper) {
        & $frameWrapper @args
    } else {
        $frameReal = Get-Command '${id}' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($frameReal) {
            & $frameReal.Source @args
        } else {
            Write-Error 'Frame: ${id} was not found on PATH.'
        }
    }
}`
    )
    .join('\n\n');

  return `# Frame shell setup — dot-sourced by PowerShell in terminals Frame opens.
# Generated file; Frame rewrites it whenever the content changes. Nothing
# outside .frame\\ is touched, and nothing here runs in a shell Frame did not
# open.

$env:FRAME_BIN = ${psQuote(binDir)}

# Move FRAME_BIN to the front of PATH — the reason this file exists. The
# profile that just ran may have prepended a version manager's directory, and
# a real claude.cmd found there would win.
$frameRest = @($env:PATH -split ';' | Where-Object { $_ -and $_ -ne $env:FRAME_BIN })
$env:PATH = (@($env:FRAME_BIN) + $frameRest) -join ';'
Remove-Variable frameRest -ErrorAction SilentlyContinue

# One function per tool that has a wrapper here. Resolved before any PATH
# search, so where the user's profile put its own directories stops mattering.
# Each is a router, not a second injection point: the .cmd remains the only
# thing that composes the flags and the only thing honouring FRAME_NO_WRAP.
${functions}
`;
}

function fishInitTemplate(binDir, toolIds) {
  const functions = toolIds
    .map(
      (id) => `function ${id} --wraps ${id}
    if test -x "$FRAME_BIN/${id}"
        "$FRAME_BIN/${id}" $argv
    else
        command ${id} $argv
    end
end`
    )
    .join('\n\n');

  return `# Frame shell setup — sourced by fish in terminals Frame opens.
# Generated file; Frame rewrites it whenever the content changes.

set -gx FRAME_BIN ${shellQuote(binDir)}

# Move FRAME_BIN to the front of PATH. fish's PATH is a list, so this is a
# rebuild rather than string surgery — but the intent is the one the POSIX
# file has: exported, and first.
set -l __frame_rest
for __frame_entry in $PATH
    if test "$__frame_entry" != "$FRAME_BIN"
        set -a __frame_rest $__frame_entry
    end
end
set -gx PATH $FRAME_BIN $__frame_rest

# One function per configured tool, each delegating to the wrapper.
${functions}
`;
}

/**
 * The spec-hint hooks, as a Claude Code settings object.
 *
 * These used to be merged into the project's tracked `.claude/settings.json`.
 * They are now written inside Frame's own footprint and passed at launch with
 * `--settings`, because the overlay may not write a tracked file — and a hook
 * list that arrives by flag is also removed by simply not passing it.
 */
function getSpecHintSettings() {
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Edit|Write',
          hooks: [{ type: 'command', command: 'node .frame/bin/spec-hint.js pre-edit' }]
        }
      ],
      UserPromptSubmit: [
        { hooks: [{ type: 'command', command: 'node .frame/bin/spec-hint.js prompt' }] }
      ]
    }
  };
}

/**
 * Pre-commit hook snippet that keeps STRUCTURE.json in sync with staged JS
 * changes. Designed to be safe in any environment:
 *   - Silently no-op if node is missing (never blocks a commit)
 *   - Silently no-op if .frame/bin/update-structure.js is missing
 *   - Parser errors don't fail the commit (|| true)
 *   - FRAME_PROJECT_ROOT tells the bundled parser where the project root is
 *
 * The MARKER lines wrap the block so we can detect/append/remove idempotently
 * when installing into husky/lefthook/existing hooks.
 */
const FRAME_HOOK_MARKER_START = '# >>> frame:structure (managed) >>>';
const FRAME_HOOK_MARKER_END = '# <<< frame:structure (managed) <<<';

function getStructureHookSnippet() {
  return `${FRAME_HOOK_MARKER_START}
# Keep STRUCTURE.json in sync with staged JS changes. Safe to remove if you
# don't want Frame to manage your STRUCTURE.json file.
if command -v node >/dev/null 2>&1; then
  FRAME_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
  if [ -n "$FRAME_ROOT" ] && [ -f "$FRAME_ROOT/.frame/bin/update-structure.js" ]; then
    FRAME_PROJECT_ROOT="$FRAME_ROOT" node "$FRAME_ROOT/.frame/bin/update-structure.js" --changed || true
    # .frame/ is where the map lives; the root path is only staged for a
    # project still on the pre-overlay layout. Staged only when tracked —
    # adding an excluded file would drag .frame/ into the commit.
    if [ -f "$FRAME_ROOT/.frame/STRUCTURE.json" ]; then
      git ls-files --error-unmatch "$FRAME_ROOT/.frame/STRUCTURE.json" >/dev/null 2>&1 \\
        && git add "$FRAME_ROOT/.frame/STRUCTURE.json" || true
    elif [ -f "$FRAME_ROOT/STRUCTURE.json" ]; then
      git add "$FRAME_ROOT/STRUCTURE.json" || true
    fi
  fi
fi
${FRAME_HOOK_MARKER_END}
`;
}

/**
 * Swap the managed block inside an existing hook file for the current snippet.
 *
 * `.git/hooks/` is not versioned and Frame writes it once, at init, so a
 * project runs whatever generation initialized it forever. That was harmless
 * while the snippet and the layout agreed — it stops being harmless once
 * migration moves the meta files, because a pre-overlay block stages a root
 * `STRUCTURE.json` that should no longer exist.
 *
 * Strict on purpose: each marker must appear exactly once and in order, or
 * this returns null and the caller leaves the file alone. Everything outside
 * the markers is preserved byte for byte — a partial or hand-edited match is
 * not evidence enough to rewrite an executable file that runs on every commit.
 *
 * @param {string} content current hook file content
 * @returns {string|null} updated content, or null when it must not be touched
 */
function replaceManagedHookBlock(content) {
  if (typeof content !== 'string') return null;

  const starts = content.split(FRAME_HOOK_MARKER_START).length - 1;
  const ends = content.split(FRAME_HOOK_MARKER_END).length - 1;
  if (starts !== 1 || ends !== 1) return null;

  const from = content.indexOf(FRAME_HOOK_MARKER_START);
  const to = content.indexOf(FRAME_HOOK_MARKER_END);
  if (from > to) return null;

  // The snippet carries its own markers and a trailing newline; drop the
  // newline so the surrounding file keeps exactly the spacing it had.
  const block = getStructureHookSnippet().replace(/\n+$/, '');
  const updated = content.slice(0, from) + block + content.slice(to + FRAME_HOOK_MARKER_END.length);
  return updated === content ? null : updated;
}

/**
 * Full pre-commit hook file content for the "no existing hook" case.
 * Husky/lefthook get the snippet appended into their own files instead.
 */
function getStructurePreCommitHookTemplate() {
  return `#!/bin/sh
# Frame pre-commit hook
# Auto-installed by Frame on project initialization. You can edit or delete
# this file freely — Frame will not overwrite it on subsequent inits.

${getStructureHookSnippet()}
exit 0
`;
}

/**
 * Orchestration command-channel scripts (.frame/bin/)
 *
 * The conductor (and workers) call these to talk to Frame's
 * orchestrationManager, which watches $FRAME_ORCH_BUS. Requests are written as
 * atomic JSON files (tmp + rename, unique name); the manager consumes + deletes
 * them and publishes board state to $FRAME_ORCH_BUS/state.json for status.js.
 *
 * These are standalone Node scripts (core modules only) so they run from any
 * worktree without a Frame runtime — same self-contained spirit as the AI-tool
 * wrappers above.
 */
function getOrchBusHeader() {
  return `#!/usr/bin/env node
// Frame orchestration command — auto-generated. Talks to Frame via $FRAME_ORCH_BUS.
const fs = require('fs');
const path = require('path');
const BUS = process.env.FRAME_ORCH_BUS;
if (!BUS) {
  console.error('FRAME_ORCH_BUS not set — run this from inside a Frame orchestration session.');
  process.exit(2);
}`;
}

function getOrchRequestScript(type) {
  return `${getOrchBusHeader()}

const type = ${JSON.stringify(type)};
const slug = process.argv[2] || process.env.FRAME_ORCH_SLUG || '';
if (!slug) {
  console.error('usage: ' + path.basename(process.argv[1]) + ' <spec-slug>');
  process.exit(2);
}
const req = { type, slug, args: process.argv.slice(3), ts: new Date().toISOString(), pid: process.pid };
try { fs.mkdirSync(BUS, { recursive: true }); } catch (e) {}
const name = Date.now() + '-' + type + '-' + Math.random().toString(36).slice(2, 8) + '.json';
const dest = path.join(BUS, name);
const tmp = dest + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(req));
fs.renameSync(tmp, dest); // atomic publish — the watcher only ever sees complete files
console.log('[frame] ' + type + ' request queued for "' + slug + '"');
`;
}

function getOrchStatusScript() {
  return `${getOrchBusHeader()}

const statePath = path.join(BUS, 'state.json');
try {
  const raw = fs.readFileSync(statePath, 'utf8');
  process.stdout.write(raw.endsWith('\\n') ? raw : raw + '\\n');
} catch (e) {
  console.log('{}'); // no session state yet
}
`;
}

/**
 * Map of filename → script body for the orchestration bin scripts. The
 * orchestrationManager materializes these under .frame/bin/ for the active
 * project when an orchestration session starts.
 */
function getOrchBinScripts() {
  return {
    'dispatch.js': getOrchRequestScript('dispatch'),
    'report-done.js': getOrchRequestScript('report-done'),
    'merge.js': getOrchRequestScript('merge'),
    'status.js': getOrchStatusScript()
  };
}

module.exports = {
  getAgentsTemplate,
  getReferenceTemplate,
  getStructureTemplate,
  getNotesTemplate,
  getTasksTemplate,
  getQuickstartTemplate,
  getFrameConfigTemplate,
  SPEC_DRIVEN_SECTION,
  SPEC_DRIVEN_CORE_SECTION,
  renderSpecSection,
  renderSpecCoreSection,
  SPEC_SECTION_VERSION,
  LEGACY_SPEC_DRIVEN_SECTION,
  LEGACY_SPEC_DRIVEN_SECTION_V0,
  LEGACY_SPEC_DRIVEN_CORE_SECTION,
  REFERENCE_SPEC_LEGACY_MATCHERS,
  AGENTS_SPEC_LEGACY_MATCHERS,
  getWrapperTemplate,
  getCmdWrapperTemplate,
  getShellInitTemplate,
  getSpecHintSettings,
  getStructureHookSnippet,
  getStructurePreCommitHookTemplate,
  replaceManagedHookBlock,
  getOrchBinScripts,
  FRAME_HOOK_MARKER_START,
  FRAME_HOOK_MARKER_END
};
