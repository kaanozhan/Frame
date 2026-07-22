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
 * Legacy matchers per doc: REFERENCE.md carried the full section, AGENTS.md
 * the short core pointer. docsManagedBlock.upgradeDoc migrates a section to
 * a managed block only when it matches one of these.
 */
const REFERENCE_SPEC_LEGACY_MATCHERS = [LEGACY_SPEC_DRIVEN_SECTION];
const AGENTS_SPEC_LEGACY_MATCHERS = [LEGACY_SPEC_DRIVEN_CORE_SECTION];

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
 *   specDriven: include the short Spec-Driven Development section. Off by
 *               default — the user opts in via the suggestion modal or
 *               Settings, after which we re-emit AGENTS.md (or append the
 *               section to it).
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

function getAgentsTemplate(projectName, options) {
  const opts = options || {};
  const specDriven = opts.specDriven === true;
  const date = getDateString();
  return `# ${projectName} - Frame Project

This project is managed with **Frame**: durable, structured context that keeps
AI agents oriented across sessions. This file is the always-on core.
**Before writing any Frame meta file, read the matching section of
\`.frame/docs/REFERENCE.md\`** — the maintenance rules live there, not here.

---

${formatProjectFacts(opts.project)}

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

\`\`\`bash
node .frame/bin/find-module.js <keyword>   # concept/synonym → files
node .frame/bin/find-module.js --list      # all features
\`\`\`

**Freshness** — \`node .frame/bin/check-freshness.js\` reports when this
context is likely to mislead (phantom modules, stale STRUCTURE/notes, stuck
tasks). Trust its warnings over stale entries.

${specDriven ? `---

${renderSpecCoreSection()}

` : ''}---

## Writing Frame meta files — read the reference first

| Before writing…  | Read in \`.frame/docs/REFERENCE.md\` |
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

---

*This file was automatically created by Frame.*
*Creation date: ${date}*

---

**Note:** This file is named \`AGENTS.md\` to be AI-tool agnostic. A \`CLAUDE.md\` symlink is provided for Claude Code compatibility.
`;
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
function getFrameConfigTemplate(projectName) {
  return {
    version: "1.0",
    name: projectName,
    description: "",
    createdAt: getISOTimestamp(),
    initializedBy: "Frame",
    settings: {
      autoUpdateStructure: true,
      autoUpdateNotes: false,
      taskRecognition: true
    },
    features: {
      // Spec-Driven Development is opt-in. The user enables it via the
      // suggestion modal that appears the first time they click the Specs
      // panel; toggling this flag also re-emits AGENTS.md with the spec
      // section so AI tools learn the workflow.
      specDriven: false
    },
    files: {
      agents: "AGENTS.md",
      claudeSymlink: "CLAUDE.md",
      structure: "STRUCTURE.json",
      notes: "PROJECT_NOTES.md",
      tasks: "tasks.json",
      quickstart: "QUICKSTART.md"
    }
  };
}

/**
 * AI Tool Wrapper Script Templates
 * These wrappers inject AGENTS.md as system prompt for non-Claude tools
 */

/**
 * Codex CLI wrapper script
 * Instructs Codex to read AGENTS.md as initial prompt
 */
function getCodexWrapperTemplate() {
  return `#!/usr/bin/env bash
# Frame AI Tool Wrapper for Codex CLI
# This script injects AGENTS.md as initial prompt

AGENTS_FILE="AGENTS.md"

# Find AGENTS.md in current directory or parent directories
find_agents_file() {
  local dir="$PWD"
  while [ "$dir" != "/" ]; do
    if [ -f "$dir/$AGENTS_FILE" ]; then
      echo "$dir/$AGENTS_FILE"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  return 1
}

AGENTS_PATH=$(find_agents_file)

# Run codex with initial prompt to read AGENTS.md
if [ -n "$AGENTS_PATH" ]; then
  exec codex "Please read AGENTS.md and follow the project instructions. This file contains important rules for this project." "$@"
else
  exec codex "$@"
fi
`;
}

/**
 * Generic AI tool wrapper template
 * Can be customized for other AI tools in the future
 * @param {string} toolCommand - The CLI command to run
 * @param {string} promptFlag - Flag to pass initial prompt (e.g., '--prompt' or empty for positional)
 */
function getGenericWrapperTemplate(toolCommand, promptFlag = '') {
  const flagPart = promptFlag ? `${promptFlag} ` : '';
  return `#!/usr/bin/env bash
# Frame AI Tool Wrapper for ${toolCommand}
# This script injects AGENTS.md as initial prompt

AGENTS_FILE="AGENTS.md"

# Find AGENTS.md in current directory or parent directories
find_agents_file() {
  local dir="$PWD"
  while [ "$dir" != "/" ]; do
    if [ -f "$dir/$AGENTS_FILE" ]; then
      echo "$dir/$AGENTS_FILE"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  return 1
}

AGENTS_PATH=$(find_agents_file)

# Run tool with initial prompt to read AGENTS.md
if [ -n "$AGENTS_PATH" ]; then
  exec ${toolCommand} ${flagPart}"Please read AGENTS.md and follow the project instructions." "$@"
else
  exec ${toolCommand} "$@"
fi
`;
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
    if [ -f "$FRAME_ROOT/STRUCTURE.json" ]; then
      git add "$FRAME_ROOT/STRUCTURE.json" || true
    fi
  fi
fi
${FRAME_HOOK_MARKER_END}
`;
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
  LEGACY_SPEC_DRIVEN_CORE_SECTION,
  REFERENCE_SPEC_LEGACY_MATCHERS,
  AGENTS_SPEC_LEGACY_MATCHERS,
  getCodexWrapperTemplate,
  getGenericWrapperTemplate,
  getStructureHookSnippet,
  getStructurePreCommitHookTemplate,
  getOrchBinScripts,
  FRAME_HOOK_MARKER_START,
  FRAME_HOOK_MARKER_END
};
