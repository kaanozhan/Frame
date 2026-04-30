/**
 * Frame Templates
 * Templates for auto-generated Frame project files
 * Each template includes instructions header for Claude Code
 */

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
 * Spec-Driven Development section — markdown content shipped to AGENTS.md
 * when the user enables the feature. Held as a constant so both the full
 * AGENTS.md template and the standalone "append-only" helper share one
 * source of truth.
 */
const SPEC_DRIVEN_SECTION = `## Spec-Driven Development (.frame/specs/)

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
 * AGENTS.md template - Main instructions file for AI assistants
 * This file is read by AI coding tools (Claude Code, Codex CLI, etc.)
 *
 * options:
 *   specDriven: include the Spec-Driven Development section. Off by default —
 *               the user opts in via the suggestion modal or Settings, after
 *               which we re-emit AGENTS.md (or append the section to it).
 */
function getAgentsTemplate(projectName, options) {
  const opts = options || {};
  const specDriven = opts.specDriven === true;
  const date = getDateString();
  return `# ${projectName} - Frame Project

This project is managed with **Frame**. AI assistants should follow the rules below to keep documentation up to date.

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

${specDriven ? `---

${SPEC_DRIVEN_SECTION}

` : ''}---

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

---

**Note:** This file is named \`AGENTS.md\` to be AI-tool agnostic. A \`CLAUDE.md\` symlink is provided for Claude Code compatibility.
`;
}

/**
 * STRUCTURE.json template
 */
function getStructureTemplate(projectName) {
  return {
    _frame_metadata: {
      purpose: "Project structure and module map for AI assistants",
      forAI: "Read this file FIRST when starting work on this project. It contains the module structure, data flow, and conventions. Update this file when you add new modules or change the architecture.",
      lastUpdated: getDateString(),
      generatedBy: "Frame"
    },
    version: "1.0",
    description: `${projectName} - update this description`,
    architecture: {
      type: "",
      entryPoint: "",
      notes: ""
    },
    modules: {},
    dataFlow: [],
    conventions: {}
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
function getQuickstartTemplate(projectName) {
  const date = getDateString();
  return `<!-- FRAME AUTO-GENERATED FILE -->
<!-- Purpose: Quick onboarding guide for developers and AI assistants -->
<!-- For Claude: Read this FIRST to quickly understand how to work with this project. Contains setup instructions, common commands, and key files to know. -->
<!-- Last Updated: ${date} -->

# ${projectName} - Quick Start Guide

## Setup

\`\`\`bash
# Clone and install
git clone <repo-url>
cd ${projectName}
npm install  # or appropriate package manager
\`\`\`

## Common Commands

\`\`\`bash
# Development
npm run dev

# Build
npm run build

# Test
npm test
\`\`\`

## Key Files

| File | Purpose |
|------|---------|
| \`STRUCTURE.json\` | Module map and architecture |
| \`PROJECT_NOTES.md\` | Decisions and context |
| \`todos.json\` | Task tracking |
| \`QUICKSTART.md\` | This file |

## Project Structure

\`\`\`
${projectName}/
├── .frame/           # Frame configuration
├── src/              # Source code
└── ...
\`\`\`

## For AI Assistants (Claude)

1. **First**: Read \`STRUCTURE.json\` for architecture overview
2. **Then**: Check \`PROJECT_NOTES.md\` for current context and decisions
3. **Check**: \`todos.json\` for pending tasks
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

module.exports = {
  getAgentsTemplate,
  getStructureTemplate,
  getNotesTemplate,
  getTasksTemplate,
  getQuickstartTemplate,
  getFrameConfigTemplate,
  SPEC_DRIVEN_SECTION,
  getCodexWrapperTemplate,
  getGenericWrapperTemplate
};
