# Frame

**The platform for agentic development.**

Frame started as a lightweight terminal-first IDE. It's evolving into a full platform for developing and managing larger projects with AI agents — bringing structure, context, and organization to the way you work with Claude Code, Codex CLI, and Gemini CLI.

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

---

## Features

### Terminal
- **Up to 9 terminals** in a single window — tab view or 2x1, 2x2, 3x1, 3x2, 3x3 grid
- **Real PTY** via node-pty — not a fake terminal, full VT100/ANSI support
- **Project-aware sessions** — terminal starts in your selected project directory
- **Resizable grid** — drag borders to adjust layout

### Project Management
- **Task Panel** — visual task tracking with filters, status management, and "Send to Claude" integration
- **GitHub Panel** — issues, PRs, branches, and labels directly in the sidebar
- **Git Branches** — view, switch, create, and manage branches and worktrees
- **Plugins Panel** — browse, enable/disable, and install Claude Code plugins

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

- **115+ IPC channels** powering real-time bidirectional communication between renderer and main process
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

## License

MIT — see [LICENSE](./LICENSE)

---

*Built with Frame, using Claude Code.*
*frame.cool*
