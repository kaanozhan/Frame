<p align="center">
  <img src="assets/logo.png" alt="Frame" width="180" />
</p>

<h1 align="center">Frame</h1>

<p align="center"><strong>Spec-driven development that becomes durable, structural context — built on Claude Code.</strong></p>

<p align="center">
  <a href="https://frame.cool"><img src="https://img.shields.io/badge/website-frame.cool-d4a574" alt="Website"></a>
  <a href="https://www.linkedin.com/company/120884589/"><img src="https://img.shields.io/badge/LinkedIn-Frame-0A66C2?logo=linkedin&logoColor=white" alt="LinkedIn"></a>
  <a href="https://github.com/kaanozhan/Frame/releases"><img src="https://img.shields.io/github/v/release/kaanozhan/Frame?color=d4a574" alt="Latest release"></a>
  <a href="https://github.com/kaanozhan/Frame/releases"><img src="https://img.shields.io/github/downloads/kaanozhan/Frame/total?color=d4a574" alt="Total downloads"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/kaanozhan/Frame?color=d4a574" alt="License"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey" alt="Platforms">
  <a href="https://github.com/kaanozhan/Frame/stargazers"><img src="https://img.shields.io/github/stars/kaanozhan/Frame?style=social" alt="Stars"></a>
</p>

The shape of software development changed — agents write the code now — but
the foundation didn't: good results still come from good planning. Frame puts
planning back at the center. You write a spec once, and that single spec
becomes three things at once: the plan your agents follow, a clean unit of work
you can run in parallel without collisions, and the durable, shared context
your project keeps across every session. Every future agent arrives knowing
what was done and why — no more re-explaining your architecture every time you
open a terminal.

Built on Claude Code. Codex CLI and Gemini CLI work too — and because your
context lives in plain, git-versioned files, it stays yours and stays readable
by any tool.

https://github.com/user-attachments/assets/6fe108d1-70c8-441e-a913-b34583c803b0

---

## The Problem

As projects grow with AI agents, things fall apart fast:

- **Context loss** — every new session starts from scratch, you re-explain the same things over and over
- **No project memory** — AI doesn't know your architecture, past decisions, or pending tasks
- **No standard** — every developer structures their AI projects differently, making collaboration and onboarding painful
- **Sessions bleed into each other** — working on multiple projects means context gets mixed up
- **Terminal chaos** — multiple windows, scattered sessions, no organization
- **Tool fragmentation** — Claude, Codex, and Gemini each work differently

These problems are manageable on small projects. On larger ones, they become blockers.

Frame solves all of this.

---

## How Frame Works

### One Standard, Every Project, Every AI Tool

Frame brings a consistent structure to every project you work on. When you initialize Frame in a project, it creates:

| File | Purpose |
|------|---------|
| `AGENTS.md` | Project rules and instructions — AI reads this automatically |
| `STRUCTURE.json` | Module map with intentIndex for fast file lookup |
| `PROJECT_NOTES.md` | Architectural decisions and context that persist across sessions |
| `tasks.json` | Task tracking with status, context, and acceptance criteria |

Every project gets its own isolated session — its own context, its own task list, its own notes. Switching projects in Frame means switching to a completely fresh, project-specific AI context. No bleed-over, no confusion.

This standard works with any AI tool. Claude Code and Gemini CLI read these files natively. For Codex CLI, Frame injects them automatically via a wrapper script — no manual setup needed.

The result: any developer (or AI agent) who opens a Frame project immediately knows where everything is and what's been decided. Onboarding a new AI session to a large project takes seconds, not minutes.

### Git Commit as the Context Anchor

One of the hardest problems in agentic development is knowing *when* to capture context. Session boundaries are fuzzy — you might stay in the same session for hours. Task completion is ambiguous — agents don't always signal clearly when something is done. Trying to detect "important moments" mid-session is unreliable.

Frame's approach: **use git commits as the single reliable boundary.**

When you commit, something real happened. It's intentional, it's deterministic, and it's a natural checkpoint you're already making. Frame builds its entire context system around this moment:

- **STRUCTURE.json** — auto-updated via pre-commit hook, always reflects the current architecture
- **tasks.json** — task state syncs at commit time
- **PROJECT_NOTES.md** — the right moment to capture what changed and why

When the next session starts, these files are read automatically. The agent picks up exactly where things left off — not from a vague session transcript, but from structured, up-to-date context written at the one moment you can be certain something real was completed.

> **The practical implication:** commit often. Small, intentional commits aren't just good git hygiene — in Frame, they're how context stays accurate and agents stay oriented.

### Spec-Driven Development

For features that won't fit in one session, Frame ships a built-in spec workflow. Each spec is four markdown files on disk:

```
.frame/specs/<slug>/
  spec.md      what we're building
  plan.md      how we'll build it
  tasks.md     broken-down work
  outcome.md   what actually shipped
```

Describe what you want and the AI drafts the spec. `/spec.plan` produces an implementation plan. `/spec.tasks` breaks the plan into discrete tasks that import into `tasks.json` (tagged with `source: "spec:<slug>:T<n>"`). `/spec.implement` walks them one by one — and after each task, the agent appends 2-3 sentences to `outcome.md`: what shipped, what diverged from the plan, what to follow up on.

That last file is the move that makes the rest worth doing. Plans tell you intent. Code tells you reality. `outcome.md` tells you the *story* between them, written while the agent's memory was fresh — the kind of context that's normally lost the moment a session ends.

Two principles shaped this:

- **Files over databases.** Markdown is canonical. Any AI tool can read it without Frame, any teammate can grep it, git versions it, PRs review it.
- **Optional, never forced.** Spec-driven dev isn't every project's shape. Frame asks once when you open the Specs panel; you opt in or skip. Existing `tasks.json` workflows are untouched.

### Agent Orchestration

Running agents in parallel is easy — every tool does it now. Landing their
work into `main` without chaos is the hard part. That's what Frame's
orchestration is built for: specs make features durable, orchestration makes
them **parallel and safe to land.**

Open the Orchestrator and hand a **conductor** agent several ready specs. It runs them at the same time — each spec in its own **git worktree**, worked by its own agent, fully isolated. No two agents fighting over the same files, no half-finished work bleeding into your working tree.

The conductor doesn't guess at safety. Before running anything it reads each spec's declared **footprint** (the files it will touch) and only parallelizes specs that don't overlap; the rest are serialized. That guard is enforced in Frame's code, not left to the model — a spec whose footprint collides with in-flight work is refused, not merged into chaos.

The unit of parallelism is the **spec**, not the task. A spec's own tasks are interdependent, so one agent runs them in order; *different* specs are the independent units that fan out. Need more parallelism? Split the work into more specs.

When you dispatch a spec, Frame sets up its sandbox automatically — you don't run a single git command:

- a fresh **git worktree** at `.frame/worktrees/<slug>`, branched from current `HEAD` (so serialized specs build on already-merged work),
- a dedicated **work branch** `frame/<slug>/work`,
- a worker **frame** (terminal) launched in that worktree, with the agent started and the spec's prompt injected.

Every worker carries a live **state** you watch on the pipeline rail: `queued → running → done → approved`, with `blocked` (footprint conflict — held until its predecessor merges), `idle`, and `failed` surfaced too. Each worker is a real frame — click it to drop into its terminal, answer an approval prompt, or take over by hand. When you tear a session down, Frame removes the worktrees and prunes merged branches but **keeps un-merged work** on its branch, so nothing is lost.

You stay in control of what lands:

- Workers commit only to their own branch — they never push, never merge, never touch shared files (`tasks.json`, `STRUCTURE.json`, …).
- When a worker finishes, the conductor reviews it and tells you it's ready — it does **not** merge on its own.
- You review (you can test right in the worktree), then **Approve**. Frame runs a **drift check** — what the agent *actually* changed vs. what it *declared* — and merges locally into a per-spec integration branch. `main` is never touched; promoting it or opening a PR stays your call.

It all lives on one screen: the **conductor's terminal** (talk to it directly), the **pipeline rail** across the top, your **worker lanes**, and the **spec rail** to assign more — a cockpit, not a black box. Because no real task finishes in one shot and an agent may need your approval mid-run, you can always step into any frame and keep working by hand.

> **Honest framing:** this is *guardrailed, human-steered* parallelism — not fire-and-forget automation. The conductor proposes and isolates; you decide what merges. That's the point.

### Fast File Lookup

Instead of scanning the entire codebase, Frame's `intentIndex` maps concepts to files:

```bash
node scripts/find-module.js github    # → githubManager.js + githubPanel.js
node scripts/find-module.js terminal  # → all terminal-related files
node scripts/find-module.js --list    # → all features and their files
```

This means AI agents spend zero time searching — they go directly to the right file.

### Multi-AI Support

Switch between AI tools without leaving Frame:

- **Claude Code** — reads `CLAUDE.md` natively (symlink to AGENTS.md)
- **Codex CLI** — wrapper script at `.frame/bin/codex` injects AGENTS.md as initial prompt
- **Gemini CLI** — reads `GEMINI.md` natively

Multi-AI is a principle here, not a race: Frame goes deep on Claude Code, and
keeps your specs, plans, outcomes, and notes in plain markdown and JSON — so
the context your work produces outlives any single tool, including Frame.

---

## Features

### Terminal
- **Up to 9 terminals** in a single window — tab view or 2x1, 2x2, 3x1, 3x2, 3x3 grid
- **Real PTY** via node-pty — not a fake terminal, full VT100/ANSI support
- **Project-aware sessions** — terminal starts in your selected project directory
- **Resizable grid** — drag borders to adjust layout

### Project Management
- **Task Panel** — visual task tracking with filters, status management, and "Send to Claude" integration
- **Specs Panel** — spec-driven workflow with phase lifecycle (spec → plan → tasks → outcome) and slash-command handoff to your AI tool
- **GitHub Panel** — issues, PRs, branches, and labels directly in the sidebar
- **Git Branches** — view, switch, create, and manage branches and worktrees
- **Plugins Panel** — browse, enable/disable, and install Claude Code plugins

### Orchestration
- **Parallel spec execution** — a conductor agent runs multiple ready specs at once, each worker in its own git worktree
- **Code-enforced isolation** — footprint conflict guard, per-spec branches, drift-checked local merges; `main` is never touched
- **Live cockpit** — pipeline rail + worker lanes with per-worker **Open / Approve / Remove**
- **You approve** — the conductor reviews and reports; nothing merges without your review

### Context & Architecture
- **STRUCTURE.json** — auto-updated on every commit via pre-commit hooks
- **Overview Panel** — visual structure map of your project's modules
- **Session Notes** — automatic prompts to save important decisions to PROJECT_NOTES.md
- **Prompt History** — all terminal input logged with timestamps

### Multi-AI
- **AI Tool Selector** — switch between Claude Code, Codex CLI, and Gemini CLI
- **Automatic context injection** — every AI tool gets your project context on startup
- **Tool-specific commands** — menu adapts to the active AI tool

---

## Under the Hood

- **120+ IPC channels** powering real-time bidirectional communication between renderer and main process
- **40+ modules** across main and renderer processes
- **Pre-commit hooks** for automatic STRUCTURE.json updates
- **Transport layer abstraction** — architecture designed for Electron IPC → WebSocket migration (web platform coming)

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Desktop Framework | Electron |
| Terminal Emulator | xterm.js |
| PTY | node-pty |
| Code Parsing | tree-sitter (WASM) |
| Bundler | esbuild |
| UI | HTML/CSS/JS |

---

## Installation

### Prerequisites
- Node.js 16+
- npm
- At least one AI CLI tool: [Claude Code](https://claude.ai/claude-code), [Codex CLI](https://github.com/openai/codex), or [Gemini CLI](https://github.com/google-gemini/gemini-cli)

### Steps

```bash
git clone https://github.com/kaanozhan/Frame.git
cd Frame
npm install
npm run dev
```

### Download

Pre-built binaries available on the [releases page](https://github.com/kaanozhan/Frame/releases) for macOS, Windows, and Linux.

---

## Usage

### Basic Workflow

1. **Select a project** — click "Select Project Folder" or choose from recent projects
2. **Initialize Frame** — click "Initialize Frame Project" to create AGENTS.md, STRUCTURE.json, PROJECT_NOTES.md, and tasks.json
3. **Start an AI session** — click "Start Claude Code" (or your chosen tool) — it launches in your project directory with full context
4. **Work** — tasks are tracked, decisions are saved, context persists

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` | Start AI session |
| `Ctrl+Shift+T` | New terminal |
| `Ctrl+Shift+W` | Close terminal |
| `Ctrl+Tab` | Next terminal |
| `Ctrl+Shift+G` | Toggle grid view |
| `Ctrl+1-9` | Switch to terminal by number |
| `Ctrl+Shift+H` | Toggle history panel |

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│              Main Process (Node.js)              │
│                                                  │
│  PTY Manager · File System · Tasks · GitHub      │
│  AI Tool Manager · Git · Plugins · Overview      │
│                                                  │
│              115+ IPC Channels                   │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────┐
│              Renderer (Browser)                  │
│                                                  │
│  Multi-Terminal Grid · Sidebar · Task Panel      │
│  GitHub Panel · Structure Map · AI Selector      │
└─────────────────────────────────────────────────┘
```

---

## Roadmap

### Done
- [x] Terminal-first IDE with multi-terminal grid (up to 9)
- [x] Frame project structure (AGENTS.md, STRUCTURE.json, tasks.json, PROJECT_NOTES.md)
- [x] Multi-AI support — Claude Code, Codex CLI, Gemini CLI
- [x] Automatic context injection via wrapper scripts
- [x] Task panel with AI integration
- [x] GitHub panel — issues, PRs, branches
- [x] Git branches and worktrees panel
- [x] STRUCTURE.json intentIndex for fast file lookup
- [x] Plugins panel
- [x] Overview / structure map panel
- [x] Pre-commit hooks for automatic structure updates
- [x] Spec-driven development — spec / plan / tasks / outcome markdown workflow with auto-import to tasks.json
- [x] Agent orchestration — conductor-led parallel spec execution, each agent isolated in its own git worktree
- [x] Light / dark theme

### In Progress
- [ ] Prompt history as developer style profile — learning and persisting your working style across sessions
- [ ] Web platform (Frame Server) — same experience in the browser via WebSocket transport

### Planned
- [ ] Plugin marketplace
- [ ] Remote development (SSH)

---

## Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit: `git commit -m 'Add your feature'`
4. Push: `git push origin feature/your-feature`
5. Open a Pull Request

---

## Acknowledgments

Frame's code graph is powered by [tree-sitter](https://tree-sitter.github.io/),
the incremental parsing library from the open-source community — via
[web-tree-sitter](https://github.com/tree-sitter/tree-sitter/tree/master/lib/binding_web)
and the official grammars for
[JavaScript](https://github.com/tree-sitter/tree-sitter-javascript),
[TypeScript](https://github.com/tree-sitter/tree-sitter-typescript),
[Python](https://github.com/tree-sitter/tree-sitter-python),
[Go](https://github.com/tree-sitter/tree-sitter-go) and
[Rust](https://github.com/tree-sitter/tree-sitter-rust) (all MIT licensed —
see [resources/tree-sitter/LICENSES.md](./resources/tree-sitter/LICENSES.md)).
Thanks as well to Electron, xterm.js, node-pty, esbuild and the rest of the
open-source stack Frame is built on.

---

## License

Apache-2.0 — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE)

---

*Built with Frame, using Claude Code.*
*frame.cool*
