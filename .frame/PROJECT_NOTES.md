# Frame - Project Documentation

## Project Vision

**Problem:** When developing with Claude Code, there's no need for tools like VS Code or Cursor - they are designed for writing code manually. But when staying in the terminal:
- Projects remain disorganized
- Context is lost between sessions
- Decisions are forgotten
- There's no standardization

**Solution:** Frame - a terminal-centric development framework. Not an IDE, but a **framework**.

**Why "Frame":** The word means "framework". Within Frame, we create "Frame projects" - with standard documents (CLAUDE.md, tasks.json, STRUCTURE.json), every project has the same structure.

**Core Philosophy:**
- **Terminal-first:** The center is not a code editor, but the terminal. Even multiple terminals (grid).
- **Claude Code-native:** This tool is for those who develop with Claude Code.
- **Standardization:** Every project has the same structure, the same documents.
- **Context preservation:** Session notes, decisions, tasks - nothing should be lost.
- **Manageability:** All projects can be viewed and managed from one place.

> **[2026-07-02 evolution]** This Jan-2026 vision still holds, but the *center* has
> moved: from **the terminal** to **spec-driven context production**. The core value
> today is the durable, structural context the spec → plan → tasks → outcome
> workflow produces for *future* agents — so an agent months later arrives knowing
> what was done, why, and what resulted, instead of scanning code and guessing.
> Terminal-first is now the *surface*, not the *center*. See the 2026-07-02 session
> note at the end of this file.

**Target User:** Developers who do daily development with Claude Code, working terminal-focused.

**What Frame is NOT:**
- Not a code editor (there's a file editor but it's not central)
- Not a VS Code/Cursor alternative
- Not optimized for writing code manually

---

## Project Summary
IDE-style desktop application for Claude Code. Features a 3-panel layout with project explorer, multi-terminal support (tabs/grid), file editor, and prompt history.

**App Name:** Frame (formerly Claude Code IDE)

---

## Tech Stack

### Core
- **Electron** (v28.0.0): Cross-platform desktop framework
- **xterm.js** (v5.3.0): Terminal emulator (same as VS Code)
- **node-pty** (v1.0.0): PTY management for real terminal experience
- **esbuild**: Fast bundling for modular renderer code

### Why These Technologies?
- **Electron**: Single codebase for Windows, macOS, Linux
- **xterm.js**: Full ANSI support, progress bars, VT100 emulation
- **node-pty**: Real PTY for interactive CLI tools like Claude Code
- **esbuild**: Sub-second builds, ES module support

---

## Testing

- **Runner:** `npm test` → `FRAME_ACTIVITY_HOME=.frame/runtime/test-activity
  node --test test/*.test.js` (Node's built-in runner; no test framework
  dependency)
- **Location & naming:** `test/*.test.js`, flat, one file per module under
  test. `test/fixtures/` holds sample repos as data — the glob deliberately
  excludes it, since Node would otherwise execute those files as tests.
- **Covered:** `src/main/`, `src/shared/`, `scripts/`, `src/templates/`
  (`build-implement-report.mjs` via dynamic import, `implement-launch.js`),
  and the **pure** modules under `src/renderer/home/` (`agentRows`,
  `sessionRows`) — 35 test files. The convention is to target the pure module
  and skip its Electron-coupled wrapper (`telemetryEvents.js` is tested,
  `telemetry.js` is not); where a test must load an Electron-coupled module,
  it stubs the external requires (`specTasksSync.test.js`).
- **Not covered:** DOM-coupled renderer code — every `src/renderer/*.js`
  surface that touches the document. No DOM harness is present (`jsdom`,
  `playwright`, `@testing-library`, `puppeteer` all absent), so a UI surface
  is testable here only by first extracting its logic into a dependency-free
  module, which is what `src/renderer/home/` did.
- **CI:** `.github/workflows/ci.yml` — `npm test` on ubuntu + macos.
  Deliberately runs **no** `npm ci`: the suite must work from repo-local
  modules alone, so any test that reaches a package in `node_modules` will
  pass locally and fail in CI.

- _Recorded 2026-08-29 by /spec.plan (spec-reports-one-shell-two-themes-in-app)_

---

## Architecture

### Modular Structure

```
src/
├── main/                    # Electron Main Process (Node.js)
│   ├── index.js            # Window creation, IPC handlers
│   ├── pty.js              # Single PTY (backward compat)
│   └── ptyManager.js       # Multi-PTY management
│
├── renderer/               # Electron Renderer (bundled by esbuild)
│   ├── index.js           # Entry point
│   ├── terminal.js        # Terminal API (backward compat)
│   ├── terminalManager.js # Multi-terminal state management
│   ├── terminalTabBar.js  # Tab bar UI component
│   ├── terminalGrid.js    # Grid layout UI component
│   ├── multiTerminalUI.js # Orchestrator for terminal UI
│   └── editor.js          # File editor overlay
│
└── shared/                 # Shared between main & renderer
    └── ipcChannels.js     # IPC channel constants
```

### Build System

```bash
# esbuild bundles renderer modules
npm run build:renderer  # One-time build
npm run watch:renderer  # Watch mode for dev
npm start              # Builds + starts app
```

**esbuild.config.js:**
- Entry: `src/renderer/index.js`
- Output: `dist/renderer.bundle.js`
- Platform: browser
- Bundle: true (includes all imports)

### Process Architecture

```
┌─────────────────────────────────────────────────────────┐
│           Electron Main Process (Node.js)                │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ PTY Manager  │  │ File System  │  │ Prompt Logger│  │
│  │ Map<id,pty>  │  │ (fs module)  │  │ (history.txt)│  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                          │
│                    IPC Channels                          │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────────────┐
│           Electron Renderer (Browser)                    │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │              MultiTerminalUI                      │   │
│  │  ┌────────────┐ ┌───────────┐ ┌───────────────┐  │   │
│  │  │  TabBar    │ │   Grid    │ │TerminalManager│  │   │
│  │  └────────────┘ └───────────┘ └───────────────┘  │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌────────────┬──────────────┬────────────────┐         │
│  │  Sidebar   │  Terminals   │  History Panel │         │
│  │ (FileTree) │  (xterm.js)  │                │         │
│  └────────────┴──────────────┴────────────────┘         │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │              File Editor Overlay                  │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## Features

### 1. Multi-Terminal System

**Components:**
- `ptyManager.js` - Main process: Manages Map of PTY instances
- `terminalManager.js` - Renderer: Manages xterm.js instances
- `terminalTabBar.js` - Tab UI with new/close/rename
- `terminalGrid.js` - Grid layout with resizable cells
- `multiTerminalUI.js` - Orchestrates all components

**View Modes:**
- **Tabs** (default): Single terminal with tab switching
- **Grid**: Multiple terminals visible (2x1, 2x2, 3x1, 3x2, 3x3)

**Features:**
- Maximum 9 terminals
- New terminals open in home directory
- Double-click tab to rename
- Resizable grid cells
- Keyboard shortcuts for navigation

**IPC Channels:**
```javascript
TERMINAL_CREATE: 'terminal-create',
TERMINAL_CREATED: 'terminal-created',
TERMINAL_DESTROY: 'terminal-destroy',
TERMINAL_DESTROYED: 'terminal-destroyed',
TERMINAL_INPUT_ID: 'terminal-input-id',
TERMINAL_OUTPUT_ID: 'terminal-output-id',
TERMINAL_RESIZE_ID: 'terminal-resize-id',
```

### 2. File Editor

**Component:** `editor.js`

- Overlay editor for quick file viewing/editing
- Opens on file click in tree
- Save with button or close with Escape
- Monaco-style dark theme

### 3. Project Explorer

- Collapsible file tree (5 levels deep)
- Filters: node_modules, hidden files
- Icons: folders, JS, JSON, MD files
- Alphabetical sort (folders first)

### 4. Prompt History

- Logs all terminal input with timestamps
- Side panel toggle (Ctrl+Shift+H)
- Persisted to user data directory

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+K | Start Claude Code |
| Ctrl+I | Run /init |
| Ctrl+Shift+C | Run /commit |
| Ctrl+H | Open history file |
| Ctrl+Shift+H | Toggle history panel |
| Ctrl+Shift+T | New terminal |
| Ctrl+Shift+W | Close terminal |
| Ctrl+Tab | Next terminal |
| Ctrl+Shift+Tab | Previous terminal |
| Ctrl+1-9 | Switch to terminal N |
| Ctrl+Shift+G | Toggle grid view |

---

## Implementation Details

### Multi-Terminal State Flow

```
User clicks [+]
    │
    ▼
 TerminalTabBar.createTerminal()
    │
    ▼
 TerminalManager.createTerminal()
    │
    ├─── Send IPC: TERMINAL_CREATE
    │
    ▼
Main Process: ptyManager.createTerminal()
    │
    ├─── Create new PTY instance
    ├─── Add to Map<terminalId, pty>
    ├─── Setup output listener
    │
    ▼
Send IPC: TERMINAL_CREATED { terminalId }
    │
    ▼
 TerminalManager._initializeTerminal()
    │
    ├─── Create xterm.js instance
    ├─── Create FitAddon
    ├─── Add to terminals Map
    │
    ▼
MultiTerminalUI._onStateChange()
    │
    ├─── Update TabBar
    └─── Render active terminal
```

### Grid View Implementation

```javascript
// CSS Grid based layout
const GRID_LAYOUTS = {
  '2x1': { rows: 2, cols: 1 },
  '2x2': { rows: 2, cols: 2 },
  '3x1': { rows: 3, cols: 1 },
  '3x2': { rows: 3, cols: 2 },
  '3x3': { rows: 3, cols: 3 }
};

// Each cell contains:
// - Header (name + close button)
// - Terminal content area
// - Resize handles (right, bottom)
```

### View Mode Switching

**Important:** When switching from grid to tab view, all inline grid styles must be cleared:

```javascript
_renderTabView(state) {
  this.contentContainer.innerHTML = '';
  this.contentContainer.className = 'terminal-content tab-view';
  // Clear grid inline styles
  this.contentContainer.style.display = '';
  this.contentContainer.style.gridTemplateRows = '';
  this.contentContainer.style.gridTemplateColumns = '';
  this.contentContainer.style.gap = '';
  this.contentContainer.style.backgroundColor = '';
  // ... mount active terminal
}
```

---

## Development Notes

### Adding New Terminal Feature

1. Add IPC channel in `src/shared/ipcChannels.js`
2. Add handler in `src/main/ptyManager.js`
3. Register IPC in `src/main/index.js`
4. Add UI in renderer module
5. Build: `npm run build:renderer`

### Adding New Panel

1. Add HTML structure in `index.html`
2. Add CSS styles
3. Create module in `src/renderer/`
4. Import in `src/renderer/index.js`
5. Build with esbuild

### Debug Mode

```javascript
// In src/main/index.js
mainWindow.webContents.openDevTools();
```

---

## Lessons Learned

### 1. PTY vs Subprocess
- subprocess.Popen insufficient for interactive CLIs
- node-pty provides real terminal (TTY detection, ANSI, signals)

### 2. Multi-Terminal Architecture
- Each terminal needs unique ID for routing
- Main process manages PTY lifecycle
- Renderer manages xterm.js instances
- State changes trigger UI updates

### 3. CSS Grid for Terminal Layout
- Grid provides flexible multi-terminal layouts
- Must clear inline styles when switching views
- FitAddon.fit() needed after layout changes

### 4. esbuild for Modularity
- Fast bundling enables modular development
- CommonJS require() works in bundled output
- Single bundle simplifies Electron loading

---

## Roadmap

### Completed
- [x] IDE layout (3 panel)
- [x] File tree explorer
- [x] Prompt history panel
- [x] Modular architecture (esbuild)
- [x] Multi-terminal (tabs)
- [x] Multi-terminal (grid view)
- [x] Grid cell resize
- [x] Terminal rename
- [x] File editor overlay

### Next Steps
- [ ] File click → cat command
- [ ] File tree refresh
- [ ] Search in files
- [ ] Resizable sidebar
- [ ] Git integration
- [ ] Settings panel

### Future Vision
- Project dashboard with cards
- Auto-documentation (SESSION_LOG.md, DECISIONS.md)
- Claude API integration for context optimization
- Session timeline view
- **Frame Server (Web App mode)** - Run Frame on headless server, access via browser (like code-server)

---

## File Reference

| File | Purpose |
|------|---------|
| `src/main/index.js` | Main process, window, IPC |
| `src/main/ptyManager.js` | Multi-PTY management |
| `src/main/pty.js` | Single PTY (backward compat) |
| `src/renderer/index.js` | Renderer entry point |
| `src/renderer/terminal.js` | Terminal API wrapper |
| `src/renderer/terminalManager.js` | Terminal state management |
| `src/renderer/terminalTabBar.js` | Tab bar UI |
| `src/renderer/terminalGrid.js` | Grid layout UI |
| `src/renderer/multiTerminalUI.js` | Terminal UI orchestrator |
| `src/renderer/editor.js` | File editor overlay |
| `src/shared/ipcChannels.js` | IPC channel constants |
| `index.html` | UI layout + CSS |
| `esbuild.config.js` | Bundler config |

---

**Project Start:** 2026-01-21
**Last Updated:** 2026-01-30
**Status:** Frame System + Task Management + GitHub Panel Complete

---

## Session Notes

### [2026-01-25] Project Navigation System

**Context:** When Claude Code enters a project, it needs to quickly capture the context.

**Decision:** The trio of STRUCTURE.json + PROJECT_NOTES.md + tasks.json.

**Implementation:**
1. "Project Navigation" section in CLAUDE.md - files to read at session start
2. STRUCTURE.json - module map, architectureNotes
3. Pre-commit hook - STRUCTURE.json updates automatically

**[2026-01-26 Update]:**
- "Token Efficiency Protocol" claim removed (wasn't realistic)
- Line numbers removed (constantly changing, hard to maintain)
- Format simplified - now more practical

---

### [2026-01-25] Task Delegation to Claude Code

**Context:** We wanted to automatically send tasks to Claude Code when pressing the play button in the Tasks panel.

**Decision:**
- Play (▶) button sends the task to Claude Code as a prompt
- If Claude Code is not running, the `claude` command is sent first, waits 2 seconds, then the task is sent

**Implementation:**
- `tasksPanel.js` → `sendTaskToClaude()` function
- Sending to terminal via `terminal.sendCommand()`
- `claudeCodeRunning` state tracking

**Future improvement:** Detecting if Claude Code is actually running by parsing terminal output (task-claude-detect).

---

### [2026-01-25] Pre-commit Hook for STRUCTURE.json

**Context:** Manually updating STRUCTURE.json is difficult and gets forgotten.

**Decision:** Automatic update with Git pre-commit hook.

**Implementation:**
```bash
# .githooks/pre-commit
STAGED_JS=$(git diff --cached --name-only --diff-filter=ACMRD | grep '\.js$')
if [ -n "$STAGED_JS" ]; then
    npm run structure:changed
    git add STRUCTURE.json
fi
```

**Advantage:** Only changed files are parsed (git diff based), the entire project is not scanned.

---

### [2026-01-25] Task Action UX Improvement

**Context:** Changing task status with a checkbox was confusing - users couldn't understand what would happen.

**Decision:** Explicit action buttons instead of checkbox:
- Pending: ▶ Start, ✓ Complete
- In Progress: ✓ Complete, ⏸ Pause
- Completed: ↺ Reopen

**Addition:** Toast notification system added - feedback like "Task started", "Task completed".

---

### [2026-01-26] Frame Vision & Context Preservation Feature

**User's explanation:**

> "My problem was this, yes I can develop with claude code. but I only stay in the terminal. I don't feel the need to use a platform like vs code or cursor. because those are tools designed for writing code manually. I don't need such complexity. I need standardization and manageability for my projects. I'm terminal and claude code focused. that's why frame's center is not a code editor, but a terminal, we even have a multi-terminal structure with grid. That's why the name is Frame. this is a framework, so we create a frame project within frame, we create these documents to set a standard. so that I can see the projects I develop with claude code in an organized way. so I don't lose context, I note down what's written in sessions."

**Frame's True Purpose:**
- Terminal-centric (not a code editor)
- Claude Code-native development
- Standardization across projects
- Preventing context loss
- Tracking session notes and decisions

**Context Preservation Feature Design:**

User: "we shouldn't end session... when we reach a decision, when we say let's do it, maybe when the work is successful we should ask the user, should we add this to notes? because automatically deciding the importance mechanism would be very difficult. we can leave the importance decision to the user. you ask, if they say add, you add, but there should be added exactly as discussed with the user, not a summary."

**Decisions Made:**
1. NO "End session" button/flow - it should be organic
2. When a task/decision is completed, Claude will ask: "Should I add this to PROJECT_NOTES?"
3. Importance decision is with the user - Claude only suggests
4. NOT a summary, the conversation should be added as is (context must be preserved)
5. Should not be asked for every small thing (it becomes spam)

**Completion Detection:**
- User approval: "okay", "done", "it worked", "nice"
- Topic change
- Build/run success

**Implementation:**
- "Context Preservation" section added to CLAUDE.md
- Template in frameTemplates.js updated (for new projects)

**First Implementation:** This note was the first use of this feature. Claude asked "should I add?", the user said "yes", and this note was added.

---

### [2026-01-26] CLAUDE.md Simplification and "Only Requested Changes" Lesson

**Context:** The user requested:
- Remove Token Efficiency claims (80-90% savings wasn't realistic)
- Remove line numbers (hard to maintain)
- Make PROJECT_NOTES format free-form (instead of formal table)

**What happened:**
Claude deleted too much in the first attempt - removed important content under the name of simplification:
- Details of task rules
- "When to Update?" sections
- Update flows

The user warned: "actually everything you deleted in the claude.md file was important. we didn't make a complete simplification decision there. our requests were clear."

**Solution:**
1. Original file restored from Git
2. Only the 3 requested changes were made:
   - "Token Efficiency Protocol" → "Project Navigation"
   - Line numbers removed
   - Format made free-form
3. All other content preserved

**Lesson:** Simplification ≠ deleting content. Do only what the user asked. Don't delete extra things thinking "I think this is also unnecessary".

---

### [2026-01-30] Frame Server Feature Request (Web App Mode)

**Context:** GitHub issue request - user has Windows PC for display and headless Debian machine for development.

**User's request:**
> "I have this requirement too. I have a Windows PC that I want to run this on, but my development machine is a headless debian machine. Come to think of it, exposing it as a web app (like code-server) would be useful too - then I can install this on my headless linux dev box and open it on any browser anywhere and start working. Should be doable since this is electron based, no?"

**Analysis:**
- Frame is Electron-based (Chromium + Node.js) - already web technologies
- xterm.js is web-native, works in browser
- Main change needed: IPC → WebSocket communication
- Pattern proven by code-server (VS Code in browser)

**Proposed Architecture:**
```
Electron App                    Web App (Frame Server)
─────────────                   ─────────────────────
ipcMain/ipcRenderer    →        Express + WebSocket
Electron window        →        Static HTML server
node-pty (same)                 node-pty (same)
xterm.js (same)                 xterm.js (same)
```

**Decision:** Added to roadmap as "Frame Server" - will consider for future development based on community interest.

---

### [2026-02-05] Context Injection for Non-Claude AI Tools (Wrapper Script System)

**Context:** Frame supports multiple AI tools (Claude Code, Codex CLI, etc.). Claude Code automatically reads CLAUDE.md, but other tools like Codex CLI don't have this convention. We needed a way to inject project context (AGENTS.md) into these tools.

**Problem discussed:**
- Claude Code → reads CLAUDE.md automatically ✓
- Codex CLI → no standard, context is lost

**Solution explored:**
1. First attempt: Use `--system-prompt` flag → Failed (Codex CLI doesn't have this flag)
2. Final solution: Wrapper script that sends "Read AGENTS.md" as initial prompt

**Implementation:**
- `.frame/bin/` directory created for AI tool wrappers
- `.frame/bin/codex` wrapper script:
  - Finds AGENTS.md in project directory
  - Runs `codex "Please read AGENTS.md and follow the project instructions."`
- Frame init automatically creates wrapper scripts
- `aiToolManager.js` updated to use wrapper for Codex

**Files changed:**
- `src/shared/frameConstants.js` - Added `FRAME_BIN_DIR`
- `src/shared/frameTemplates.js` - Added `getCodexWrapperTemplate()`, `getGenericWrapperTemplate()`
- `src/main/frameProject.js` - Creates `.frame/bin/codex` on init
- `src/main/aiToolManager.js` - Codex command points to `./.frame/bin/codex`

**Key insight:** Instead of trying to pass system prompts via flags (which vary per tool), simply ask the AI to read the AGENTS.md file. This approach is tool-agnostic and works with any AI coding assistant.

**Result:** Codex CLI now reads AGENTS.md on startup, maintaining context preservation across different AI tools.

---

### [2026-02-08] Gemini CLI Integration & Node.js Version Upgrade

**Context:** Frame already supported Claude Code and Codex CLI. We reviewed the Codex integration pattern and added Gemini CLI to the same multi-tool infrastructure.

**Architectural decision — Symlink vs Wrapper:**
- Codex CLI required a **wrapper script** (no native file reading support, AGENTS.md is injected via `.frame/bin/codex`)
- Gemini CLI reads `GEMINI.md` **natively** (just like Claude Code reads CLAUDE.md)
- Therefore no wrapper script was needed for Gemini — we used the same **symlink approach** as CLAUDE.md: `GEMINI.md → AGENTS.md`

**Files changed:**
- `src/shared/frameConstants.js` - Added `GEMINI_SYMLINK: 'GEMINI.md'`
- `src/main/aiToolManager.js` - Added Gemini CLI tool definition (commands: `/init`, `/model`, `/memory`, `/compress`, `/settings`, `/help`)
- `src/main/frameProject.js` - Creates `GEMINI.md → AGENTS.md` symlink on Frame init
- `src/main/menu.js` - Added Gemini-specific menu commands: Memory, Compress Context, Settings
- `README.md` - Updated to include Gemini CLI support

**Node.js version issue (important):**
Gemini CLI's dependency `string-width` uses the `/v` regex flag which requires Node.js 20+. With Node.js 18, it threw `SyntaxError: Invalid regular expression flags`.

- Before: Node.js v18.20.8 → Gemini CLI crashed on startup
- After: Node.js v20.20.0 → Issue resolved
- Commands: `nvm install 20` + `nvm alias default 20` + `npm install`
- Impact on Frame: None — Electron 28, node-pty, xterm.js all compatible with Node 20
- `nvm alias default 20` is critical — without it, terminals spawned by Frame still use the old default version

---

### [2026-02-16] Claude Panel — Sessions Tab

**Context:** The Claude panel only had a "Plugins" tab. The user wanted a "Sessions" tab to browse past Claude Code sessions (similar to `/resume`).

**Data source:** `~/.claude/projects/{encoded-path}/sessions-index.json` — Claude Code stores session history per project in this file. Sessions are project-scoped (`projectPath` field present in each entry).

**Important discovery:** The plan assumed the file was a plain JSON array, but the actual format is `{ version: 1, entries: [...] }`. The panel appeared empty on the first run; a fix was applied to read from the `entries` field.

**Files changed:**
- `src/shared/ipcChannels.js` — Added `LOAD_CLAUDE_SESSIONS`, `REFRESH_CLAUDE_SESSIONS` channels
- `src/main/claudeSessionsManager.js` — New module: reads sessions-index.json, path encoding, IPC handlers
- `src/main/index.js` — Manager registration (setupIPC + init)
- `index.html` — Sessions tab button and content area (header bar + refresh + sessions list)
- `src/renderer/pluginsPanel.js` — Session loading, rendering, refresh, resume, formatRelativeTime functions
- `src/renderer/styles/components/panels.css` — Session item, sidechain indicator, empty state styles

**Features:**
- Session list: summary, relative time, branch badge, message count
- Clicking a session sends `claude --resume {id}` to the terminal and closes the panel
- Refresh button with spinner animation
- Sidechain sessions marked with a warning-color left border
- "No project selected" empty state when no project is active

---

### [2026-02-16] Frame Server — Browser Mode Technical Planning

**Context:** Discussion about making Frame run in the browser so it can be deployed on a remote server and accessed from any device.

**Why it's feasible:**
- UI is already web technologies (HTML/CSS/JS)
- xterm.js is a native browser component
- node-pty stays server-side, unchanged
- Pattern proven by code-server (VS Code in browser)

**What changes:**
- Electron window → Express/Fastify HTTP server
- IPC (`ipcMain`/`ipcRenderer`) → WebSocket
- Terminal I/O streams over WebSocket
- File system, tasks, etc. stay server-side — only the transport layer changes

**Approach decided:** Transport layer abstraction — create a middle layer that works with both Electron IPC and WebSocket. Single codebase, two modes (desktop + web). This avoids maintaining two separate codebases.

**Deployment model:** Frame Server + SSH tunnel is the most practical approach. Frame runs on the server, SSH tunnel provides security, browser provides the UI. No separate authentication needed since SSH handles it.

**Steps:**
1. Abstract IPC into a transport layer (supports both Electron IPC and WebSocket)
2. Create Express server that serves the UI and handles WebSocket connections
3. SSH tunnel for secure remote access
4. (Optional) Authentication, HTTPS, multi-user support

**Status:** Planned as the next major feature. Not started yet.

### [2026-04-29] Spec-Driven Development — data model

Frame is gaining native spec-driven development as a core feature (4-slice plan tracked under `spec-driven-dev` in `tasks.json`). Slice 1 designs the on-disk layout below. Format is **Frame's own**, not Spec Kit compatible — the brand call was full UX control over compatibility.

**File layout** (per project, alongside `tasks.json` / `AGENTS.md` / `STRUCTURE.json`):

```
.frame/
  specs/
    <slug>/
      spec.md       ← what we're building (Problem, Goal, Constraints, Success Criteria, Out of Scope)
      plan.md       ← how (architecture, files touched, dependencies, sequencing)
      tasks.md      ← broken-down tasks (markdown bullets parsed into tasks.json)
      status.json   ← metadata (phase, ai_tool, generated_task_ids, timestamps)
  templates/
    specs/
      <name>.md     ← project-level overrides (optional)
```

`<slug>` is kebab-case derived from the spec title. Conflicts get a `-2`, `-3` suffix (e.g., `share-button`, `share-button-2`).

**`status.json` schema:**

```json
{
  "slug": "share-button",
  "title": "Add Share button to ProductPage",
  "phase": "implementing",
  "ai_tool": "claude-code",
  "generated_task_ids": ["task-spec-share-button-T01", "..."],
  "created_at": "2026-04-29T10:00:00.000Z",
  "updated_at": "2026-04-29T11:30:00.000Z",
  "last_phase_at": "2026-04-29T11:00:00.000Z"
}
```

**Lifecycle phases** (linear, no skipping):
- `draft` — folder exists, no `spec.md` yet (created but not described)
- `specified` — `spec.md` written
- `planned` — `plan.md` written
- `tasks_generated` — `tasks.md` written, tasks synced to `tasks.json`
- `implementing` — at least one generated task moved to `in_progress`
- `done` — all generated tasks `completed`

**`tasks.json` linkage:** every generated task carries `source: "spec:<slug>:T<n>"`. `status.generated_task_ids` is the back-reference. Re-running `/spec.tasks` updates titles/descriptions in place but **never** clobbers user-set status — pending → in_progress → completed transitions belong to the user, not the import.

**AI tool field** (`ai_tool`): `"claude-code"` | `"codex"` | `"gemini"`. Recorded so prompt formatting stays consistent across resumes (panel can re-issue slash commands the same way).

**Slug rules**:
- Lowercase, kebab-case, alphanumeric + hyphen
- Max 48 chars (truncate)
- Strip leading/trailing hyphens
- Conflict resolution: append `-2`, `-3`, etc.

**Validator**: `validateSpecStatus(obj)` lives in `src/main/specManager.js`. Shape check only — phase enum, required fields, ISO date strings. No deep semantic validation.

**Watcher**: `fs.watch` with `recursive: true` on `.frame/specs/`. Debounced 250ms. On any change, re-scans the directory and pushes `SPEC_DATA` to the renderer with the changed slug + fresh content.

---

### [2026-06-10] Lane Orchestrator — initial screen redesign (spec opened)

**Context:** User wants Frame's initial view to be a "lane orchestrator" board instead of opening directly into a terminal with tabs.

**User's request (original):**

> "Frame ilk açıldığında ... initial olarak bir ekran görmek istiyorum. Bunu da bir lane orchestrator olarak düşünebiliriz. Bu ekrandan terminal de eklenebilecek. Terminalleri tab tab görmektense bir lane olarak görüp istediğimiz lane'e girebileceğimiz bir genel ekran yapısı olmalı. Detay ekrandan da çok hızlı bir şekilde ana ekrana dönebileceğimiz bir yapı olmalı; ayrıca detaydayken bir menüden de kolayca ana ekranda neler varsa onları görüp tab gibi geçiş yapabilmeliyiz."

**Decisions made (via design Q&A):**
1. **Lane = terminal, 1:1** — reuses terminalManager state directly; richer "lane = work context" model deferred to a future spec.
2. **Cards show metadata only** in v1 (name, project, AI tool, last activity) **plus a live activity status badge**: `processing` (output flowing) / `waiting` (Claude Code blocked on input/permission prompt) / `idle` (shell at prompt). Detection is a renderer-side heuristic over the existing PTY output stream — this absorbs the old `task-claude-detect` idea.
3. **Tabs are retired, grid view stays** as the "watch several lanes side by side" mode, reachable from the board. Navigation becomes board ↔ detail, with a lane switcher inside detail (Ctrl+Tab / Ctrl+1-9 rebound to lanes).
4. No terminal auto-created on launch anymore (`autoCreateInitialTerminal` behavior retired).

**Artifact:** spec opened at `.frame/specs/lane-orchestrator/spec.md` (phase: specified). Next step is `/spec.plan`.

---

### [2026-06-11] Naming: Mainframe & Frames (brand vocabulary)

**Context:** The home screen needed a name; UI used "Lane" and "Terminal" interchangeably.

**Decision (user's idea):** Unify on the product's own brand: each work stream (terminal) is a **Frame**, and the home/orchestrator screen is the **Mainframe**. "Lane" is retired from the UI vocabulary (kept in internal code/module names only — laneBoard.js etc.).

**Applied:** board title "Mainframe · Active Frames · N", back button "⌂ Mainframe", default terminal names "Frame 1/2/…", "New Frame" everywhere (board card, grid placeholder cells, + button), command palette category "Frames" ("New Frame", "Switch to Frame N", "Back to Mainframe").

---

### [2026-06-11] Top-bar tabs: Home + Frames; "Mainframe" label → "Home"

**Context:** The top-bar left section had a single "Mainframe" button + an Active Frames count floating next to it.

**Decisions (user):**
1. The board tab's visible label is now **"Home"** (not "Mainframe"). The internal `btn-lane-home` / board view-mode naming is unchanged.
2. A sibling **"Frames"** tab sits right after Home, carrying the Active Frames count. It is **hidden when no Frame is open** (not disabled) and always renders in 2nd position once ≥1 Frame exists. Clicking it enters the active Frame's detail view (`multiTerminalUI.enterFrames()`). The active Frame's *name* is intentionally **not** shown on the tab — just "Frames" + count.

---

### [2026-06-11] Spec/Task detail surface: A/B test resolved → pinned section

**Context:** Two detail-surface UXs were built side by side to compare: spec detail opened as a **centered modal** (`specDetailModal.js`), task detail opened as a **pinned section tab** in the top bar (`taskSection.js`). Both reachable from the lane rail on the Home board.

**Decision (user):** The **pinned section** wins. Specs now behave exactly like tasks — clicking a spec on Home opens it as a top-bar section tab (full content view with the lifecycle stepper, next-action bar, spec/plan/tasks/outcome tabs, and interactive task rows), reachable from any view via its chip.

**Applied:**
- New `specSection.js` (mirrors `taskSection.js`); the centered `specDetailModal.js` is **deleted**.
- The host's pinned-section slot in `multiTerminalUI.js` was generalized: a single `activeSection` (task **or** spec), `showSection(module)` / `closeSection()`. Section modules share one interface: `setHost, open, close, reset, getChip, render, viewClass`.
- The top-bar chip (`terminalTabBar.js`) renders a task or spec by `chip.type` (spec → FileText icon).

**Follow-up (same day) — multi-tab:** the first cut pinned only one section at a time (opening another replaced it). User corrected: the whole point of tabs is to keep several open and switch freely. Refactored so **multiple sections stay open as side-by-side chips**:
- `taskSection.js` / `specSection.js` became **instance factories** — each `open()` builds an independent tab (own state + IPC subscription + `dispose()`); opening an already-open item just focuses its tab.
- The host (`multiTerminalUI.js`) owns the collection: `sections[]` + `activeSectionKey` + `isSectionVisible`, with `openSection` / `activateSection` / `closeSection(key)` / `hideSections` / `notifySectionChanged` / `_disposeAllSections` (project switch disposes all).
- Only the active tab renders into the content area; closing the active tab drops back to the board/detail surface beneath while other chips stay. Clicking a chip focuses it.

**Rationale:** Slack-channels move — the unit concept carries the brand (app Frame → units Frames → home Mainframe). Known tradeoff: "Frame" overload with the app name and `.frame/` dir; docs should write "a frame" (unit, lowercase) vs "Frame" (the app).

---

### [2026-06-11] Tasks/Specs side panels retired → entry points open dashboards

**Context:** With the Home board's lane rail already showing specs + tasks at a glance, and detail now opening as section tabs, the old right-side **Tasks** and **Specs** panels are redundant.

**Decision (user):** The panels' entry points now open the **full dashboards** directly instead of the side panels:
- Top-bar **Tasks** icon (`btn-tasks-toggle`) → `tasksDashboard.toggle()`.
- **⋯ More menu → Specs** → `specsDashboard.toggle()`.
- Command palette / shortcuts consolidated: the side-panel commands (`panel.toggleTasks` Cmd+T, `panel.toggleSpecs` Cmd+Shift+S) were removed; the dashboards keep **Cmd+Shift+D** (tasks) and now **Cmd+Shift+S** (specs).

**Kept (background roles only):** `specPanel.js` still watches `.frame/specs/` (feeds the lane rail) and `tasksPanel.js` still loads task data — both are just no longer surfaced as a side panel. Not deleted to avoid disturbing the spec-watch / task-load data flow.

---

### [2026-06-11] Sidebar restructure: Projects becomes the root, not a tab

**Context:** The sidebar presented `Projects | Files | Changes` as three sibling tabs, but they live at different altitudes — Projects answers "which context am I in" (heavy side effects: switching projects switches terminal sessions), while Files/Changes are views *inside* that context. Project-opening UI was also cramped (three stacked buttons + an awkward inline clone-URL row), and a duplicate `+` (`btn-add-project`) re-triggered the same folder picker.

**Decisions (user, via brainstorm):**
1. **Projects becomes a collapsible section pinned to the top** of the sidebar (variant C of the brainstorm): collapsed = active project name + `+` button; expanded = workspace project list (reuses `projectListUI`). Session-scoped collapse state.
2. The **`+` opens a single Open Project modal** hosting Select Folder / Create New / Clone GitHub — a pure UI shell over the existing IPC flows (no new channels, `dialogs.js` untouched). The inline clone row dies.
3. **Files | Changes remain as two tabs** below the section (no accordion stacking).
4. **"Initialize as Frame"** stays a visible clickable flow under the project header for non-Frame projects (spotlight/tooltip preserved).
5. **AI tool row (Start button + selector) stays under the section for now** — its removal is explicitly deferred to a future spec (later resolved: the Frame Starter spec).

**Also recorded:** code review found "Create New Project" is effectively a relabeled folder picker (`createDirectory` flag + different labels, no scaffolding); real scaffolding is out of scope but the modal should leave room for it.

**Artifact:** spec at `.frame/specs/sidebar-project-section/spec.md` (phase: specified).

---

### [2026-06-11] Frame creation UX: "create-then-decide" Starter overlay (direction chosen)

**Context:** 4 entry points create a new Frame (board card, top-bar `+`, grid empty cell, empty-state CTA) with 3 inconsistent behaviors — the board card's left-click opened a shell picker while right-click created silently (inverted: the common case paid the question). Agent start lived in a disconnected sidebar "Start <agent>" button using a fragile 1s setTimeout to type the command. User wanted: let the user choose Terminal vs Agent, but never require 2 clicks for a plain terminal.

**Decision (user picked option C of A–D):** **create-then-decide.** Every `+` instantly creates a Frame with the default shell (1 click, zero questions). Inside the freshly opened Frame, a lightweight dismissible **Starter overlay** floats over the live terminal: big "▶ Claude Code / ▶ Codex" buttons (last-used first), a small `zsh ▾` shell switcher in the corner (demoting the shell question permanently), and a "just start typing" hint. Dismissal rules: first keystroke (not swallowed — goes to the shell), Esc, or any programmatic sendCommand. Shown only for freshly created lanes, never on re-entry.

**Key insight that shaped it:** "Agent" is not a data-model concept in Frame — an agent lane is just a terminal + a start command, and the agent chip is already derived live from the foreground process. So Terminal-vs-Agent is a first-moment UX question only, which can be deferred *into* the lane instead of blocking the `+`.

**Sequencing:** before building the Starter, the prompt-injection flows had to be adapted to lanes (user caught this) → the `agent-dispatch` spec became the prerequisite. The Starter overlay spec comes after it and will retire the sidebar Start button. Out to v2: a prompt input inside the overlay ("type the task, start Claude with it").

---

### [2026-06-11] Agent Dispatch: lane-aware task & spec runs (spec opened)

**Context:** Task ▶ run and spec commands inject prompts into terminals with pre-lane-orchestrator assumptions: task "current terminal" wrote into the active terminal without verifying an agent runs there; task "new terminal" stacked blind timeouts (1s + 4s) hoping the CLI booted; spec runs sent to whatever terminal was active, creating a bare shell if none. From the board, "current terminal" is meaningless — and `laneStatus` detection now exists, making timeout-guessing obsolete.

**Decisions (user):**
1. **Single Agent Dispatch layer** (renderer module): the only door for "deliver this prompt to an agent in a lane". Existing-lane targets verify the agent (restart it if exited); new-lane targets create + start + **wait for the agent-ready signal** (laneStatus settles into `waiting`) instead of fixed sleeps. On readiness timeout: visible error, prompt never lands in a bare shell. Text-then-Enter trick and `.frame/runtime/prompts/` staging are wrapped, not reinvented.
2. **Task run always opens a new Frame** — the modal's current/new terminal choice is removed; CLI choice and all branch options stay byte-for-byte unchanged.
3. **Spec → lane assignment:** first run creates + assigns a Frame silently; while an assigned Frame exists, every spec run **asks**: "Continue in <Frame>" (default, same agent session) vs "Open a new Frame" (re-assigns). Session-scoped, renderer state.
4. **Lane cards/switcher show the assigned spec/task label** (one label per lane, most recent dispatch wins; clears on lane close, never touches the task/spec itself).

**Spec ordering decided:** 1) `agent-dispatch` → 2) frame-starter (consumes dispatch, retires sidebar Start button) → 3) `sidebar-project-section` (independent, can go in parallel).

**Artifact:** spec at `.frame/specs/agent-dispatch/spec.md` (phase: specified).

---

### [2026-06-13] Sidebar overhaul: activity rail + Agent view (post-spec evolution)

**Context:** The `sidebar-project-section` spec shipped projects as a pinned section above [Files | Changes] tabs. In this session it evolved well beyond the spec, driven by PO feedback and live iteration. Captured here because it spans many files and several deliberate decisions.

**What changed:**
- **Activity icon rail** (PO insisted Projects be its own destination): replaced the top [Files | Changes] tabs with a VS Code–style vertical icon rail **[Projects · Files · Changes · Agent]**. Icons-only + tooltips; default landing = Projects. Changes uses a **file-diff** icon (the git-branch icon is reserved for a future working-tree view).
- **Projects view:** the full workspace list (no 3-row cap) + a prominent accent **"Add new Project"** CTA that sits where the list ends (not pinned) and opens the Open Project modal. **First project auto-opens on launch** (one-shot; skipped if a project is already active). Project rows given more vertical breathing room.
- **Current-project dropdown** at the top of Files / Changes / Agent: shows the active project and lets you **switch project in place** (reuses `projectListUI.selectProject`), plus an "+ Open a project…" entry. Hidden on Projects (its list already highlights the active row).
- **Agent view (new, agent-oriented):** moved the default-agent selector + **Start** out of a bottom footer into a dedicated tab (selector + full-width Start stacked for breathing room). Start = context-aware `agentDispatch.startDefaultAgent()`: on the Frames screen → focused Frame if idle, else ask **Open a new Frame / Kill & restart here**; anywhere else → new Frame. **Running Agents** = live list across **all projects**, grouped under a per-project heading (with the box icon), each row click focuses that Frame (switching project first when needed). Hover "i" explains the cross-project scope.
- **Top bar cleanup:** removed the `+` (new frame) and Tasks buttons; **Tasks moved into the "…" more menu**. New-frame now lives as an **"Add new Frame"** button in the Frames detail rail (alongside the Home board's `+` card and Cmd+Shift+T).
- **Home board empty state:** "No project added yet" + **"Add New Project"** → opens the Open Project modal (same flow as the sidebar), replacing the old direct folder picker.
- **Project status badges:** Bot agent icon + filled colour pills + a custom hover tooltip (replaced the faint native `title`).
- **Dark-mode readability + colour unification:** section headings → `--text-secondary` / 700 (matching the Home/Frames right-panel `.lane-rail-section-title`); sidebar rail, top-bar action icons and the right-panel strip icons all unified to **secondary at rest → primary on hover**.

**Decisions worth keeping:**
- Rail stays **icons-only** — hover-expand and an icon+text mode were both considered and rejected as overengineering (tooltips already label; one good default beats user prefs).
- The Agent view is agent-oriented, but **Running Agents stays cross-project** regardless of the current-project dropdown selection (the dropdown only scopes Start / Files / Changes).
- New-frame creation uses the **default shell** everywhere now; the old `+`'s shell-picker menu was retired with the button.

**New/changed modules:** `agentPanel.js` (running-agents list); `agentDispatch.startDefaultAgent()`; `multiTerminalUI.isViewingFrame()` + `onNewLane` detail-rail callback; `projectListUI.getProjects()` + first-launch auto-select.

---

### [2026-06-15] Conductor Orchestration — parallel spec execution in isolated worktrees

Built the orchestration feature (`.frame/specs/agent-orchestration/`). The unit
of parallelism is the **spec** (a spec's own tasks are interdependent → run
sequentially in one lane; different specs run in parallel). A **conductor**
agent (a Claude lane running `CONDUCTOR.md`) is given ready specs, checks
inter-spec footprint conflicts, and dispatches each to a **worker** agent that
runs in its own git worktree (`.frame/worktrees/<slug>`, branch
`frame/<slug>/work`).

**Key design decisions (the journey):**
- Pivoted from task-level to **spec-level parallelism** — task-level forced
  sequential work to run in parallel and created intra-spec merge hell.
- Frame **never decides**: the conductor (AI) + the user decide; Frame is the
  cockpit + transport + isolation layer. Reconciles with the "don't auto-drive"
  philosophy.
- **Safety in code, not the prompt:** `orchestrationManager` refuses to create a
  worktree for a spec whose footprint overlaps an in-flight one — the conflict
  guard doesn't depend on the conductor reasoning correctly.
- **Footprint** declared in each `plan.md` (`## Footprint`), parsed by
  `specManager.getSpecFootprint`. Meta files (tasks.json/STRUCTURE.json/
  PROJECT_NOTES.md/AGENTS.md) excluded — else every spec collides on them.
- **Command bus** (`.frame/bin/{dispatch,report-done,merge,status}.js` +
  `FRAME_ORCH_BUS`/`FRAME_ORCH_BIN` env injected into lanes) lets the conductor
  (a shell-bound AI) drive Frame from any worktree.
- **Merge** is local: fast-forward `frame/<slug>/work` → `frame/<slug>/integration`
  after a real-diff **drift check** vs the declared footprint. `main` is never
  touched; PR/promotion stays a manual user step.
- Built on the existing **lane/dispatch** foundation (PRs #86/#87): reuses
  `laneStatus`, `agentDispatch` (added an `enter:false` option for parallel
  fan-out), lane cards, lane detail. The orchestrator screen is a full-screen
  overlay (specsDashboard pattern), opened from a Home "Start Orchestrator" card
  or Cmd+Shift+O.

**New modules:** `main/orchestrationManager.js`, `renderer/orchestrator.js`,
`templates/orchestration/{CONDUCTOR,WORKER}.md`, `styles/components/orchestrator.css`,
`.frame/bin/*` orchestration scripts. Backend verified end-to-end headless
(dispatch → worktree → conflict guard → report-done → merge+drift → teardown →
rehydrate). Renderer compiles; live UI verification pending an app run.

---

### [2026-07-02] Vision sharpened — structural context as the compounding asset (+ Q3 deep-dive audit)

**Context:** A full Q3 deep-dive review of the whole project was run — security,
engineering/maintainability, team-collaboration, testing/CI/release, product/process,
plus 9 forward-looking angles — and recorded as two synthesis reports
(`.frame/FINDINGS-2026-07-02.md`, `.frame/FINDINGS-ENGINEERING-2026-07-02.md`) and
9 `audit-q3-*` specs under `.frame/specs/`. Out of the competitive/strategic
discussion, the founder crystallized the product vision.

**The vision (founder's words, kept as discussed — not summarized):**

> "Benim önceliğim spec-driven development'ı server üzerinden çalıştırarak takım
> çalışmasına uygun hale getirmek. Spec-driven'la ürettiğimiz md dosyaları bize
> gelecek için, agentlar için structural bir context oluşturma imkânı veriyor.
> Yapısal olarak context'i bu şekilde oluşturduğumda, 6 ay sonra agent kodu tarayarak
> anlamaya çalışmayacak — ne yapıldığını, neden yapıldığını ve sonucunda ne çıktığını
> bilerek gelecek. Sadece koda bakarak da anlamlı sonuçlar çıkabilir ama biraz
> varsayıma dayanmak zorunda. Biz bu noktada Jira'yla uğraşamayız; her şey bu kadar
> hızlıyken Jira gibi eski paradigma için üretilmiş, sektörde de doğru kullanılmayan
> bir aracı entegre etmek istemiyoruz. Ya da spec-driven dev için ayrı bir araç üretip
> Claude ile konuşturmak istemiyoruz. İstiyoruz ki bunların hepsini tek bir yerden
> yapabilelim — işte bu da Frame oluyor. Claude tek başına çok güçlü, zaten ben de her
> şeyi Claude Code üzerine inşa ediyorum. Claude olmadan Frame anlamsız. Şu anki hâli
> yetersiz ama bu olasılıklara imkân sağlıyor. Frame'i çok kullanıyoruz; agentlarla
> geliştirme yaptıkça cevapları süreç içinde buluyoruz."

**What this means for the project (decisions/framing captured):**

1. **Context-as-compounding-asset is the core value** — not the orchestration
   mechanics (those are being commoditized by the platform vendors themselves; see
   `audit-q3-competitive-positioning`, incl. Claude Code's own Agent Teams). The moat
   is the durable, structural context the spec → plan → tasks → outcome corpus builds
   up over time.
2. **One place, not tool-sprawl** — no Jira, no separate spec tool bolted onto
   Claude. Everything lives in Frame.
3. **Claude-native depth** — built on Claude Code; "without Claude, Frame is
   meaningless." Depth-on-Claude over vendor-neutral breadth as the headline;
   portability/neutrality is kept as a *hedge that protects the context corpus's
   value*, not the lead wedge.
4. **Not a finished product** — Frame is used heavily to build Frame; the roadmap is
   discovered through dogfooding. Current state is admittedly insufficient but it's
   what *enables* these possibilities.
5. **Reconciled files-vs-DB** — files stay canonical (git-versioned, tool-agnostic,
   readable without Frame); a **DB is a server-side retrieval/index layer** over the
   md corpus for team scale, *not* a replacement for the files. The README's "Files
   over databases — markdown is canonical" principle stands; the index layer makes
   the corpus *usable as agent context at scale*.
6. **Priority = spec-driven-over-server for teams** — a smaller, lower-risk first
   slice than running agents server-side (which raises multi-tenant security/cost
   stakes). It also naturally addresses the team merge-conflict problems the audit
   found (shared-file conflicts, no cross-machine presence, single-machine conflict
   guard).
7. **Corollary:** because the moat = the context corpus, its *quality / freshness /
   proven-efficacy* is now the strategic center, not a hygiene chore — see
   `audit-q3-core-value-efficacy`. Today the context is stale in places (the
   intentIndex still points at a deleted file) and its benefit is unmeasured; fixing
   that is strategic, not cosmetic.

This note supersedes the "the center is the terminal" framing in the Jan-2026 Project
Vision section at the top of this file: terminal-first is now the *surface*,
structural context production is the *center*.

---

### [2026-07-12] audit-q3-generic-any-project shipped — Frame is no longer hardcoded to its own shape

**Context:** The Q3 audit's "self-hosting blind spot" spec (T01–T12) was implemented
in full on `feat/audit-q3-generic-any-project`, task-by-task from the session (no
conductor). The founder's worry — agents kept baking the Frame repo's shape
(src/ + JS + CommonJS + Electron + macOS + Claude) into the product — is now
addressed by making that shape a *detected input*:

- **Detection is the single source of truth.** `scripts/detect-project.js`
  (dependency-free module + CLI, shipped to user `.frame/bin/`) reads manifests and
  persists `{languages, packageManager, sourceRoots, layout, commands, confidence}`
  as the `project` block in `.frame/config.json`. Everything reads it: the parser
  (multi-root walker, ignores, symlink/depth caps), the templates (QUICKSTART with
  real commands — `todos.json` bug fixed; AGENTS.md "Project Facts" +
  never-assume-generalization rule; generic STRUCTURE shape), init and onboarding.
- **Frame's own vocabulary is out of the product.** `syncIPCChannels` is driven by
  `project.ipcChannelsFile` (Frame's repo sets it; other projects no-op) with
  token-derived categories; intentIndex auto-grouping is basename tokenization, not
  the Manager/Panel suffix list. Sentinel tests assert no Frame vocabulary in any
  shipped script or fixture output.
- **Environment parity, fail-loud.** Usage falls back to `~/.claude/.credentials.json`
  (Linux/Windows work); sessions use Claude Code's real path encoding (dots!);
  plugins preflight git/network and surface classified reasons in the panel; first
  run defaults to an *installed* CLI; shell fallbacks are platform-aware.
- **The dogfooding loop is open.** Six fixtures (golden js-src-app byte-compat guard,
  Django, Go, Rust workspace, pnpm monorepo, docs) run the real detect→parse→template
  pipeline in tests; first-ever CI (`.github/workflows/ci.yml`, ubuntu+macos, no
  `npm ci` — suite verified green without node_modules) gates every push.

**Decisions of record:** parser stays dependency-free regex (tree-sitter remains
`codebase-graph-onboarding`'s engine, swappable behind the extractor interface);
`structure-non-standard-layouts` is superseded by this spec's T03; backwards compat
held throughout — Frame's own repo detects to exactly its historical behavior, and
the golden fixture pins the CJS output byte-for-byte. End-to-end verified inside
Electron main on a scratch Django repo: populated STRUCTURE.json (the old
`skipped-no-src` would have left it empty forever), poetry QUICKSTART, Project Facts.

### [2026-07-19] Product analytics shipped: event registry + fail-closed opt-out (audit-q3-product-analytics)

Implemented the full `audit-q3-product-analytics` spec (spec → deep plan → 9 tasks → done)
in one session. Frame's telemetry went from a single `app_started` event to a
10-event set answering the founder's roadmap questions (feature usage, activation,
in-the-wild errors) — without weakening the privacy stance.

**Decisions of record (from the plan gate, user-confirmed):**

- **Activation = unique users per plain event** (`project_initialized`, `spec_created`,
  `agent_run_started`) on Aptabase — no `first_*` milestone events, no local
  "first done" flags. Revisit only if unique-user counts prove too coarse.
- **Fail-closed opt-out:** when `user-settings.json` is unreadable AND its `.bak`
  can't recover it, telemetry is off for the whole session — silently, no
  re-consent banner. ENOENT (fresh install) keeps default-on. This closed the
  re-opt-in bug (`cache = data || {}` + `value !== false` used to silently
  re-enable telemetry for opted-out users on corruption). A successful
  `userSettings.set()` clears the degraded state.
- **Runtime allowlist over convention:** every event + prop + value is declared in
  `src/main/telemetryEvents.js` (pure module, no Electron imports — testable under
  `node --test`). `track()` drops anything unregistered; a unit test asserts the
  registry is enum-only. A future contributor mechanically cannot ship a
  content-bearing property.
- **Renderer events go through `TELEMETRY_TRACK` IPC**, validated in main against
  the same registry — the renderer cannot bypass the allowlist.
- **Stayed on Aptabase** (constraint preferred extending it; PostHog's
  funnels/identity are out of scope for our no-user-tracking stance).
- **Cardinality guards:** user-defined custom tool ids all normalize to `custom`
  (`claude-code` → `claude`); `plugin_toggled` carries only `enabled|disabled`,
  never the plugin id; `error_occurred` is a fixed 9-category enum — counts only,
  never messages/stacks/paths.

**Implementation notes:** `userSettings` fires `settings_corrupt_recovered` via a
deferred lazy require (telemetry requires userSettings — circular otherwise).
`agent_run_started` fires only when a CLI actually launches and reaches
agent-ready, not when a prompt is injected into a running agent;
`orchestration_run_started` fires only on new sessions, not reattach.
PRIVACY.md now lists the full event table and the fail-closed guarantee — rule
going forward: any registry addition lands in PRIVACY.md in the same change.
Per-task story in `.frame/specs/audit-q3-product-analytics/outcome.md`.

### [2026-07-19] UX & error-feedback hardening implemented (audit-q3-ux-error-feedback)

Spec implemented end-to-end in one session (plan → tasks → T01-T10), replacing
the renderer's silent-failure pattern with one feedback discipline:

- **`src/renderer/notify.js`** is now the single toast (`notify.error/success/info`).
  Behavior is the old tasksPanel baseline (body-mounted, single toast, 4000 ms
  error / 2000 ms otherwise); message set via `textContent`, closing the
  unescaped-innerHTML hole. Old copies in tasksPanel/githubPanel/pluginsPanel/
  agentDispatch **and a 5th undocumented copy in orchestrator.js** are gone;
  CSS unified to one `.app-toast` block in panels.css.
- **`src/renderer/htmlUtils.js`** is the single `escapeHtml`. The audit counted
  15 copies; implementation found and removed **21** (extras: sampleBanner,
  terminalGrid, laneBoard, terminalTabBar, agentDispatch, orchestrator `_esc`).
  Rule going forward: never add a local escapeHtml/showToast — require these.
- **Error-surfacing standard:** all four Frame-create call-sites now try/catch
  + falsy-check → `notify.error` with distinct cap-vs-backend messages
  (`createTerminal` returns null at the cap but *rejects* on backend failure —
  that rejection used to be silently unhandled). `TASK_UPDATED` with
  `success:false` now toasts instead of an empty branch.
- **Confirm modals:** initial focus is Cancel; Enter activates the focused
  button, anything else falls back to cancel. Destructive/run paths require an
  explicit activation.
- **Boot:** appLoader's 10 s failsafe now swaps the splash to a "Couldn't load
  your workspace" state with Retry (re-sends LOAD_WORKSPACE, re-arms failsafe)
  instead of silently hiding into a blank app.
- **Parked buttons removed** from index.html; `ai.startSession` no longer
  clicks a hidden disabled button (was a no-op) — extracted `startAiSession()`
  in index.js, called by the palette command. `#init-frame-tooltip` markup is
  now orphaned (harmless, guarded) — candidate for later cleanup.
- **Naming rule documented** in laneBoard.js header: code/DOM ids say "lane",
  UI says "Frame"/"Home" (reaffirms the 2026-06-11 decision — no rename).

Verified: esbuild bundle builds, `npm test` 82/82 green, sweep shows zero
leftover local toast/escape definitions. Net diff −157 lines.

### [2026-07-19] Performance & resource refactor (audit-q3-performance-resources)

Implemented T01–T09 of the audit spec; T10's runtime half pends a dev launch
(static acceptance record in the spec's measurements.md). Gate decisions
(user-resolved): reload destroys-and-recreates PTYs (no re-attach protocol);
incremental IPC = parse-once + skip-unchanged at the source, channels and
payload shapes untouched; profiling = lightweight in-app perfMonitor, not a
tracing harness. Key mechanics:

- **perfMonitor** (new): event-loop-lag sampler (50ms budget), op timers,
  startup marks; dev-gated (`NODE_ENV=development` / `FRAME_PERF=1`).
- **Async hot paths:** the 30s `spawnSync` bootstrap scan → async spawn;
  plugins clone/pull, Keychain read, fileTree walk → `fs.promises`/`execFile`.
  Cheap existence stats deliberately stayed sync.
- **Parse-once:** tasksManager `loadTasks` mtime+size cache (a spec push now
  costs 1 tasks.json parse, was ~29); `writeStatus` write-if-changed; both
  specManager watcher feedback loops broken with self-write guards
  (`tasksManager.getLastSelfWriteAt()` exported for the cross-module guard);
  SPEC_DATA sends gated on payload equality.
- **PTY flow control:** 16ms coalescing + 1MB pause/resume backpressure in
  ptyManager and legacy pty.js; laneStatus quiet detection is timestamp-based
  (one timer per 1800ms window, not per chunk).
- **pollGate** (new): every main-process poll (usage 5min, update 6h, orch 5s,
  per-PTY 2.5s) is visibility-gated; hidden window = zero poll timers; usage
  fetch behind a 5min TTL cache. Update recheck opts out of refresh-on-show.
- **Reload:** `did-start-navigation` destroys PTYs immediately (complements
  the existing RECONCILE_TERMINALS sweep); renderer init-once guards added.
- **Bounds:** prompt logs 5MB + one `.log.1` rotation via async queue
  (replaces the interim 1MB truncate-half; logger.test.js updated); terminal
  sessions pruned to 20 MRU and `clearProjectSession` finally wired to
  project removal; D3 vendored (`d3@7.9.0`, CDN tag removed) with the force
  sim on a rAF loop (300-tick budget, alphaMin 0.005, 1500-node cap).

Verified: 82/82 tests green; grep-verified zero hot-path exec/spawnSync and
zero ungated setIntervals in src/main.

### [2026-07-21] Implement modes (implement-modes spec, T01–T12)

`/spec.implement` is no longer one fixed loop. It now asks — at **every**
dispatch, before touching anything — which of three modes to run: step by
step, autonomous + report, or a flow the user describes (plus their saved flow
as a fourth entry once one exists). A saved default doesn't silence the
question, it moves to the top marked `(default)`; that was a deliberate
reversal during planning, because always-asking is what makes switching modes
mid-spec free — run the first tasks by hand, hand the rest over once trust is
earned.

The spec said this would live purely in the prompt template. Two decisions
crossed that line, both at dispatch rather than in the UI, and both because
the autonomous mode is a launch-time concern:

- **Permissions.** Frame writes `.frame/implement-permissions.json` and
  dispatches with `--settings <file> --permission-mode auto`. The denylist
  carries the safety: deny is evaluated first and can't be overridden at a
  lower scope, so "never push" stopped being a request in prose and became
  mechanically impossible. Nothing is ever written to `.claude/`.
- **Runtime.** `FRAME_NODE` now carries Frame's own executable into every
  PTY's environment, so a dispatched command runs Node through
  `ELECTRON_RUN_AS_NODE=1 "$FRAME_NODE"` instead of depending on the user's
  `PATH`. Verified: Frame's bundled runtime is Node 18.18.2.

Two plan claims turned out wrong when checked against the CLI docs at
implementation time, and both are recorded in the plan as corrections rather
than quietly patched: `--settings` sits at the *top* of the precedence chain
rather than merging into the user's settings (the deny-wins half survives,
which is what the safety argument rested on), and a `Write()` permission rule
parses and is then never consulted — file checks only match `Edit()` and
`Read()`.

`--permission-mode auto` needs an eligible account, org enablement and a
recent enough model, and the CLI documents no way to probe any of that. So the
flags are best-effort: a flagged launch that never comes up is relaunched once
bare, and the run *states* the limit — a toast plus a note telling the agent
to say so in one line and continue step by step. It doesn't ask.

The implementation report is generated, never written: the agent only appends
to `report-data.json`, and `build-implement-report.mjs` pulls each commit's
real diff from git by hash. That split is the point — a transcribed diff is
the one place a hallucination would silently corrupt the artifact. Its pure
`report-data.json → HTML` half is the tested part (21 cases, mutation-checked);
the git and filesystem half isn't, per the plan's test posture. Styling is
Frame's own design system, variable names included, so drift shows up as a
one-line diff.


### [2026-07-21] Spec phase no longer auto-advances mid-agent-turn

Bug report (with screenshot): after `/spec.plan` writes `plan.md`, the Spec
page jumped to the Tasks stage and sat in the locked "Break into Tasks —
Working in Frame 1" bar, even though the plan turn was still running (the
template's Stage 5 report and status.json update come *after* the plan.md
write). Root cause: `derivePhase` in `specManager.js` advances the phase
purely from file existence, and the recursive specs watcher fires the moment
`plan.md` lands mid-turn — the "defense in depth" fallback for agents that
forget status.json was firing during the turn it was meant to backstop.

Fix shape (chosen over sniffing agent state in main): the renderer already
derives per-spec lane busyness (`agentDispatch.getSpecLaneInfo`, anti-stuck,
never cached), so `_notifySpecLane` now feeds it to main over a new
`SPEC_AGENT_ACTIVITY` IPC channel. `specManager` keeps a `busySpecSlugs` set;
while a slug is busy, `derivePhase` holds the recorded phase instead of the
file-derived one (the task-status-driven implementing/done branch stays live —
that state is accurate mid-turn). On the busy→idle flip main runs
`pushSpecData`, so the fallback still catches an agent that wrote artifacts
but never touched status.json — it's deferred, not removed. The set is
cleared in `startWatching`/`stopWatching` so a renderer reload can't leave a
stale busy flag freezing phases; a mid-turn app reload degrades to the old
behavior, accepted.

### [2026-07-21] Implement report surfaced in the spec UI + announced up front

While testing autonomous implementation (Mode B) against another project's
spec, the user hit a discoverability gap: the run produced
`implement-report.html` in the spec folder, but nothing in Frame's UI pointed
at it — the only report affordance was the plan tab's "View Plan Report"
button, and the user had no way to even know a live report existed.

Two-part fix, mirroring the existing plan-report pattern:

1. **UI button** — `getSpec` now exposes `implementReportPath` (exists-check
   on `implement-report.html`, same as `planReportPath`), and all three spec
   renderers (`specPanel.js`, `specSection.js`, `specsDashboard.js`) show a
   "View Implementation Report" button above the Tasks tab body when the file
   exists. It opens in the system browser via `shell.openPath`, reusing the
   `spec-plan-report-row` styles. No watcher work was needed: the recursive
   specs watcher already pushes SPEC_DATA when the report lands, so the
   button appears mid-run on its own, and since Mode B regenerates the HTML
   after every task, refreshing the opened page follows the run live.

2. **Announcement in the template** — `spec.implement.md` now tells the agent
   to (a) mention in the mode picker that Mode B's report is reachable from
   the spec's Tasks tab in Frame, and (b) before the first task, state once —
   as a statement, not a question — where the button is and that the report
   updates per task. Phrased to not reopen the "no questions mid-run" rule.

Placement decision: the button lives on the **Tasks** tab (not spec/plan),
since the implement report is per-task output and that tab is where progress
is already watched.

### [2026-07-22] Implement modes v2 — mid-session permission grant rejected, mode selection moves before the session

While reviewing `feat/autonomous-permission-lifecycle` (the mid-session
autonomous grant: Frame rules merged into `.claude/settings.local.json` with
a manifest, refcounted holders, idle-strip and open-sweep), the user rejected
the approach outright: it writes Frame's ephemeral state into a user-owned,
repo-scoped file, and permission prompts still appear anyway (Edit/Read are
deliberately left to a mode only the user can switch). Verdict: the branch is
dead and will not be merged; the elaborateness of the cleanup machinery was
read as evidence the state lives in the wrong place.

The replacement design, converged over the conversation and specced as
`implement-modes-v2`:

- **Three-mode ladder**: step-by-step (v1 Mode A unchanged — task → what/why
  report → one question → commit on approval), **guided** (new: Mode B's
  loop without flags, the CLI's own permission prompts pace the run, no
  check-in between tasks, same HTML report), and autonomous (launch-path
  only — never offered or upgraded-to mid-session).
- **UI**: the implement button opens one unified modal (mode + continue-in-
  lane/new-Frame destination, absorbing `_askContinueOrNew`). Autonomous
  allows "Continue" only into a lane that was itself launched flagged
  (`launchedAutonomousBySlug`). Ordering flips to modal → record
  `implement_mode` → stage → dispatch, so flags are derived from the actual
  choice, not the hint's guess — the re-dispatch flow becomes unreachable.
- **Button state machine**: label follows the mode ("Implement Next Task" is
  correct only for step-by-step); guided/autonomous lock the button for
  run-liveness (lane alive ∧ tasks remain), not turn-liveness, with progress
  shown — the turn-scoped lock would unlock mid-run and invite double
  dispatch.
- **CLI**: conversational `spec.implement` offers step/guided as runnable;
  an autonomous answer is record-then-handoff — write the mode to
  status.json first, then point at the Frame button or at
  `node .frame/bin/implement-launch.js <slug>`, a new single-source helper
  that writes the permission file, stages the prompt from the staged
  templates (works with Frame closed), and execs the CLI with the flags plus
  the initial prompt as launch argument. Agents never hand-compose the line.
- **Deliberately deferred (V2 polish, design kept here):** a watcher-based
  CLI→UI bridge — agent writes a nonce'd request file under the spec dir
  (the recursive specs watcher provably fires on agent writes), Frame opens
  the modal, answers via a response file while the agent polls with a
  timeout, falling back to the terminal ask. Two queueing insights worth
  keeping: only queue a *question* while its asker is provably alive
  (heartbeat-refreshed request file, stale ones swept silently — no ghost
  modals), but a *decision* queues indefinitely (recorded
  `implement_mode: autonomous` + ready phase can prompt "start it?" on the
  next project open — no lost intent).

Also noted: `cli-spec-command-parity`'s "autonomous handoff wording" open
question resolves to the helper command; its "re-dispatch is the ceiling"
constraint is retired by this spec.

### [2026-07-22] T09 — implementation report made live-followable from the terminal

Added `implement-modes-v2:T09` as a follow-up. The [2026-07-21] fix surfaced
the report through a Frame **UI button**, but the v2 launch helper
(`implement-launch.js`) starts a run from a bare terminal with no Frame app to
click — so a terminal-launched autonomous run generates the report but the user
has no obvious way to reach it. T09 closes that gap in the artifact itself,
three parts:

1. **Auto-open** — `build-implement-report.mjs` gains an `--open` flag that
   opens the written HTML cross-platform, best-effort in `main()`, never
   failing the build (same posture as the missing-runtime rule). Open-once is
   kept in the prompt, not the code: `spec.implement.md` passes `--open` only on
   the first generation, so no new browser tab per task.
2. **Progress banner** — `main()` reads `tasks.json` (canonical state, not
   agent-transcribed — consistent with "diffs read from git, never transcribed")
   and passes a pure `{ total, completed, current }` into `renderReport`. Banner
   reads "In progress — N/M done · next: T0x <title>" while tasks remain,
   "Complete — M/M" when done. `renderReport` stays pure/clock-free; all fs work
   lives in `main()`.
3. **Reload note** — folded into the banner (only shown while in progress), not
   a standalone line: telling a finished report to "reload" is stale advice.

Decision: **manual reload, not `<meta http-equiv="refresh">` auto-refresh.**
Auto-refresh would deliver "always current" without a keypress, but it resets
scroll and collapses any open `<details>` diff mid-read, and a stray refresh
tag surviving into the final report is worse than a note. Manual note chosen.

### [2026-07-22] Spec Knowledge Layer shipped — specs became delivered memory (spec-knowledge-layer)

Implemented the full spec (T01–T12) in one session on `feat/spec-knowledge-layer`,
from the 2026-07-20 design conversation: the founder's vision that an agent
taking on work should scan the spec archive twice — by topic (understand the
context) and by file (what was done here, why, how, with what result) — and
that this must *always* work, not depend on AGENTS.md being read.

**Architecture of record:** source artifacts untouched → per-spec `digest.md`
(written in the last implement turn — there is no spec.done command, `done` is
derived) → derived gitignored `.frame/index/spec-index.json` (topics + files
views; Footprint = intent, outcome `Files touched:` = actuals, front-matter =
declared relationships; git only enriches: rename chains, post-close stale
flags) → `spec-context.js` queries → delivery via two deterministic channels:
Claude Code hooks (`spec-hint.js`: PreToolUse Edit/Write + UserPromptSubmit,
session-deduped, budget-with-overflow-to-pointer, never-block/never-break,
~20ms measured) and Frame-composed prompts (spec.new full-catalog relatedness
step + `keywords/related/supersedes` front-matter; spec.plan footprint-history
evidence step; worker prompt preload; digest step in spec.implement/WORKER).

**Decisions of record (gate):** full-content injection default
(`FRAME_SPEC_HINT_MODE=signal` kept for comparison); UI file-history panel →
follow-on spec; hygiene+backfill in-spec (test-orch purged, deep-spec-plan
corrected to done, `superseded_by` marker born); index gitignored + lazy
`ensureFresh` (STRUCTURE.json tracked-generated-file conflict trap explicitly
avoided); hooks registered in tracked `.claude/settings.json` (whole team +
worktrees, merge-safe init install for user projects, gated `ai_tool: claude`).

**The layer caught its first real miss while being built:** editing
`src/templates/CLAUDE.md` for the T11 advisory, the injected STALE record for
core-value-efficacy T08 forced verification → the live AGENTS template is
`getAgentsTemplate()` in `frameTemplates.js`; the md file has zero code refs
(dead copy, deletion candidate). Backfilled 12 digests for done specs.
Eval: `run-eval.js --hooks` ready; the injected-vs-not comparison is a
budgeted run, not yet executed. Follow-ups: UI panel spec, dead-template
cleanup, frameTemplates.js merge-order care vs in-flight cross-platform.

### [2026-07-23] Spec-flow delivery gap: legacy AGENTS.md sections never migrated
A Frame-managed project's interactive agent, asked in natural language to plan
a spec, never entered the deep spec.plan flow. Diagnosis from that session plus
this repo: the self-serve protocol (SPEC_DRIVEN_SECTION v1, cli-spec-command-parity)
already delegates all four spec commands to the staged
`.frame/runtime/commands/<tool>/` templates — but the project's AGENTS.md still
carried a pre-split FULL legacy section, and AGENTS_SPEC_LEGACY_MATCHERS only
recognized the post-split core pointer, so upgradeSpecDocs never rewrote it and
the old "write exactly one file" mini-flow kept shadowing the real templates.
Decisions: bridge via the staged command templates (not
`.frame/runtime/prompts/` — those only exist after a UI dispatch; not
`.claude/commands/` — Frame never writes to the user's .claude/). Fix on
`hotfix/spec-section-bridge` (based on feat/spec-enhancements — main lacks
commandStaging entirely): added LEGACY_SPEC_DRIVEN_SECTION_V0 (2eeee3b
generation) and both full-section generations to the AGENTS matcher list,
refreshed sample-project fixtures to the current managed block, regression
test added. No SPEC_SECTION_VERSION bump — bodies unchanged. Note:
`.claude/skills/spec-plan` seen in the affected project is not Frame-generated;
delete it there by hand.

### [2026-07-28] Spec-Driven Development is on by default, toggleable in Settings
Reported symptom: a user initializes a project, gives a sizable task, the agent
writes a spec — and the user never sees it. Cause: `features.specDriven` was
`false` in the config template, but the spec command templates are staged at
init regardless, so a CLI session could run the whole flow while the Specs
panel kept showing the opt-in suggestion modal. The flag was hiding work that
had already happened. Decisions: (1) new projects start with
`features.specDriven: true` and AGENTS.md ships with the managed spec section;
`.frame/specs/.gitkeep` is created at init. (2) Opting out moved from "edit the
files by hand" to Settings → Workflow — a per-project toggle (the flag lives in
`.frame/config.json`, not user-settings.json), wired through `SET_SPEC_DRIVEN`
to `setSpecDrivenEnabled` → `enableSpecDriven` / new `disableSpecDriven`.
Disabling flips the flag and strips the *marker-wrapped* spec section from
AGENTS.md only (`stripManagedSpecSection`, same "prove it's ours" contract as
docsManagedBlock's upgrade path) — a hand-written section and `.frame/specs/`
are never touched. Projects initialized before this keep their existing flag;
nothing force-enables on open, since that would rewrite an AGENTS.md the user
never asked us to change. Rejected: auto-enabling when specs already exist on
disk — it would silently undo an explicit "off" on every panel open.

### [2026-08-19] UI redesign starts incrementally — step 1: JetBrains Mono as the primary UI font
Kaan brought an interactive HTML prototype (`~/Downloads/frame-ui-prototype.html`)
proposing a new information architecture (spec "rails" with SPEC→PLAN→TASKS→OUTCOME
stations, footprint guard as a first-class UI element, a Context Ledger panel).
Decision: the redesign will proceed in small independent steps, explicitly NOT as
one big spec. First step shipped now: typography. The prototype's look comes from
JetBrains Mono being the *primary* UI font (not just code font), with Inter for
prose. Changes: `index.html` Google Fonts link swapped DM Sans → Inter + extra
JetBrains Mono weights (600/700/800); `--font-sans` in `variables.css` now Inter;
`body` in `ui.css` switched to `var(--font-mono)`; all chrome elements (buttons,
selects, inputs, sidebar items, search fields) that hardcoded `--font-sans` were
flipped to `--font-mono`; prose stays sans (#editor-preview, .file-desc,
.spec-driven-hint, structure-map .node text); xterm `fontFamily` in
`terminalManager.js` now leads with JetBrains Mono. Verified with a live app
screenshot. Deferred (candidate next small steps): vendor the fonts locally
instead of Google Fonts CDN (aligns with audit-q3-performance-resources' offline
principle), and update the report templates (`plan-report-template.html`,
`build-implement-report.mjs`) which still use DM Sans.

### [2026-08-20] Fonts vendored locally — Google Fonts CDN removed
Follow-up to the 2026-08-19 typography step: `@fontsource/inter` (400/500/600)
and `@fontsource/jetbrains-mono` (400/500/600/700/800) added as npm deps;
`index.html` now links their per-weight CSS from `node_modules/` — same
vendoring pattern as xterm.css and D3, and consistent with
audit-q3-performance-resources' offline principle. electron-builder already
packages `node_modules/**/*`, so no build-config change was needed. Verified
live: zero external requests, JetBrains Mono faces active from local woff2.
Still open: report templates (`plan-report-template.html`,
`build-implement-report.mjs`) reference DM Sans — they are standalone
browser-opened reports, untouched for now.

### [2026-08-20] Density pass — UI compacted to match the prototype's feel
Step 2 of the incremental redesign (after the JetBrains Mono switch). Kaan
noted the prototype reads far more compact than the app; diagnosis: not
resolution but typographic scale + spacing (and mono looking larger than sans
at equal px). Changes: body 13→12px and line-height 1.5→1.45 (`ui.css`);
hardcoded font sizes shifted one step down across all of `src/renderer/styles/`
(13→12, 14→13, 16→14, 18→15, 20→16, 22→18; 12px-and-below untouched);
`--radius-*` 6/8/12/16 → 4/5/6/8 and `--space-*` 4/8/12/16/24 → 4/6/10/14/20
in `variables.css`; xterm fontSize 14→13 in `terminalManager.js`. Verified
with live screenshot (sidebar project names no longer truncate; task rail fits
more cards) and the full test suite (222 pass). Rationale recorded: the
prototype's compact feel = 12px mono base + 5–14px padding band + 3–6px radii;
these values approximate that within the existing variable system.

### [2026-08-20] Prototype color palette adopted — green accent on warm charcoal
Step 3 of the incremental redesign. The prototype's palette replaced the amber
design system in `variables.css` (dark theme): backgrounds #0c0b09/#14120e/
#1c1915/#242019 (+#2a2620/#332e25 extrapolated for elevated/hover), text
#f2eee4/#c4bcac/#948c7c, accent green #8ff0ae (secondary #6fd693), semantic
success #9bdca8 / warning #e5cd8e / error #e8938a / info #a6c0f0, borders now
solid warm tones #221e18/#2a2620/#3a342b (was rgba white). New `--doc-*`
variables added for the prototype's document-type colors (spec gold, plan blue,
task orange, outcome green) — unused yet, reserved for the spec-rail step.
Light theme kept but accent shifted to deep green #2f7d4f for coherence.
All hardcoded old-palette rgba/hex swept from styles and JS: panels/lane-board
accent rgba, success/info/warning rgba, structureMap node colors, btn-success
gradient (text now #07130b on green), window backgroundColor #1e1e1e→#0c0b09
in `src/main/index.js` (also fixes the boot flash mismatch), xterm dark theme
bg #0a0908 / fg #c4bcac / cursor green per the prototype's darker term panes.
Verified: live screenshot + 222 tests pass.

### [2026-08-20] Terminals view shipped — prototype navigation model, "Frame"→"Terminal"
Step 4 of the incremental redesign, run as spec `terminals-view` (see its
chain for full detail). Kaan's direction: they dislike the current UX; the
prototype's model is the target — pick a project on the left, its workspace
items appear under it, content lives in the center, not in right-side panels.
Memory/Team/Rails explicitly out of scope for now; start with terminals, and
drop the "Frame" naming for work streams ("terminal-terminals olarak geri
dönebiliriz"). Shipped: viewMode 'terminals' as the default landing view on
project selection (terminalsView.js — live pane grid, 1/2/3 columns, drag
reorder, maximize, per-project prefs), sidebar `Terminals (n)` workspace nav,
and the user-facing naming sweep. Explicitly overturned lane-orchestrator's
decisions (user-facing "Frame" naming; board as landing view — board remains
reachable via Home). Verified with a live driven run (create/layout/maximize/
typing) and 222 passing tests.

### [2026-08-20] Workspace nav grew Specs + Tasks; running-agent indicator on Terminals
Follow-up to terminals-view. The sidebar workspace nav under the selected
project now has three entries: Terminals (count + a green "◆ N" indicator
when agents are running in the project's terminals, fed by laneStatus),
Specs (active specs, phase !== done — same semantics as the old lane rail
count), Tasks (non-completed). Counts ride the existing SPEC_DATA/TASKS_DATA
pushes; zero new IPC. Specs/Tasks clicks open the existing dashboards
(specsDashboard/tasksDashboard) — converting those into true center
viewModes is a later step. Decision on "active agents": the per-project
answer is the ◆ indicator + pane status dots in the terminals view; the
left-rail Agent tab stays untouched for now because its unique value is
cross-project attention — its fate belongs to the panels-consolidation step
(prototype's model would move it to top-bar presence).

### [2026-08-20] Specs & Tasks became center views (spec: center-specs-tasks-views)
Dashboards no longer cover the window: they mount inline into the center via
an inline-host contract in multiTerminalUI (viewModes 'specs'/'tasks'), and
every legacy entry point delegates there. Sidebar Specs is lifecycle-first —
opens specSection (linear stepper) on the top active spec, with the section
rail's ↗ as the in-center switch to the card grid; Tasks opens the kanban
inline. Kaan's design question ("büyütme ile dashboard'a mı, merkezde switch
mü?") resolved as: stay in center, switch in place. Escape/× → terminals view.

### [2026-08-20] Instrument rail + slide-in panels retired (spec: retire-rail-and-panels)
One navigation system remains: sidebar workspace nav (nine entries) → center
views. Generic inline panel host re-parents legacy panel elements into the
center (MutationObserver routes their own closes back); rail deleted, theme
toggle moved next to Settings. Also: Kaan caught that the two prior
hand-made specs never mirrored their tasks into tasks.json — no good reason,
it was an omission; backfilled (terminals-view 7, center-specs-tasks-views
5) and this spec created its 6 task rows properly at spec time.

### [2026-08-20] Agent tab → topbar presence (spec: topbar-presence) + card hover jitter fix
Running agents are now prototype-style ◆ chips in the top bar (presenceBar.js,
cross-project, status-flavored, click-to-focus with project switch); the
Default Agent launcher moved to the top bar with IDs intact; the sidebar
Agent tab and agentPanel.js are gone. Separately, Kaan reported hover jitter
on task cards and the specs grid: cause was translateY(-1px) on :hover
(card slips from under the cursor at edges → hover oscillates); transforms
removed from .tasks-dashboard-card:hover and .specs-card:hover.

### [2026-08-20] CPU runaway in Specs/Tasks center views — IPC feedback loop fixed
Kaan reported terrible CPU when opening tasks/specs. Measured with an
instrumented run: the specs grid idled at ~100 IPC round-trips/second
(1039 watch-specs/load-tasks/list-specs calls in 10s, 163% CPU). Cycle: an
open spec/task section chip listens to SPEC_DATA/TASKS_DATA and calls
notifySectionChanged → _onStateChange re-rendered the inline dashboard →
mountInline re-ran _load() → WATCH_SPECS/LOAD_TASKS → new pushes → repeat.
WATCH_SPECS additionally runs stageCommandFiles + upgradeSpecDocs in main on
every call — the actual CPU burner. Fix: _renderDashView/_renderPanelView
are now idempotent (already-mounted surfaces are never remounted on state
changes; their own IPC listeners keep them fresh). After: 0 IPC calls, 0%
CPU at idle in both views. Lesson recorded: any inline-mounted surface whose
mount triggers a data load MUST be mount-idempotent, because section chips
rebroadcast every data push through _onStateChange.

### [2026-08-20] IPC watchdog added; post-storm audit came back clean
Kaan's concern after the storm: IPC is critical, and a storm with no terminal
open was unsettling — is the redesign flow safe? Audit findings: (1) the
storm ran only over three read-only data channels (watch-specs/load-tasks/
list-specs) — no PTY/terminal channel was ever involved, and no IPC contract
changed anywhere in the redesign (ipcChannels.js zero diff throughout);
(2) disk side effects: none — WATCH_SPECS's repeated stageCommandFiles/
upgradeSpecDocs writes are idempotent, AGENTS.md diff-clean, managed section
single; (3) a full-channel idle sweep across every surface combo (specs grid
+ open chip, tasks board, live shell, cross combos) is quiet — 0 events/10s,
0% CPU (terminals+shell baseline 2.6% = pre-existing process polling).
Guard added: src/renderer/ipcWatchdog.js — wraps ipcRenderer send/invoke/emit,
rolling 5s windows, warns via console + notify toast when >300 msgs sustained
(~60/s), max one toast/min; initialized first in index.js init(). Verified:
silent through boot and view switching, fires correctly on a synthetic
500-message burst. Process change of record: view-layer work is now verified
with resource measurement (IPC counters + CPU sampling), not just behavior.

### [2026-08-20] Projects moved to a far-left expanding rail (spec: project-rail)
Kaan disliked the sidebar project list; the prototype's leftmost column is
now real: 56px initials-avatar rail (FRAME = accent ring, agent attention =
corner dot), expanding to a 240px flyout over the sidebar on hover/focus
(class-driven for keyboard parity and testability; no layout shift). The
sidebar Projects tab became the workspace panel (project header + nav).
projectListUI logic untouched — presentation-only move; all behaviors
(reorder, remove, auto-select, keyboard, Cmd+Shift+[/]) re-verified live.

### [2026-08-20] ⌘K palette jump shipped (spec: palette-jump)
The palette now mixes dynamic jump targets with commands via registry
providers: projects, terminals across projects (presence-flow focus), the
current project's specs (opens lifecycle view; push-fed cache), and nine
"Go to" view entries. Transient items never enter recents. Implementation
incident worth remembering: forgetting to export registerProvider made
paletteSources.init throw during boot, silently aborting the rest of
index.js init() — palette and every keyboard shortcut died with no visual
symptom. Caught by pageerror capture in the driven verification run;
boot-error capture is now part of the live-verification recipe.

### [2026-08-20] Context Ledger postponed; two topbar/rail polish fixes
Ledger decision: postponed by Kaan — feeding it from the activity monitor
would surface too much irrelevant noise ("aktivity monitorden çekersek çok
ilgisiz şeyler de görünür, şimdilik bekletelim"). Revisit when
orchestration-grade events (guards, decisions) exist as a distinct stream.
Polish shipped instead: (1) the top bar's agent launcher (Claude + Start)
was cramped against the SESSION usage bars — now separated by a divider +
14px gaps; (2) the project rail's first avatar started at the window edge —
the list now carries a 60px top inset so it aligns with the sidebar's
project header line.

### [2026-08-20] Project selection moved to the top dropdown; rail removed (spec: project-dropdown)
Kaan's call, hours after the rail shipped: drop the far-left bar, select
projects from the existing current-project switcher (as Files/Changes
already did), Add new Project pinned at the sidebar bottom. Same-day
overturn of project-rail recorded explicitly. projectListUI is now a
headless controller; switcher menu rows gained attention dots + remove ×.
Accepted regression: drag-reorder UI is gone (IPC kept). ~500 lines of
orphaned row/rail code and CSS deleted.

### [2026-08-20] Bug: "Add new Project" was dead through the project-rail build
Kaan reported the button not working. Root cause: the project-rail spec
removed the `#project-section` wrapper from index.html, but
`projectSection.init()` still began with
`section = getElementById('project-section'); if (!section) return;` — the
early return skipped the Add-button binding, so the control was silently
dead for the whole rail period. Today's project-dropdown rewrite replaced
that init and incidentally fixed it (verified live: button → modal → Select
folder → select-project-folder IPC). Added an explicit console.error when
the button is missing so a failed binding can never be silent again.
Process lesson: live verification covered what each spec *built* but not
controls it *moved* — moved controls now need their own click-through.

### [2026-08-22] PR #116 (overlay architecture) declined; non-invasive-overlay spec rewritten — delivery stays file-based
Kaan asked why PR #116 (BerkayYilmaz11, "Frame no longer writes outside
.frame/") was 40k lines. Breakdown: ~21.6k generated spec HTML reports,
~5k spec docs, ~6k src, ~4.6k tests, the rest this repo's own meta files
relocating. Four parallel audits (migration safety, context/terminal
delivery, store/git/orchestration, renderer/IPC) on a worktree of the PR
found: migration fingerprint accepts a bare `CLAUDE.md → AGENTS.md`
symlink (a public convention) so the silent startup sweep moves/deletes
root files in repos Frame never touched; worker lanes cannot launch
(relative `./.frame/bin/claude` with worktree cwd; local-mode worktrees
have no `.frame/` at all); `.frame/bin` first on PATH with only three
names sanitised = repo-to-shell code execution; shipped
`update-structure.js` misresolves ROOT_DIR and erases STRUCTURE.json;
CI red on ubuntu/windows; `alias claude=` users lose everything; context
becomes an advisory pointer that never reaches subagents. Review posted:
https://github.com/kaanozhan/Frame/pull/116#issuecomment-5381170295 (not
closed; left to Kaan).

Important realisation: the PR implemented *our own* June spec
(non-invasive-overlay, goal 4: "native prompt injection at launch time —
not by planting files"). Kaan's position ("hooklarımızın, injectionlarımızın
çalışma biçimi değişmemeli … şu anki yazılım geliştirme deneyimimiz çok
iyi"): determinism of context + hooks is non-negotiable. Decision: keep
the data move, explicitly overturn launch-time injection. Verified with
`claude -p` in a scratch repo that (a) root `CLAUDE.md = @.frame/AGENTS.md`,
(b) user CLAUDE.md + `.claude/CLAUDE.md = @../.frame/AGENTS.md`, and
(c) user CLAUDE.md + `.claude/rules/frame.md = @../../.frame/AGENTS.md`
all load natively. Chosen: (c) — one mechanism, never collides with
user files, Frame-named, no symlink (Windows OK).

Spec rewritten in place (same slug, phase still specified) with D1–D10:
meta files → `.frame/`; `.claude/rules/frame.md` pointer; hooks stay in
`.claude/settings.json` (guarded command, Frame-marked entries);
gitSharing local|repo via `.git/info/exclude` + `settings.local.json`;
data-centric `frameStore` seam (files remain source of truth, reads from
disk — required for determinism); file classes instruction/data/derived/
runtime driving `.frame/.gitignore` and future sync; `projectId` UUID
stamped at init/migration; consented (modal) migration with strict
`config.json.files` fingerprint, fsSafe, backup, AGENTS.md upgrade;
"Remove Frame" enumerable; husky/lefthook snippet-only. Out of scope:
cloud backend, agent CLI instead of file edits, local-mode orchestration,
Gemini (being removed — Kaan: "gemini'yi zaten kaldıracağım").

Scenario comparison (15 user scenarios × main / PR #116 / proposal):
https://claude.ai/code/artifact/2c4d436b-5f95-4f72-8736-aa92d9f766a5
Pieces of PR #116 worth reusing as reference when planning: gitExclude.js,
gitSharing.js (clean in audit), migration happy path, Project Settings modal,
the tree-walk "nothing outside .frame/" test.

### [2026-08-24] Tasks board: the right aside is on demand now (spec: tasks-detail-on-demand)

Kaan: the Tasks board's right panel is "rahatsız edici, çok yer kaplıyor" —
it fills in only two cases (new task, task detail), and New Task already has
a header button, so it should open only when needed and give the columns the
full width when closed.

Agreed, and the reason is worth recording: the panel's *default* state was
its least useful one. Empty, it showed an "Add a new task" card that
duplicated the header button, while costing up to 380px of a center view
already sharing the window with the sidebar. Widest cost, thinnest content.

Shipped: `.tasks-dashboard-detail` is `display: none` unless `.open`;
columns measured 646px → 1094px at the default window size. The three
scattered show/hide toggles collapsed into one `syncAside()` (form → detail
→ collapsed) that every selection/form path routes through, plus
`resetAside()` when the board is left so no half-typed form waits on return.
Empty-state markup/CSS/listener deleted.

Left alone deliberately: the Specs dashboard has the same always-on aside
shape (`specs-dashboard-detail-empty`). The request was about Tasks; if the
same complaint arrives there, the pattern above ports directly.

### [2026-08-24] Overview retired; Decisions became a center view (spec: decisions-view)

Kaan: "bu overview ekranından da kurtulabiliriz, sadece ordaki decisions ı
sol panele menüye almak istiyorum ve tıkladığımda bütün listeyi merkez
ekranda görmek istiyorum" — like Tasks.

Overview was four cards: Structure, Progress, Decisions, Stats. Progress and
Stats restated what the Tasks board and the repo already show; Structure was
just a launcher for the map. Decisions was the only card holding data with no
other home — and it showed five rows of date + title, the least useful part
of a decision record.

Two choices Kaan made when asked: the structure map gets **its own sidebar
item** (rather than palette-only or dropped), and the list is a **collapsible
list + search**, not a two-pane detail view — consistent with him having just
called the Tasks board's permanent right pane "rahatsız edici".

Shipped: `decisionsView.js` (53 entries here, body expands in place as
markdown, search over date/title/body, 900px prose cap); `overviewPanel.js`
and 376 lines of overview CSS deleted; `overviewManager.js` →
`projectInsights.js` keeping the two reads that outlived the dashboard
(decisions + per-file git history for the map).

Deliberate IPC delta: `LOAD_DECISIONS` added, `LOAD_OVERVIEW` removed (its
only caller was the deleted screen), `OVERVIEW_DATA` removed (already dead).
139 channels before, 139 after.

Worth remembering: `scripts/update-structure.js` merges IPC channels and
never prunes them — after this change STRUCTURE.json still listed the two
removed channels (141 vs the real 139) even after a full run. Pruned by
hand. Any future channel removal needs the same manual step, or the script
needs a prune pass.

### [2026-08-24] Claude session list read from transcripts; resume gets its own terminal (spec: sessions-from-transcripts)

Kaan: the sessions screen "çok eski sessionları gösteriyor… orası çalışmıyor
özetle." Measured before touching anything: `sessions-index.json` here was
written 2026-01-28, held 3 entries, and all three transcripts had been
deleted — so every row was a dead session, and clicking one ran
`claude --resume` on an id that no longer existed. The file exists in 2 of 95
project directories; Claude Code writes `<sessionId>.jsonl` and does not
maintain the index. 14 real transcripts sat unlisted in the same directory.

Fix: derive the list from the transcripts (streamed, so a 24MB file neither
loads into memory nor blocks the main process), with an append-only offset
cache so re-opening the panel re-reads only new bytes. Titles come from the
`ai-title`/`summary` record and fall back to the first *real* user prompt —
isMeta records, tool results, `<command-name>` wrappers and caveat blocks
are skipped, or the title would read like harness noise. Transcripts with no
conversation are not listed at all.

Second half, from Kaan seeing the failure live: resume now opens a NEW
terminal and runs Claude there. The old path used
`window.terminalSendCommand`, which types into the *focused* terminal — and
since that terminal is normally already running Claude, `claude --resume <id>`
arrived as a chat message. (It reached this very session that way, which is
how the bug got noticed.) It now reuses the Start button's path:
createTerminalForCurrentProject → enter lane → send after the 800ms settle,
using the Claude tool's command rather than the active tool, with the id
validated as a UUID first.

Result: 13 real sessions replaced 3 dead rows. Honest limit recorded in the
spec — transcripts Claude Code already pruned cannot come back.

Also worth keeping: `CLAUDE_CONFIG_DIR` is now honoured when resolving
Claude's data directory (matching Claude Code itself), which is also the seam
the tests use to point the module at a fixture tree.

### [2026-08-24] The "high internal traffic" toast: resize storm found, watchdog now leaves evidence (spec: resize-storm-watchdog)

Kaan saw a warning at the top of the window now and then — "unusual high
traffic" — unreadable and gone before it could be read, and asked whether it
had reached the logs. It had not: the warning was a renderer `console.warn`
plus a 4-second toast, and electron-log bridges only the main process, so
`main.log` held zero watchdog lines. A watchdog whose evidence evaporates is
not a watchdog.

Cause, measured before changing anything: `window.addEventListener('resize')`
→ `fitTerminal()` → `fitAll()` with no debounce, so a window drag sent one
`TERMINAL_RESIZE_ID` per terminal per frame — 363 messages in 2.2s with three
terminals (~205/s), past the 300-per-5s threshold. Ruled out by measurement:
idle, streaming PTY output (already batched), touching 300 source files, git
churn, spec status.json churn — all ~0/s.

So the toast was accusing legitimate traffic of being a render loop while
pointing at real waste (the PTY only needs the final size). Fixed by
debouncing 80ms — the same settle the terminals view's ResizeObserver already
used — 363 → 6 messages, terminals still fit their panes.

Two things the incident taught, both now fixed: (1) the watchdog logs through
`electron-log/renderer` so the channel breakdown survives the toast, and its
wording reports what it observed rather than asserting a loop; (2) toasts can
opt into sticky mode with an ×, because a warning carrying detail cannot fade
in four seconds.

And a plain bug found while verifying: `.app-toast-error` used
`var(--error-subtle)` — 15% alpha — as its background, so whatever sat behind
the toast read through the text. That was part of "tam okunaklı değil" all
along. The tint is now layered over `--bg-elevated`.

### [2026-08-26] Issue #122 — a spec folder is never silently hidden (spec: spec-status-repair)

An outside report (StreamlinedStartup, issue #122): the spec panel showed
none of five spec folders that Frame's **own conductor agent** had created,
with no error anywhere. Their `status.json` carried `title`, `phase` and
timestamps — the fields the staged templates name — but not `slug`, and
`listSpecs` did `continue; // silently skip malformed`.

The reporter's framing is the part worth keeping: this was not a third-party
tool guessing at our format. Frame launched the conductor, handed it
`CONDUCTOR.md` and the staged spec templates, and those templates say which
fields to *update* without ever stating the required shape. Meanwhile the
rest of Frame accepted the same folders — the task watcher imported their
tasks and wrote `generated_task_ids` back into the very file the panel
rejected, and `spec-index.js` indexed them. Half of Frame agreed, half
pretended they did not exist.

Reproduced against the real specManager before touching anything, and found
one thing the report missed: deriving the slug is not enough.
`generated_task_ids` is the validator's other required field, so those specs
would have stayed hidden even after a slug-only fix.

Shipped three parts: repair what the folder itself answers (slug ← folder
name, generated_task_ids ← []) and persist it once; surface anything still
invalid as a "needs attention" card with the validator's reason, sorted
first and inert, instead of dropping it; and document the required shape in
`spec.new.md` and `CONDUCTOR.md` — in `src/templates/`, since `.frame/runtime/`
is a staged copy Frame overwrites.

One rule guarded by its own test: **an existing slug is never overwritten.**
A folder name disagreeing with a recorded slug is a rename question, and
"fixing" it silently would cut every `source: spec:<slug>:T##` link in
tasks.json.

Two things the live check taught: `specPanel.renderSpecRow` (the legacy side
panel, still rendering on every SPEC_DATA push) threw on a phase-less entry
and needed a guard; and `reconcilePhase` already heals an invalid `phase`
from the files on disk, so in practice the malformed path is narrower than
the issue suggests — a missing title or an unreadable file.

### [2026-08-26] A status bar at the foot of the window (spec: status-bar)

Kaan proposed a bottom bar: session limit meter to the bottom-right, theme
toggle to the top-right, room for more later. Agreed, and the reason is worth
recording as a rule rather than a one-off: **the top bar holds controls you
click, the status bar holds readouts you glance at.** The usage meters had
already caused one crowding complaint up there ("start butonu çok dip dibe"),
which is what a readout wedged into a toolbar does.

Shipped: 26px bar, fixed, with `body { padding-bottom }` — both reading the
same `--status-bar-height` token so they cannot drift. Fixed rather than a
new flex row in the shell because every modal and overlay is a body child,
and re-parenting all of them to add one bar is not a trade worth making.

Two ownership fixes rode along. The usage widget belonged to
`terminalTabBar`, which rendered and updated it; it now belongs to a new
`statusBar.js` (behaviour moved verbatim, tab bar −111 lines). And the theme
toggle is wired inside `terminalTabBar` rather than `index.js`, because the
tab bar renders that button — an `index.js` listener would bind before the
element exists, which is exactly how "Add new Project" died silently for a
day.

The bar's left half is deliberately empty. It is a declared slot; nothing was
invented to fill it.

A correction worth keeping, because it nearly cost a day of work: I reported
"light theme has real contrast problems — the project switcher and agent
selector keep dark backgrounds". That was **false**. The screenshot was
captured in the same tick as the theme flip, so `capturePage` returned a
half-repainted frame: some elements light, some still dark. Computed styles
in light theme were correct all along. Lesson for the verification recipe:
after a theme change (or any global restyle), wait a beat before capturing,
and check computed values rather than reading a screenshot as truth.

The light-theme pass that followed was therefore driven by measurement, not
by the picture — see the entry below.

### [2026-08-26] Light-theme contrast, measured (spec: status-bar, second half)

Kaan asked to fix light theme in the same PR. Since my original claim turned
out to be a screenshot artifact, the pass was done with a real WCAG contrast
probe instead: for every text node, the element's colour composited over its
actual ancestor backgrounds, compared against 4.5:1 (3:1 for large text),
across Home / Specs / Specs grid / Tasks / Decisions / Claude, in both themes.

Two real defects, both fixed:

1. **`.plugin-status.status-available` measured 1.44:1** — `--text-muted` on
   `--bg-hover`, effectively invisible. Now `--text-secondary`.
2. **Every badge that pairs a 12% tint with the same hue as text** measured
   3.5–4.0:1 in light (58 such rules across the CSS: phase badges, priority
   chips, active filter chips, status pills). Fixed once at the token level
   by darkening the light palette's text hues ~12% — `--accent-primary`
   `#2f7d4f→#286b44`, `--success` `#4a7c50→#3e6843`, `--error`
   `#b84040→#a43939`, `--info` `#4070a8→#376090` — so all 58 clear AA without
   touching a single rule. Dark theme is untouched.

`--warning` was left alone: it fills bars and dots, where the darkening
needed for text (`#c07820→#815015`) would look muddy. Warning *text on a
tint* uses a new `--warning-ink`, which is just `var(--warning)` in dark.

The status bar's own meters were fixed too — its label and reset time sat at
2.4–3.1:1, and a readout nobody can read is decoration.

**Left as a decision, not silently changed:** the app-wide metadata palette
(`--text-tertiary` / `--text-muted` at 9–11px: nav counts, card slugs, dates,
the version string) measures 2.2–3.2:1 in **both** themes. That is a
deliberate "quiet" look, not a light-theme bug, and raising it would visibly
change the whole app. It needs a call, not a patch.

### [2026-08-26] Sidebar nav grouped; History retired; four shortcuts that never worked (spec: sidebar-nav-groups)

Kaan asked to tidy the left menu into Work / Context / Frame / Project, then
withdrew the Project group mid-request ("sol bar dursun") — so the icon rail,
Files, Changes and Settings stayed exactly where they were, and only the
workspace nav changed.

Three groups now: Work (Terminals, GitHub, Claude), Context (Specs, Tasks,
Decisions, Structure, Prompts), Frame (Activity). Collapsible, state in
localStorage. One detail worth keeping: **a folded group holding the active
surface marks its header** — without it, collapsing Context while sitting in
Tasks made "where am I" disappear entirely.

History retired. Kaan's instinct ("aynı şeyleri yazıyoruz gibi görünüyor")
was exactly right and cheap to verify: `promptsPanel` and `historyPanel` both
sent `LOAD_PROMPT_HISTORY` and rendered `PROMPT_HISTORY_DATA`. Two surfaces,
one dataset. He chose to keep Prompts (search, cards, per-project).

**The find of the day, and it was free:** `registerCommands()` is a top-level
function, but four of its commands closed over `multiTerminalUI`, a `const`
declared inside `init()`. Each threw `ReferenceError: multiTerminalUI is not
defined`, which `runById`'s catch turned into a console line nobody reads. So
⌘⇧L (Prompts), ⌘⇧X (Claude) and ⌘⇧G (GitHub) had never once opened a panel.
Same family as the dead "Add new Project" button: a control that fails
silently is indistinguishable from one that was never wired. Fixed by
resolving the UI the way the sidebar rows do.

Verification note, for the recipe: **localStorage persistence cannot be
tested through Playwright here.** A canary key written and given six seconds
came back `null` after relaunch, because the harness kills the app rather
than quitting it, so Chromium never flushes its LevelDB. `frame-terminals-view`
looked like proof of persistence but is written fresh at boot. Read paths can
be proven with `page.reload()` (same process, storage intact); disk survival
has to be taken on the mechanism's track record.

### [2026-08-26] AGENTS.md generations have different *shapes*, not just different text
A user reported the symptom recorded in **[2026-07-23] Spec-flow delivery gap**
all over again: asked in natural language to plan a spec, the agent never
entered the deep `spec.plan` flow. Diagnosis this time went one layer down.
The 07-23 fix broadened `AGENTS_SPEC_LEGACY_MATCHERS` so a pre-split AGENTS.md's
full section would finally be replaced by the core pointer. It was — and the
pointer aimed at `.frame/docs/REFERENCE.md`, which `upgradeSpecDocs` never
creates (`catch (_) { continue; // missing file — never create it }`). The old
bug was "the agent follows a stale flow"; the fix turned it into "the agent has
no flow". Every project born v1.0.0–v2.4.0 with spec-driven on took that path
on its next open. Fixed in `spec-docs-delivery-invariant` T01–T04: artifacts
before docs on open, and the pointer written only once its target is read back
and confirmed to carry the block.

**The reusable finding, and a planning mistake worth not repeating.** While
planning, one measurement — all seven `AGENTS_LINE_EDITS` targets miss on a
genuine v2.4.0 AGENTS.md — was carried to the decision gate with its cause
assumed rather than checked, and a whole navigation-managed-block workstream
was decided on it. The measurement was right; the cause was not. Verified
afterwards: every one of the seven **hits** the post-split (v2.5.0/v2.6.0)
generation they were written for, so that population was never broken. They
miss on pre-split documents because `## Project Navigation` and the pointer
table **do not exist there**. Pre-split AGENTS.md is not the current document
with different wording — it is a different document, carrying the whole
maintenance ceremony inline (`## Task Management`, `## PROJECT_NOTES.md Rules`,
`## Context Preservation`, `## STRUCTURE.json Rules`, `## General Rules`), 13
root-relative meta mentions and no `.frame/` prefixes at all. So: when reasoning
about an older generation of a Frame-written document, compare **headings
first**; a matcher that misses may be pointing at a section that was never
there. The pre-split document remains a real open problem — deliberately left
to its own spec, to be diagnosed before it is decided.

### [2026-08-26] The "98 IPC msg/s" warning was not a render loop — terminal stdin is chatty by nature

Kaan reported the watchdog toast during ordinary use:
`98 IPC msg/s sustained for 5s — top: out:terminal-input-id ×274,
in:terminal-output-id ×217`, and asked what was causing it.

It was not a loop in Frame. The evidence was sitting in
`~/.frame/prompts/sample-project.log`, which records every byte that reaches
a PTY's stdin. Parsing the last 2MB of it:

| stdin traffic | count |
| --- | --- |
| `ESC[?<row>;<col>R` — cursor-position reply | 198,590 |
| `ESC[<35;x;y M` — SGR mouse motion report | 9,261 |
| `ESC[I` / `ESC[O` — focus in/out | 973 |
| DA and other CSI replies | 11 |

95% of "input" is xterm **answering the foreground TUI**. An agent TUI asks
`ESC[?6n` on every render; the two most frequent answers were `row=39,col=3`
(×87,527) and `row=36,col=3` (×66,050), alternating — two queries per frame.
That explains both directions and the ratio: output is capped by ptyManager's
16ms flush (~43/s observed), and the replies track it at ~1.26 each.

Four things came out of that, all shipped together:

1. **Input had never been coalesced.** Output was batched during
   resize-storm-watchdog; stdin still cost one IPC per chunk. New
   `src/renderer/terminalInput.js` is now the single renderer→stdin path
   (also fixing ordering by construction, since `sendCommand` and
   `terminalSendPromptThenEnter` used to race `onData` in principle). The
   window is a **microtask, deliberately not a timer**: a TUI blocks its own
   frame waiting for the answer, so holding replies for even one display
   frame would slow the thing producing them. It merges what xterm emits
   while parsing one output flush — the 274-vs-217 surplus — and nothing else.
   Honest size: ~20%, not the fix.

2. **The watchdog was miscalibrated, and that was the real fix.** Terminal
   stdin/stdout are the one pair of channels whose legitimate rate is set by
   something other than Frame. They now have their own threshold (1500/window
   ≈ 300/s) while Frame's own channels keep the original 300/window that
   caught the 2026-08-20 incident. Below the terminal bar the line is still
   written to `main.log` — nothing is blinded — but no red toast. The toast
   also stopped asserting "A render loop is the usual cause"; in this case it
   sent the investigation the wrong way.

3. **The report now names the payload, not just the channel.** This
   investigation cost an afternoon because "out:terminal-input-id ×274" says
   nothing about what those bytes were, and the answer was only recoverable
   from the prompt history by accident. The line now reads
   `— stdin: cursor-report ×274`.

4. **`_sendResize` fired on unchanged geometry.** Fitting makes xterm rewrite
   its own DOM, which re-fires the pane's ResizeObserver, which fits again —
   a settled layout produced a steady stream of no-op resizes
   (`out:terminal-resize-id ×30` in one window). It now sends only on change.

**Separate bug found on the way in:** `promptLogger` was feeding these
control replies into the prompt history. Dropping the bare ESC byte
(`charCode < 32`) was not enough — the printable tail `[?39;3R` still landed
in the buffer, so every real prompt was written prefixed with tens of
thousands of junk characters. One line measured 48,886 characters holding 71
characters of actual prompt, and `sample-project.log` had reached 1.5MB.
`logInput` now consumes whole escape sequences with a scanner whose state
carries across chunks (a reply can be split between two writes). Arrow keys
were polluting prompts the same way and are fixed by the same change.

The existing polluted history files were left alone — user data, Kaan's call.
### [2026-08-26] Home became the landing surface, and three of the terminals-home-agents decisions were overturned

Visual review of the finished `terminals-home-agents` spec, with Kaan driving
from the running app. Most of it was polish; three things were reversals of
decisions that spec had recorded, and they belong here rather than only in a
commit message.

**Landing view.** `terminals-view` had it that "selecting a project always
lands on its terminals view", and this spec's §1 kept Terminals as the
launch surface. Now: **a project with running terminals opens on Terminals, a
project with none opens on Home.** That also settles the app-launch case
without a first-run flag, because PTYs die with the main process — at startup
no project has a terminal, so a fresh window always lands on Home. The
argument that won: an empty terminals grid says nothing about the project,
and Home now does.

**The rail's hover control (D13).** The spec asked for a control at the edge
that "appears on hover". Built that way it was invisible until you happened to
be over it — a control nobody can find is a control nobody uses. It is now
permanently visible and merely quiet. D13's actual point (the rail is closed
by default and opens only when asked) is untouched.

**Orchestration left Home.** §4 listed four cards; there are three. It is a
surface you *open*, not a state you *read*, and it already opened as a top-bar
section tab — so the entry moved to the sidebar's Work group and Home stopped
carrying a card for it. Watch out for the signal that nearly went with it: the
card was the only place a live conductor session announced itself, so the
sidebar row grew a `running` badge.

Home itself became a project board with a header (name + branch, no path — the
sidebar already carries the path), two groups (Work / Project planning), and
terminal *tiles* rather than rows: a project holds nine at most, so boxes fill
the width a list wasted, and each box carries what you would otherwise open the
terminal to learn — status, assignment, last activity. Tasks became **Active
Tasks** and stopped listing spec-owned work; that work is the spec's business,
so it gets a warning line at the top instead of a second pile of the same
items.

**Two bugs the throwaway harnesses caught, both off-by-one-shaped.** The tile
grid's overflow label counted what was over the cap, not what was hidden — the
overflow tile itself costs a cell, so nine terminals showing seven said "+1
more" when two were missing. And the Tasks card would have claimed "Nothing
pending" while every open task sat inside a spec. Neither is visible in a
screenshot; both came from driving the real update methods against a DOM stub.
For renderer work with no DOM harness, that remains the cheapest real check
available — `npm test` never touches `src/renderer/`.

### [2026-08-27] The tab strip we built got removed, and why that is recorded rather than erased (spec: terminals-home-agents, second pass)

The spec's §2 asked for a tab strip as the Terminals section's first row —
`[Overview] [Terminal N] …`. It shipped as T02. Then we looked at it: the top
bar is *itself* a strip of surfaces, and the section's own strip sat immediately
underneath, two rows of tabs answering different questions with the same shape.

So it came out. Every live terminal of the project is now a chip in the top bar
beside Terminals itself, enlarged or not — Terminals is the grid of all of them,
a chip is that one enlarged. The prefs flipped with it: `openTabs`/`activeTab`
became `shownTerminal` + `hiddenFromBar`, storing what is *out* of the bar rather
than what is in it, so a terminal created later shows up by default. The
magnifier went back to `⤢` meaning "enlarge", since with no tabs there is nothing
to open one *in*.

The thing worth keeping from this: a spec that records only the final shape
teaches the next session less than one that says **the tab strip was tried and
removed**. "Never built" and "built, then rejected for this reason" are different
lessons. That is why `spec.md` grew a §0 Revision section listing R1–R3 and the
rejected-alternatives list now includes our own tab strip, with its reason.

A small consistency fix rode along: the top bar's Terminals wore lucide's Boxes
in the UI sans while the sidebar's Work → Terminals row wore a `›_` prompt glyph
and the new chips were mono. Two surfaces naming the same destination looked
like two different things. Terminals took the sidebar's mark and the chips' face.

### [2026-08-27] Settings split by scope, and the icon that was never wired (spec: settings-by-scope)

One gear at the foot of the sidebar opened one modal holding both kinds of
setting, so "Remove Frame from this project" sat a scroll from "Send anonymous
usage stats" as though they were the same kind of choice. They are not — one
writes into the open project's `.frame/` and dies with it, the other is true of
this machine whichever project is open.

Two surfaces now, and **the marks had to differ or the split would only move the
confusion**. The gear went *up* to the sidebar header, because a gear means
application preferences in every other app the user has open; the project's scope
took sliders. `settingsModal.js` became three modules, the third being the box
they share — which also has to stop the two stacking, since the buttons are
behind the backdrop while a dialog is up but `Cmd+,` is not.

**The launch project.** Frame selects `projects[0]` when nothing is active and
nothing restores a previous session, so the front of the workspace list *is* the
default project — and there was no way to change it since the list became a
switcher dropdown and its drag-to-reorder went with it. Project Settings gained
a row for it. Two copy decisions worth keeping: the row never says the list
cannot be reordered (the missing reorder is why the row exists, not something
the user needs told — naming it makes a working control read as an apology), and
the copy is state-dependent, because asking someone to make something the default
it already is reads as a no-op row.

**The icon.** Frame had shipped with Electron's default icon in the dock the
whole time: `package.json` had no `icon` key at all. And the product already had
a mark — `assets/logo.png` has always framed its bear in four corner brackets —
that nothing was using; the sidebar header wore an anonymous green square
instead. The brackets alone became `assets/frame-mark.svg`, feeding both the app
icon and that header glyph, so the window and the dock now say the same thing.

Two traps found on the way, both the same shape — *a path that exists here and
nowhere else*. `build/` is gitignored, so an icon path under it is missing on any
fresh clone and packaging would have failed away from this machine. And `build/`
is electron-builder's *input*, not shipped inside the app, so a runtime
`app.dock.setIcon` pointing there would find nothing in a packaged build. Both
icons live in `assets/`, which is tracked and is in the `files` list.

### [2026-08-27] Panels stopped pretending to be side panels (no spec — see below)

Two small fixes with one cause. The Claude, GitHub and Prompts panels each
carried a collapse chevron beside their title *and* an × at the other end, both
calling `hide()` — two controls for one action, and the chevron's arrow promised
a fold that never happened. And a panel hosted inline in the centre was capped at
a 900px reading column with a border down each side, leaving the rest of the pane
empty so it read as a side panel that had come loose rather than a view.

Both are leftovers from when these were edge-docked panels. Now that they mount
inline, there is no edge to fold back toward and no reason to leave the centre
empty. The chevron is gone and the panel fills the width.

This has no spec because the spec it belongs to — `retire-rail-and-panels`,
which the code comments cite by name — **has no folder in the archive**. See the
next entry.

### [2026-08-27] The archive drifted mid-branch, and two spec folders are missing

Twenty-four commits landed on this branch and only one spec covered them. Worse,
that spec was marked `done` while the work was still local and its definition was
still changing, so its `digest.md` — the text `spec-hint.js` injects into agent
sessions — was actively describing a tab strip that no longer existed.

The index's own safety net did fire: `spec-context.js` flagged the record
`stale: file changed after this spec closed`. But a stale flag says *verify*; it
does not say *the tab strip was removed*. An agent would have been handed a
confident, wrong description with a warning attached.

What we did instead of backfilling three retroactive specs: **reopened the spec**
(`done` → `implementing`), on the grounds that an unmerged branch whose
definition changed is one piece of work in flight, not a finished one plus
follow-ups. That also settled a question about the knowledge layer —
`outcome.md`'s file list is the index's source of *actuals*, so stuffing
post-spec work into a closed spec's outcome would attribute files to a spec that
never touched them. Reopening makes the attribution honest; editing a closed
outcome would not.

**The process lesson.** Nothing here broke a rule: the spec offer is made once
and was declined, and PROJECT_NOTES is deliberately written at branch end rather
than per commit. But those two habits together mean a long conversational branch
drifts from its archive by default, and the drift is invisible until someone
looks. Refreshing the spec chain belongs in the same branch-end pass as this
file, not after it.

**Two spec folders are missing from `.frame/specs/` while still being cited.**
`retire-rail-and-panels` is referenced by name in code comments and in
`sidebar-nav-groups`' `related:` front-matter, and has no directory at all.
`project-settings` has a directory containing only `status.json.bak`. Both were
`done` work whose reasoning is now unrecoverable except from the code — the
`settings-by-scope` spec had to reconstruct which of `project-settings`'
decisions it was overturning by reading `settingsModal.js` rather than that
spec's outcome. Worth an audit of the whole archive for other holes.

### [2026-08-27] Migration stopped asking about moves, and the dirty-tree deadlock is gone (spec: migration-consent-scope)

Shipped on `feat/migration-consent-scope`: ten tasks, eleven commits, `npm test`
green at 398 after every one.

**The deadlock, and why it was an ordering bug rather than a policy one.** A
legacy project opened, `CHECK_IS_FRAME_PROJECT` ran the stagers and
`WATCH_SPECS` ran `upgradeSpecDocs` — which resolves through `frameStore`, so in
an unmigrated project it rewrote the **root** `AGENTS.md`. Only then did the
modal ask for the plan, `dirtyAmong` saw ` M AGENTS.md`, and `canRun` came back
false with *"Commit or stash them, then reopen this project."* Stashing removed
the change, reopening re-ran the doc upgrade, the file was dirty again. Frame
dirtied the file and then refused to migrate because the file was dirty. The
whole blocking diff was one version stamp, `v=1` → `v=2`.

The fix is `frameProject.openProjectLayout()`: the migration plan is consulted
first, and either the move runs before any stager touches the project, or —
for the one genuinely unsafe state — nothing is written at all.
`specManager.startWatching` and the `WATCH_SPECS` stagers carry the same gate,
because those are separate IPC messages and the renderer decides which lands
first; a gate in only one place is a race.

**Decisions taken, with what they were taken against.**

- *The guard narrowed to unmerged paths only.* The spec's own loss table
  settled it: for every dirty state except an unmerged path, moving the file
  loses nothing — the content travels into `.frame/` and the pre-move blob
  stays in the index and in HEAD. Only `git merge --continue` can actually be
  broken. So a modified or staged meta file now migrates with its uncommitted
  content, and `dirty-tree` stops being a reason anything defers.
- *The `AGENTS.md` move and its prose rewrite were split.* Fused, they meant no
  legacy project could ever migrate silently — legacy init wrote an
  `AGENTS.md` into every project — so the fingerprint never cleared. Split,
  the file relocates byte-for-byte with everything else and only the prose
  waits on a click.
- *The pending decision is derived, never stored.* `pendingDecisions` asks the
  text — does `upgradeAgentsText` change bytes? — because after the move the
  stale file lives in `.frame/` and the fingerprint that would have found it is
  gone. Applying the rewrite empties the derivation, so nothing has to be
  recorded to stop the offer repeating.
- *Frame-planted symlinks are removed silently, not asked about.* Legacy init
  planted both in every project, so classing them as a decision puts a modal in
  front of every user Frame has. The accepted cost: `GEMINI.md` has no
  replacement, so Gemini CLI stops reading Frame's instructions there — named
  on the banner rather than asked about.
- *The deferral is permanent and lives in `userSettings`.* `.frame/config.json`
  is committed in `repo` mode, so a teammate would inherit someone else's "no"
  and never be offered the fix. Project Settings gained the way back in;
  before it, closing the modal made migration unreachable without restarting
  the app.

**One divergence worth naming.** `tasks.md` asked for the removed symlinks to be
named in the `migration.completed` label. They are recorded as a count instead:
`activityEvents.js` states outright that it carries no free-form string field so
no call site can introduce one, and that rule outranks the task's phrasing. The
banner names the files from the receipt it already holds, which is where naming
them belongs.

**Left open:** `LAYOUT_MIGRATION_PROGRESS` is still emitted from
`openProjectLayout` and no longer has a listener — the modal was its only
consumer. Either give the receipt a progress surface or drop the channel.

**What was and was not verified.** The main-process path was measured, not
assumed: `openProjectLayout()` was run against copies of ten fixtures covering
every branch, and every claim about migration, git state, moved files, symlinks
and sharing mode comes from that run. The renderer was **not** exercised —
the banner, the modal's rendering, the Project Settings row and the deferral
surviving a restart are unverified, because this project still has no DOM
harness. The fixtures and a checklist live at `~/Documents/frame-migration-test`.

---

### [2026-08-27] What verifying that migration turned up: init inverted file ownership, and it still is

The migration bug above is fixed. Verifying it surfaced a **separate, older
problem that is not fixed**, and the findings are written up in spec shape at
`.frame/specs/migration-consent-scope/followup-agents-ownership.md`.

**Read that document before changing anything under `.frame/` that touches
`AGENTS.md`, the `.claude/` write surface, `runProjectInit`, or
`layoutMigration`.** It is deliberately not registered as a spec — a teammate
is working inside `.frame/` and a new spec folder would collide with them — so
nothing in Frame's UI will surface it. It rides with the migration fix instead,
and it is on whoever touches this area next to read it and weigh the findings
rather than rediscover them.

**The finding.** Frame's pre-overlay init did not add its instructions to the
user's files. It did the reverse (`ee280c8`, "smart MD file merge on Frame
init"): it read the user's instruction files, **deleted three of them**, and
pasted their contents into a file it wrote itself, under
`## Existing Instructions (from <label>)` headings.

| Source | What init did |
| --- | --- |
| `CLAUDE.md` (root) | read → `unlinkSync` → replaced by a symlink to `AGENTS.md` |
| `AGENTS.md` (root) | read → `unlinkSync` → replaced by Frame's template, user text appended below |
| `GEMINI.md` (root) | read → appended → `unlinkSync` → replaced by a symlink |
| `.claude/CLAUDE.md` | read → **left in place** |

`non-invasive-overlay` had already established the rule this broke — *"a user's
root file is never read, moved or replaced"* — and `migration-consent-scope`
corrected exactly one quarter of it: a consumed `CLAUDE.md` is written back.
The other three are still sitting inside `.frame/AGENTS.md` today.

**What that costs, measured in `comeety` on 2026-08-27.** Every Claude Code
session there loads 57,581 characters of instruction files. Of
`.claude/rules/frame.md`'s 14,397 characters, **8,596 are a verbatim copy of
`.claude/CLAUDE.md`** — a file the agent already loads from its own path. That
is 14% of the project's entire instruction context, duplicated in every
session, and it is what makes Frame's file the largest in a directory of the
user's own rule files (Frame's actual content is ~5,800). The two are still
byte-identical only because `.claude/CLAUDE.md` has not been edited since init;
nothing re-syncs them, so the first edit turns exact duplication into two
contradicting versions of the same document, both in context at once.

**A second breakage, measured on a fixture.** `isFramePlantedSymlink()`
recognises only a symlink. A *real* `CLAUDE.md` whose body imports the root
`AGENTS.md` (`@AGENTS.md` — a documented Claude Code convention a user may
write themselves) is correctly left alone while its target moves into
`.frame/`. The receipt's review list comes back empty. End to end, Claude Code
reports *"one instruction file failed to load: `CLAUDE.md:5` imports
`@AGENTS.md`, but no `AGENTS.md` exists"* — the user's own instructions stop
arriving and Frame never said a word.

**Delivery paths, measured in isolated directories against Claude Code
2.1.247.** `CLAUDE.md` (root), `.claude/CLAUDE.md` and `.claude/rules/frame.md`
are each loaded, independently. A root `AGENTS.md` is **not** — alone in a
directory it produced `FOUND NONE`. An `@AGENTS.md` line inside `CLAUDE.md`
does pull it in. This is why handing a user's `AGENTS.md` back to the root
restores the pre-Frame truth but removes a visibility that works today, and why
that has to be reported rather than done quietly.

**The init side, and why it bounds the problem.** Today's init is already
clean: run against a project carrying all four files, it left every one
untouched and wrote a `.frame/AGENTS.md` with no `Existing Instructions`
heading and none of the user's text. So the only source of a mixed
`.frame/AGENTS.md` is a project initialised before `non-invasive-overlay`. The
concern is live at **both** stages, though, and for different reasons:
migration still has three un-restored blocks to give back, and init still says
nothing when a project already carries a user-owned `AGENTS.md` that Claude
Code will never read.

**Two questions left open on purpose**, at the end of the followup document:
whether the decision modal, its persistent deferral and its Project Settings
row (T08–T10, shipped in this same branch) should be retired once
`.frame/AGENTS.md` provably carries no user content; and whether
`.claude/CLAUDE.md`'s block is treated like the other three. In conversation
the second leaned toward *the same rule as the other three* — the block comes
out, the live file wins if it is still there, and it is written back only if
the original was deleted — but it is kept as a question because that is where
its consequences get weighed. The first is still genuinely undecided, and it
matters because answering it retires a surface this branch just built.

**Two recorded decisions would have to be reversed** and have not been:
`migration-consent-scope` C4 (*"AGENTS.md is user-owned. No content rewrite
without an explicit yes"*) and its Out of Scope entry declining to restore a
`GEMINI.md` equivalent. Whoever picks this up reverses them explicitly, here,
with the reason — not silently.
### [2026-08-27] Frame's context reached the agent by advice, not by mechanism — measured, then fixed (no spec)

The session started as an orchestrator bug report and turned into an audit of
how Frame's own context actually reaches an agent. Replayed against this
repository's Claude Code transcripts, the answer was uncomfortable: **what a
hook delivers arrives ~100% of the time; what prose asks for arrives 1–44%.**
`find-module.js` ran 18 times against 937 searches (~2%), and of nine sessions
that wrote a Frame meta file, four read the matching REFERENCE.md section
first, three read it only *after* writing, two never opened it.

**The regression is dated 2026-07-06, not the `.frame/` move.** Commit
`32aafc2` split AGENTS.md 327 → 94 lines and moved 257 lines of maintenance
rules into `REFERENCE.md`, replacing them with "loaded only when an agent is
about to write a meta file". Nothing was ever put behind that sentence. From
2026-01-25 to that commit the rules rode in the always-on file and reached
every session unconditionally. The user attributed the felt breakage to the
`.frame/` migration seven weeks later; the archive says otherwise. `find-module`
was not moved at all — its instruction was *compressed* in the same pass, from
twelve explained lines with three worked examples to four terse ones.

**Three hooks now carry what prose used to ask for.** `docs-hint.js` delivers
the conversation-level rules at `SessionStart` and a meta file's own section at
the moment it is written; `module-hint.js` answers a search from
`STRUCTURE.json`'s intentIndex on `PreToolUse`. Nothing was removed from
`REFERENCE.md` — delivery is sliced per section instead.

**Why per section: the host inlines a hook's `additionalContext` up to exactly
2000 characters**, then writes it to a file and hands the model a preview plus
a path — which silently converts guaranteed delivery back into optional
reading. Measured live by emitting numbered markers through a real hook and
reading where the preview cut, reproduced twice. The first attempt injected all
14.4 KB and delivered one and a half sections. The two sections that exceed the
ceiling (`Spec Knowledge Layer`, `Activity Monitor`) turned out to be the two
that contain no instruction to comply with, so they stay CLI-only. The size
invariant lives in `test/docs-hint.test.js` against the real document: if a
section outgrows the ceiling a test fails, rather than the rules quietly
ceasing to arrive.

**Two defects surfaced by using the thing, not by reviewing it.**
`process.stdout.write()` followed by `process.exit(0)` truncates past ~8 KB, so
the first `docs-hint` shipped unparseable JSON to the host; the same latent
pattern was fixed in `spec-hint.js`. And the Bash write-detector fired on
`diff … >/dev/null` in a block that merely *named* PROJECT_NOTES.md — a hint on
a read. Both are now regression tests, each verified red before the fix.

**Deliberately unchanged.** `AGENTS.md` still says to read STRUCTURE/NOTES/tasks
at session start while the decision this session was that they stay on demand,
and `REFERENCE.md`'s General Rules still carries the same instruction. Left as
is on the user's call. Two design decisions are worth keeping: data
(`STRUCTURE.json`, `tasks.json`) is pulled when needed, rules are pushed when
they apply; and a wrong hint is worse than silence — `module-hint` drops
`find-module`'s deep tier for that reason, after it hit 136 times on noise like
`kill` and `process` against 297 useful curated hits.

**No spec.** The offer was made once and the user chose to go direct. A parked
task from an earlier session, *"Make the find-module/grep orientation step
deterministic"*, describes this work and can now be closed; the older spec
`audit-q3-deterministic-graph-hints` covers the graph-based variant and was
deliberately left untouched.

### [2026-08-28] The spec decision gate never reached a terminal session, and why the protocol alone would not have fixed it

**The symptom.** Spec-driven work started from the Frame button behaves as
designed; the same command typed in a terminal produced a plan with no
decision gate — the stage that resolves business and technical forks *with
the user* through `AskUserQuestion` and records each answer under
`### Resolved plan-time decisions`. Plans made that way also lack
`## Footprint`, which is what orchestration's collision detection reads.

**Two independent breaks, and one of them was self-inflicted.** The flow lives
only in `spec.plan.md` (17 KB), never in REFERENCE.md. The button reaches it
through `buildSpecCommandFile`, which interpolates the template and hands the
agent one sentence. A terminal session was supposed to reach it through the
self-serve protocol `cli-spec-command-parity` wrote into REFERENCE.md — but
this repository's docs carry no managed-block marker, so Frame classifies them
`unmatched` and, by design, refuses to write over them. The protocol shipped
in 2026-07 and was never installed here. Frame's own repo had been outside its
own upgrade path for a month; a fresh project was fine the whole time.

**Fixed by installing the marker-wrapped section** (`renderSpecSection()`,
v=2), which both closes the break and hands the section back to Frame so
future upgrades land. That alone would still have left the flow depending on
an agent reading five prose steps, which this codebase now has a number for:
prose-delivered instructions run at 1–44%.

**So the protocol got a mechanism.** `spec-command-hint.js` on
`UserPromptSubmit` does what the button does — resolve the spec, interpolate
the current template, write it to `.frame/runtime/prompts/`, inject the
pointer. Two decisions worth keeping. Ambiguity is never guessed: one
candidate is taken silently, several are listed for the agent to ask about
with nothing staged, none is reported as none. And the hook duplicates
`specManager`'s resolution because it ships to `.frame/bin/` and cannot
require Electron main code — so a test asserts the staged prompt is
byte-identical to `getCommandPrompt`'s, because a silent divergence there
would return the terminal to exactly the state this fixes.

**Untested link.** Everything above is asserted; that a real session then
reads the staged file and runs the gate is not, and will be seen in use.

### [2026-08-28] `.frame/bin/` left git: reversing non-invasive-overlay T15, and the shell it left behind

**The number that started it.** Installing Frame into an empty Next.js project
produced a 31-file, 197,631-byte working tree, and **169,702 of those bytes —
86% — were `.frame/bin/`**: Frame's own parser and hook scripts, byte-identical
in every project that installs Frame. The user's first "added Frame" commit was
mostly a copy of Frame's source. Copying the scripts in is correct and was never
in question — they run outside Frame's process and a packaged build keeps its
code inside `app.asar` where no external process can reach it. The problem was
only that git tracked them.

**This reverses a recorded decision, and says so.** `non-invasive-overlay`
spec.md D6 classified `bin/` as runtime → ignored. T15 of that same spec
(`a8c1c8c`) reversed it *during implementation*, moved `bin/` to `derived` and
introduced `FRAME_TRACKED_DERIVED` to hold it tracked — and wrote the reasoning
into a code comment rather than back into the spec. It was solving something
real: tracked `.claude/settings.json` hook entries point at `.frame/bin/*`, so a
teammate cloning got hooks without scripts. Both of its rationales have since
lapsed. No released build ships the tracking (`git tag --contains a8c1c8c` is
empty, v2.6.0 predates it), the clone-without-Frame user does not exist while
Frame ships only as the IDE, and both worktree paths already fall back to an
absolute `bin/` path. Because a future reader meets the comment and not the spec
archive, the reversal is recorded *there* — naming T15 and each lapsed rationale.

**The mechanism changed nothing.** `getFrameGitignoreBlock` already builds the
managed block as `runtime ∪ (derived − FRAME_TRACKED_DERIVED)`; only its inputs
moved. Dropping `bin/` from the tracked list *alone* would have been actively
wrong — an entry in neither list appears in neither side and is ignored nowhere.

**Underneath sat a conflated question.** The Git sharing setting asked *"is
`.frame/` committed?"* when what the user answers is *"is my Frame context
shared with my team?"*. Sharing mode decides what **may** be shared; it should
not decide what is **worth** sharing. The row's copy now names the Frame context.
Deliberately nothing more: a promise about what is *not* committed is one the row
would have to keep true forever.

**Verified, not assumed.** A fresh `repo`-mode init is now 11 files / 24,927
bytes. `local` mode's `.git/info/exclude` is byte-identical to the pre-change
build — and getting that comparison honest took a second attempt, because the
"before" worktree had no `node_modules`, `require('electron')` failed inside the
sharing path, and the run silently skipped writing the block at all. A false
pass that looked exactly like a real one. The linked-worktree `--git-common-dir`
fallback, previously the exception, is now the normal path and was run end to
end: it resolved the parser through the main worktree and wrote *that
checkout's* `STRUCTURE.json`, leaving the main one alone.

**Frame's own repo is the deliberate exception.** Its 24 committed
`.frame/bin/` files stay tracked as a worked example of what Frame writes into a
project. Accepted cost, verified rather than assumed: a tracked file under an
ignored directory still reports ` M`, but an untracked sibling does not appear at
all — so a *new* script added here later needs `git add -f`.

**Then switching modes exposed a neighbour.** Going `repo` → `local` left
`.claude/settings.json` holding a bare `{}`. `removeSpecHintHook` strips Frame's
entries and writes back what is left, and in a Frame-initialised project Frame's
hooks *were* the whole file; nothing excludes `.claude/settings.json` in `local`
mode, deliberately, because in `repo` mode it is the team's shared file. It now
deletes the file when nothing is left — but only while it is untracked, which is
the same line `gitSharing` draws around `git rm`: untracking someone's committed
files is their call. Three tests, each verified against a different wrong
answer: disabling the guard fails one, making the deletion unconditional fails
the other two. After it, a `repo` → `local` switch leaves `git status`
completely empty, which is local mode's whole promise.

### [2026-08-28] Two settings-surface bugs, found by using the thing, with unrelated causes

Both turned up testing the footprint change on a scratch Next.js project — not
by reviewing the diff. Neither is in the spec; they are recorded as their own
tasks and committed separately on this branch.

**The init modal's sharing choice was a cascade accident, not a design.** The
two options rendered as a stretched radio with its glyph centred and the title
running into the description as one paragraph. The design was written correctly
— `.init-modal-sharing label { display: grid }` — but `.modal-body label
{ display: block }` and `.modal-body input { width: 100% }` sit *further down
the same file* at equal specificity (0,1,1) and won on source order. A rule can
be right and still never run. Qualifying the sharing rules with `.modal-body`
keeps them off, and the native radio is now out of the flow with a drawn dot
beside it, reusing `.welcome-tool-option`'s existing pattern rather than
inventing one.

Three layouts were offered; **stacked cards won over side-by-side and over a
segmented toggle**, because at 520px a side-by-side card is ~230px and the
descriptions run 6-8 lines, and a toggle hides one option behind the other on a
one-time, consequential choice about the user's git history — the two have to be
comparable at a glance.

**Project Settings lied about the project's state, in both directions.** The
setup row always read "Remove Frame from this project": a folder Frame was never
initialized in offered to remove nothing, and a project just removed went on
offering to remove it again. One cause for both — `syncFromProject()` syncs four
rows and never this one, and the removal handler re-syncs git sharing and the
spec-driven toggle while leaving the row it lives in untouched. Worth keeping:
every piece of plumbing needed already existed and was already exported —
`getIsFrameProject`, `initializeAsFrameProject`, `onFrameInitialized` — so the
fix added no IPC. The bug was never missing capability, only that nobody called
it.

**Left undone, on purpose.** Neither fix carries a test: renderer modules have
no DOM harness in this repo and jsdom is not installed, so covering them means
introducing the harness first. Said plainly rather than quietly skipped.

**Branch.** `feat/frame-bin-out-of-repo` was renamed
`fix/frame-footprint-and-settings-ui` rather than splitting the UI work off —
the user's call, to avoid juggling branches. The name now covers what is
actually there: Frame's footprint in the user's repo, and the two surfaces that
describe it.

### [2026-08-31] Feedback from inside Frame — and four decisions reversed while building it

**What shipped.** A Feedback row in the sidebar's Frame group opens a three-tab
panel: **Bug** files a prefilled GitHub issue, **Feature idea** opens a
prefilled discussion under Ideas, **Reach us** opens a mail draft to three
personal inboxes. One table in `src/shared/feedbackReport.js` holds each kind's
label, prompts, channel and diagnostics flag; `compose()` is the only code that
builds a body, and the transports may only encode it.

**The reversals, because they are the point.** The spec planned a `gh issue
create` path with a fallback ladder, GitHub labels per type, and one form with
two channel buttons. All of it was built (T01–T10) and then undone in the same
branch:

1. **`gh` removed.** It publishes the moment it is called, under whichever
   account is signed in. The reporter never sees the rendered markdown, cannot
   fix a sentence, and cannot drag in a screenshot — which the spec had already
   conceded no transport could carry, and which a browser form carries for
   free. Deleted `feedbackManager.js`, the IPC channel and the failure
   classifier.
2. **Labels gone with it.** GitHub ignores `labels=` from anyone without triage
   permission, so the URL could not keep the promise argv had been keeping.
3. **The channel stopped being the user's choice.** Two buttons on one form
   asked a question nobody can answer — a reporter knows what they have, not
   which transport suits it. Three tabs ask what they can answer, and split by
   visibility at the same time: the GitHub tabs are public and signed with the
   reporter's account, Reach us is not.
4. **A feature request became a discussion.** In a tracker a proposal is an
   unassigned task that reads as a rejection when closed; a discussion can be
   argued, upvoted, and converted into an issue by GitHub the day the work is
   committed to. It attaches no diagnostics — an idea does not depend on the
   machine it occurred on.

**Worth keeping.** None of this cost much, and the reason is the invariant the
spec was built on: one composer, transports that can only encode. Every
reversal changed *where a report goes*, never *what a report says*, so it
touched routing and copy and left the tested core alone.

**Left undone, on purpose.** No test covers the panel — renderer modules still
have no DOM harness in this repo (D4). The panel was verified by the user in
the running app, not by a test. `spec.md` and `plan.md` were corrected in place
with a Revision history rather than rewritten to look like the plan was right;
`tasks.md` is left as executed.

**Documents drift when you change your mind mid-branch.** The habit that made
this cheap to reconcile: an `outcome.md` entry per commit naming the divergence
as it happened, so the closing pass was editing four known spots rather than
re-deriving history.
### [2026-09-01] The report pipeline leaked at both ends (spec: fix-report-staging-and-opening)

Two failures that look unrelated and are the same failure: the file the agent
*reads* and the window the result *lands in* were both decided somewhere other
than where they are described.

**Two staged copies, one of them stale.** `plan-report-template.html` and
`build-implement-report.mjs` were staged into two directories by two
mechanisms — `commandStaging.stageCommandFiles()` into
`.frame/runtime/commands/<tool>/` on project open, and
`specManager.stageCommandAsset()` into `.frame/runtime/assets/` on every
dispatch. In this repo the first was 440 lines and the second 291, and
`{report_template_path}` pointed at the 291-line one. So `/spec.plan` had been
building its report from a template the in-app viewer classifies as *pre-shell*
— the very report work we shipped two days earlier, invisible to the command
that generates the report.

Worth recording *how* that happened, because it is a failure mode we will hit
again. `cli-spec-command-parity` T05 was titled "routed all staging through
commandStaging" and it removed `stageImplementCommandFiles` — but not
`stageCommandAsset`, which read as a separate concern (*asset* staging) rather
than as the thing being superseded. The same day, the docs work wrote the
placeholder table pointing at the new location. **Documentation moved, the
substitution didn't, and nothing failed loudly.** A consolidation task that
names its target by mechanism ("route all X through Y") should enumerate what
it is deleting, or the second implementation survives by not matching the
description.

**This deliberately reverses a constraint we recorded ourselves.**
`spec-reports-one-shell-two-themes-in-app` names `.frame/runtime/assets/` as
the staging location a shared shell must survive. That is the location this
spec retires. The constraint's *reason* — the CLI cannot read inside
`app.asar`, so the asset must reach disk — is untouched;
`commands/<tool>/` is equally outside the archive and is tool-scoped besides.
Overturned explicitly rather than silently, which is what the spec layer is
for.

Deleting the second stager had a cost that was not obvious: it was the thing
providing *per-dispatch freshness*, so a project override edited between
project opens reached the next run. `stageCommandFiles` therefore stopped
being an implement-only call and now runs on every spec dispatch. And the
directory is *removed*, not merely orphaned — prompts staged before the change
carry the interpolated old path, so a leftover file stays reachable, and
stale, by re-running an old prompt.

**Plan-time decisions worth keeping.**

- *Both* reports auto-open, not just the implement one. The plan report was the
  half that opened nowhere at all, which is where the request started.
- **Foreground by origin.** A run dispatched from this window brings its report
  to the front, matching what clicking **View Report** does. Anything else — a
  conductor worker, another window, a hand-run CLI session — gets a background
  chip. Four parallel workers must not throw four tabs over the user's work.
  The *absence* of an expectation is the origin signal; no flag travels with
  the report.
- **The app notices; the agent says nothing.** `listSpecs` carries a `reports`
  array and the existing `.frame/specs/` watcher does the rest. Chosen over a
  dedicated `SPEC_REPORT_READY` channel because what is being detected is a
  *state change, not an event*: an array that stays identical across the
  implement run's per-task regenerations cannot open a second tab, and a push
  dropped by the self-write guard is recovered by the next one. Rejected
  explicitly: having the agent announce it — an instruction the agent can skip
  is exactly how the staging divergence arose.
- **Emitted only when non-empty.** Measured on this project (45 specs, 17 with
  a report): always-present booleans grow the SPEC_DATA payload 21.9%,
  `reports`-when-present grows it 4.1%.
- **`$FRAME_NODE` is the marker for "a Frame window is hosting this session".**
  `ptyManager` injects it into every PTY Frame spawns, so one condition in the
  generator covers both the UI dispatch and the CLI hint path. The alternative
  — making `--open` conditional in the template — needs a new placeholder
  filled correctly on two interpolation paths.

**Left untested, again, and on purpose.** T06 and T07 are renderer modules and
this repo still has no DOM harness — no jsdom, playwright, testing-library,
puppeteer or happy-dom in `package.json`, re-verified during planning. The
plan settled that as the posture rather than smuggling a harness in mid-spec.
T07's diff logic was checked by hand against a stubbed host instead (baseline
arms silently, unexpected report → background, expected → foreground,
regeneration → nothing). This is the third branch in a row to say this; the
harness is a real decision someone has to make deliberately.

**A dogfooding artifact, clarified at the end of the session.** After the run,
the staged copy in this repo's `.frame/runtime/commands/claude-code/` was still
the pre-T04 generator, because nothing had re-run staging since the edit. That
drift is specific to developing Frame inside Frame: in a user's project
`src/templates/` lives inside the installed app, so the only thing that can
change the source is a Frame update, and project open restages it. The
user-facing analogue is a project's own override under
`.frame/templates/commands/<tool>/` — and that is precisely the freshness the
unconditional `stageCommandFiles` call preserves.

**Branch.** `fix/report-staging-and-opening`, seven tasks run in autonomous
mode, one commit each, `npm test` green throughout (484 → 486). Two earlier
branches merged on 2026-08-29 — `new-spec-agent-handoff` and
`spec-reports-one-shell-two-themes-in-app` — are still unrecorded here; their
sessions are not in this conversation, and reconstructing their reasoning from
commit messages would be invention rather than context.

### [2026-09-10] A VS Code-style dock for the readonly views (spec: dock-panel-readonly-views)

The user, opening the session:

> şimdi ciddi bir ui değişikliğine gideceğiz frame içinde. bazı kullanılmayan
> ve readonly ekranlar var. Bunları proje altındaki menuden kaldıracağız.
> vscode gibi bir yapıya geçmemiz lazım. ya native menu var ya edit view gibi
> pencere üzerinde oradan açacağız ya da footer menusundeki iconlarla ya da
> ikisi birden. açılacak yerler alttan ya da sağdan bir section ile açılmalı.
> vscode terminal vs gibi. readonly ekranlar şu şekilde: decisions structure
> prompts ve activity. feedback'i de bu menuden kaldırıp footer'a koyabiliriz.
> ayrıca proje özelindeki ayarlar sol alt yerine proje altındaki menuye
> konumlanmalı. ayrıca bunların tümü native menuden açılabilir olmalı. Github
> menusunu de en sola alalım. Proje altından kaldıralım oraya koyalım.

Three forks were put to the user before the spec was written, and two more
at the plan's decision gate. Answers, all on 2026-09-10:

- **Spec, not direct.** 10+ files and five prior spec decisions to reverse.
- **Dock position:** bottom by default, movable to the right, persisted.
  (Rejected: bottom-only, right-only.)
- **Entry points:** native View menu **and** status-bar icons. No in-window
  menu bar — on macOS it would duplicate the system menu.
- **Project Settings in the nav:** a single ungrouped row pinned at the foot,
  below Context. (Rejected: a one-row "Project" group.)
- **Tests:** pure logic only — `dockState.js` + `test/dockState.test.js`,
  the project's convention for renderer code.

Decisions from earlier specs this reverses, on purpose and by name:
`decisions-view` (Decisions as a center view, Structure as a nav item),
`sidebar-nav-groups` (Frame group; Settings staying on the rail),
`settings-by-scope` (Project Settings at the rail's foot — only its address
changes), `in-app-feedback` (Feedback row in the Frame group), `status-bar`
(the left slot "left empty" — it now takes the dock icons ahead of the
other-projects agent indicator).

One drift caught while planning: the spec named `RUN_COMMAND` as the
menu→renderer message, but that channel types its payload into the active
terminal (`menu.js:250` → `terminal.js:135`). The plan adds
`RUN_APP_COMMAND` carrying a command-registry id, and every entry point —
menu, status bar, palette, shortcut, nav row — goes through the registry.
`TOGGLE_HISTORY_PANEL` retires with its only sender.

Two dormant specs list files this plan touches (`audit-q3-performance-resources`
on `index.html` / `structureMap.js`, `audit-q3-cross-platform` on
`ipcChannels.js` / `index.js`); neither has a worktree or activity in two
weeks, so the overlap is accepted and `terminalManager.js` is kept out of the
footprint. The uncommitted specs-drawer / agent-picker work in the tree that
day is unrelated and left alone.

Spec chain: `.frame/specs/dock-panel-readonly-views/` — `spec.md`,
`plan.md`, `plan-report.html`; phase `planned`, next `/spec.tasks`.

### [2026-09-11] The Claude row split: Sessions under Context, Plugins behind the rail's foot button

The user, opening the session:

> Sol section'da projenin altında Work var. Onun altında da Claude sayfası
> var. Burayı güncelleyeceğiz. Buranın içindeki sessions Context seçeneği
> altındaki specs tasks altına sessions olarak gelecek. Plugins şimdilik sol
> sectionda en alttaki feedback butonu üzerinden açılsın.

Done directly, not as a spec: every surface already existed, only its
address changed. The Claude panel (`pluginsPanel.js` + `#plugins-panel`,
two tabs) split in two:

- **Sessions** is a row under Context, after Specs and Tasks — a session
  list is project history, the same kind of thing as the other two rows.
  New module `sessionsPanel.js` (the old Sessions tab, unchanged data path
  over `LOAD_CLAUDE_SESSIONS`), element `#sessions-panel` with the shared
  `.dock-view-header`, hosted in the center by `multiTerminalUI`'s
  `PANEL_REGISTRY` under the key `sessions`. The row opens it with
  `showPanel`, like its Context siblings, not `togglePanel` like the Claude
  row did. Palette "Go to Claude" → "Go to Sessions"; Home's Last Sessions
  card lands on it directly (no tab to switch any more); the
  `CmdOrCtrl+Shift+X` command became `panel.toggleSessions`.
- **Plugins** is its own modal (`#plugins-modal`, the shared modal chrome,
  owned by `pluginsPanel.js`) behind a Plugins button at the foot of the
  sidebar rail, directly above the Feedback button, "for now" in the user's
  words. A first cut had parked it as a fourth tab *inside* the feedback
  modal; the user corrected that in the same session:

  > Plugins buttonunu Feedback içinde ekledin yanlışlıkla. Feedback buttonu
  > üzerine ekle demiştim aslında. En sol alt menude feedback buttonu var.
  > Onun üzerine plugins buttonu ekleyip ona basınca açalım.

  So the feedback modal is back to its three kinds and knows nothing about
  plugins. The rail's foot is a pair now — Plugins, then Feedback — with
  `.sidebar-rail-btn-foot` on the first pushing both down. Installing a
  plugin hides the modal so the terminal running the install is on screen.
  `TOGGLE_PLUGINS_PANEL` (no sender in main) toggles the modal.

The Work group is Terminals and Orchestration only. Where Plugins finally
lives is an open question — the "şimdilik" is recorded here on purpose.

### [2026-09-11] Native menu restructured: File / Edit / View / Go / Project / Terminal / AI / Window / Help

The user opened with the menu bar:

> Uygulamada native menu var ya en üstte pencere çubuğunda. Uygulama adı
> edit view help gibi. Oraları bizim frame özelinde güncellememiz lazım.
> çoğu şey view altında ve karışık gibi. buralarda nasıl menuler ve alt
> menuler oluşturabiliriz analiz et geliştirme yapma şimdilik tartışalım

Analysis found View holding four unrelated things (dock tabs, panel
layout, GitHub / Project Settings, Electron dev roles + zoom), the AI-tool
root labelled "Claude Commands" with Start buried at the bottom, and only
10 of the ~30 registered commands reachable from the menu at all (no
Project, Terminal, Go, Sidebar, dashboards, palette, shortcuts, welcome).
No Window menu on macOS, no Select All.

Two architectural options were put to the user: keep the hand-written
template in `menu.js` (labels and accelerators copied from
`registerCommands()`), or feed the menu from the registry over a
renderer→main IPC so nothing drifts. The user asked what the problem with
the current way actually was; answer: none mechanically, only a
maintenance cost that grows with item count. Decision: **keep the
hand-written template**, defer registry-fed menus and greying-out of
items whose `when()` is false.

Decisions in the user's words:

> checkbox ve radio yapmayalım toggle panel kalabilir.

> Go ve Terminal ayrı olsun, AI kökte kalsın, Project kökü açalım

> task olarak gir ve doğrudan yap

So: no checkbox / radio state in the menu (main does not know the dock's
state; the AI-tool switcher keeps its radio group because that state
lives in main). The Appearance submenu proposed earlier was dropped with
the radios — four flat items do not earn a level. Go and Terminal are
separate roots as in VS Code. The AI tool stays a root, labelled with the
tool's plain name (no "Commands" suffix), Start first. A **Project** root
holds current-project actions (Project Settings…, Initialize as Frame
Project, Open Orchestrator); **File** holds workspace-level opening
(Add Project to Workspace…, Create New Project…, Open History File) — the
File → Open Folder analogy. Open History File moved out of the AI menu
(tool-agnostic), Orchestrator moved out of it into Project.

Implementation is `src/main/menu.js` only: every non-role item goes
through `sendAppCommand(id)` over `RUN_APP_COMMAND` (dock-panel-readonly-
views C6 kept, no in-window menu bar kept). Accelerators copied from the
registry; ⌘Tab / ⌘1–9 / ⌘B etc. are now menu accelerators as well as
renderer shortcuts, the same duplication ⌘J already had. Tracked as
`task-native-menu-restructure` in tasks.json rather than a spec, being a
single-file change.

### [2026-09-11] PR #145 merged, then hardened: the login-shell PATH probe

**Where this came from.** An external contributor (PR #145) fixed the
"gh CLI not installed" report on machines that have `gh`: a packaged app
launched from Finder inherits launchd's `/usr/bin:/bin:/usr/sbin:/sbin`,
so `exec('gh')` in `githubManager` got ENOENT while Frame's own terminals ran
`gh` fine (the PTY starts a login shell). The PR added `src/main/envPath.js`,
which asks the user's interactive login shell for `PATH` once, merges it ahead
of the inherited one, and hands `childEnv()` to the three `gh` calls.

**The review, and the call the user made.** The fix was verified end-to-end
here under a simulated Finder launch and the full suite was green on main and
on the branch. Review turned up ten findings, none of them regressions — all in
the class "the repair does not reach some users". The user's decision was
"merge it and do the corrections ourselves", on the reasoning that the PR's
worst case is the status quo (a failed probe degrades to the inherited PATH)
and that 2.7.0 had just shipped, so main was not going out the door. Merged
as `de5bd41` with a merge commit, matching the repo's convention; the author
got a comment listing the findings and the follow-up plan.

**What the follow-up branch (`fix/envpath-followups`) changed, and why.**
- A `null` probe result is no longer memoised for the process lifetime. A
  Login-Item launch with a slow `.zshrc` would otherwise have disabled the fix
  until relaunch. It is retried after a 30s cooldown rather than on every
  click, so a genuinely broken rc does not re-pay a 6s shell startup each time.
- The timeout now sends SIGKILL. Measured on this machine: interactive zsh
  ignores SIGTERM and runs to completion, so the PR's kill was a no-op and a
  hung rc would have leaked an orphaned login shell.
- The PATH is bracketed by start *and* end sentinels. `zsh -l` runs
  `.zlogout` after the command; an `echo` there fused onto the last segment
  (reproduced: `/binbye`). A complete sentinel pair is now accepted regardless
  of exit code, and if it is not present on `'exit'` the probe waits for
  `'close'` (Linux libuv can reap the child before the last stdout chunk).
- The shell comes from the passwd entry first, then `$SHELL`. The PR's code
  did the opposite of its own comment; a launcher exporting `SHELL=/bin/sh`
  would have produced a "successful" probe with the wrong PATH and no warning.
  `aiToolManager` now imports the same `loginShell()` and timeout from
  `envPath` instead of keeping a copy, so both probes consult the same shell.
- The probe argv branches on shell name like `ptyManager` does: tcsh/csh get
  `-c` only (they reject `-ilc`), nushell joins `$env.PATH` itself. fish was
  *not* a problem — it colon-joins path variables in double quotes; an earlier
  claim in the session that it space-joins was wrong and corrected.
- `probeCoreDeps()` in `index.js` uses the repaired PATH too, or the startup
  banner would keep saying "gh was not found" while the panel worked.

**Deliberately not done.** Writing the merged PATH into `process.env.PATH`
once the probe resolves would fix the ~20 other `child_process` sites in
`src/main` (ten of them synchronous, so unable to use the async `childEnv()`)
with no call-site edits. That is an architecture decision that touches
`structureBootstrap`, `ptyManager`, the git managers and more; it is held for a
separate conversation rather than slipped into a hardening PR. Folding
`aiToolManager.isCommandAvailable` into `envPath` also stays out, as the PR
author proposed.

### [2026-09-13] Home: 50/50 split, Agents launcher first

The user asked for a UI/UX pass on Home: the title should read "Welcome to
Frame!" rather than the project name; the board's height should split
50/50 — Last Sessions, Active Specs and Active Tasks in the bottom half at
equal width and height, and a full-width area on top where the running
agents are listed and the agent picker + Start button are the prominent
element, so a first-time user understands the agent is started from here.

**What changed.** This overturns the `home-widget-board` spec's T04
decision (one flat `auto-fill` grid, no imposed reading order) explicitly:
Home now has a reading order, and it starts with Start. `.home-grid` is
`repeat(3, 1fr)` × two `1fr` rows; the first registry widget (Agents) is
spanned across the top row by CSS (`.home-grid > .home-card-agents`), not
by `defaultSpan`, so the widget contract is untouched. Cards drop the
232px floor in the wide layout (each half of the board is their height, the
body scrolls) and get it back under a `@container (max-width: 759px)`
query, where everything stacks in one column. The board keeps a 460px
floor so short windows scroll rather than squeeze.

The Agents launcher moved from the card footer to a highlighted panel
above the list (`.home-agent-launcher`, accent-tinted, with a "Start an
agent" lead and one line of hint), and its picker/button are drawn at 36px
instead of the header's 28px. Running agents render as tiles
(`.home-agent-grid` / `.home-agent-tile`, name on top, state underneath)
because the card is now wide and short rather than narrow and tall. The
header keeps project name + branch as a quiet second line under the
greeting.

Verified by launching the Electron app under Playwright at 1400×900 and
950×900 and reading the screenshots; `npm test` passes (623).

### [2026-09-13] Dock tab shortcuts and drag-to-reorder tabs (the first `dnd/` primitive)

The user asked for three things on the dock the footer opens: a unique,
unused shortcut for each tab (Prompts already had ⌘⇧L), shown both in the
hover tooltip and in the native menu; drag-and-drop reordering of the
dock's tabs, persisted locally so Prompts dragged to the front is still
first after a relaunch — while the footer buttons keep their order; and
that the drag-and-drop be built as a structure we will lean on heavily for
a VS Code-like flexible layout later.

**Shortcuts.** All three tabs sit on the ⌘⇧ layer with the other view
toggles (D Tasks, S Specs, G GitHub, X Sessions): ⌘⇧Y for Decisions (the
project's "why"; D and E are taken, I is DevTools on Windows/Linux), ⌘⇧L
stays with Prompts, ⌘⇧A for Activity. `dockState.TAB_SHORTCUTS` is the
renderer's single source — the command registry, the status-bar tooltips
and the strip's tooltips read it; `src/main/menu.js` carries the same
accelerators by hand (main cannot share the renderer bundle; the existing
"keep in step" convention). The native menu shows the accelerator beside
the item the way macOS/Windows render every menu shortcut, so no
parenthesised copy was added to the label — that would show the shortcut
twice. Hover on a footer icon or a dock tab shows "Decisions (⌘⇧Y)".

**Reorder.** `src/renderer/dnd/reorder.js` (pure: `moveItem`, `moveId`,
`normalizeOrder`) and `src/renderer/dnd/sortable.js` (`makeSortable`,
pointer-event based — not HTML5 drag-and-drop, whose ghost image, missing
threshold and per-platform quirks in Electron ruled it out) are the
reusable primitive. Press + 4px moves lifts the item, crossing a sibling's
midpoint slides it into that slot live, release fires `onReorder` once
with the new id order, Escape restores. The dock's strip is its first
caller: `dockState` gained `order` (a permutation of `TABS`, normalized on
load so a saved order that is missing tabs or names parked ones is
repaired) plus `reorder`/`setOrder`; the strip is built in `state.order`
and persisted under the same `frame-dock` key. `TABS` stays the canonical
order and the status bar keeps using it, so the footer never moves.

Verified in the running app under Playwright (the script lives in the
session scratchpad, not the repo): tooltips, all three shortcuts opening /
switching / closing, live reorder during the drag, persistence across a
reload, footer order unchanged, Escape cancel, click-after-drag, and the
View menu's accelerators. `npm test` passes (686, including 13 new
dockState/reorder cases).

### [2026-09-13] GitHub view rebuilt as tree sections (github-view-tree-layout)

The user asked to generate the spec's tasks and then "implement and complete
them in order". Eleven tasks, all shipped in one session; the chain is
`.frame/specs/github-view-tree-layout/` (spec → plan → tasks → outcome).

**Shape.** The sidebar's GitHub tab is now four stacked, collapsible
sections — Pull Requests · Issues · Branches (with a Remote sub-group) ·
Worktrees — of 22px rows in the Changes tab's idiom, one filter field, and
an access-state block that tells `gh` missing, `gh` not signed in (a Sign
in button that runs `gh auth login` in a new lane) and not-a-GitHub-remote
apart. The tab strip, filter strip, repo-name bar and the "Coming Soon" PRs
placeholder are gone; the repo name sits in the head. This **reverses**
`dock-panel-readonly-views` D8 ("keeping its refresh / filter /
create-branch chrome") — recorded in plan.md, not silently. The rail tab,
`sidebar.github` (⌘⇧G) and the Create Branch modal stand.

**Where the logic lives.** Pure and tested under `src/renderer/github/`:
`sectionState.js` (which sections are open, persisted app-wide under
`frame-github-sections`, mirroring `dockState`), `accessState.js` (payload
→ state → section availability → copy), `rowModels.js` (PR / issue /
branch / worktree → row view-model, filter, `issue-<n>-<slug>`, relative
time). `githubPanel.js` is the DOM host only. Main runs the `gh` access
check once per project and caches it (`githubManager.checkAccess`); three
new channels (`GITHUB_ACCESS_STATE`, `LOAD_GITHUB_PULL_REQUESTS`,
`CHECKOUT_GITHUB_PR`); PR links reuse `OPEN_GITHUB_ISSUE`. Terminal lanes
reach the panel through an `openLane` hook injected from `index.js`.
Branch delete / force delete and worktree remove / force remove use
`taskConfirmModal`, which grew `heading` / `message` / `confirmLabel`
options — one confirm discipline, no second modal, no `confirm()`.

**Two things found on the way.** (1) `gitBranchesManager.loadBranches`
listed `refs/remotes/origin/HEAD` as a local branch named `origin`: its
`%(refname:short)` is plain "origin", so the `includes('HEAD')` filter
missed it. It now formats `%(refname)` too and filters by that; payload
unchanged. (2) At the sidebar's 180px floor the panel itself is ~100px
wide, so "Pull Requests" cannot sit beside its count; each section title
carries a long and a short form ("PRs", "Trees", "Branch") swapped by a
container query below 170px of panel width, where row meta is hidden too.

Verified in the running app under Playwright (script in the session
scratchpad): 280px / 180px / 320px layouts, expand and persist, Remote
sub-group, hover actions, filter with counts, context menu, the delete
confirm with Cancel focused and Enter cancelling. Pull Requests and Issues
were seen only in the `no-auth` state — this machine's `gh` is not signed
in — so their live rows rest on the row-model tests. `npm test`: 686 pass.

### [2026-09-13] The center goes flat: VS Code density right of the sidebar (compact-center-vs-code-density)

The user sent two screenshots — Frame with one enlarged terminal, and VS
Code — and said: "sol panelle sağ tarafı ayırdık ui'da. ancak sağda çokça
padding var. vs code gibi daha compact bir görüntü olmasını istiyorum. bu
paddinglerin olmaması lazım." Then: commit what's there, open a spec, plan
it, generate tasks, implement in guided mode. The chain is
`.frame/specs/compact-center-vs-code-density/`.

**Diagnosis.** The spacing tokens were not the problem (4/6/10/14/20px);
the nesting was. Every level of the DOM was its own rounded card inside the
one above: `#terminal-container` (6px margin, 10px padding, left radius on
`--bg-deep`) → a rounded 42px tab bar → `.terminals-view` (10/14/14) → a
bordered `.tv-pane-single` with a darker background → padded content.
Measured 37px from the sidebar's border to xterm's first column and 58px
from the top to the tab bar's border. After: 4px and 35px.

**Decisions taken with the user.** Home's gutter goes 24 → 12px so every
surface shares one left edge (a 12px jump on Home → Terminals would read as
a bug). The enlarged pane's header is thinned to 24px, not removed — it is
the only place the status vocabulary, the assignment chip and the pane
actions live (terminals-home-agents), and removing it would need JS.
Silent: the dock loses its margin/radius/outer border and keeps one inner
hairline on the resize-handle edge; the tab bar is 35px because its
controls are 32px; grid panes keep their border (it is the separator) with
6px between them and nothing around; the "panes darker than the chrome"
prototype language now applies to the grid only; no new tokens; no tests
(the testing record has no path to a stylesheet).

**Why no JS.** `terminalsView.js` refits xterm through a `ResizeObserver` on
`.tv-pane-content`, so padding edits refit on their own; `dock.js` measures
the center as clientWidth minus the container's computed padding, so a
padding of 0 subtracts 0 and the clamp is unchanged.

**Shipped.** Seven tasks, seven commits on `feat/compact-center-vs-code-density`
(`layout.css`, `terminal.css`, `terminals-view.css`, `dock.css`,
`view-header.css`, `home-board.css`); `npm test` 688 pass after each.
Not verified in the running app during the run — the user should open an
enlarged terminal, the grid, the dock at both positions and both themes.
Sidebar density (14px panel padding, rail, nav indents) is deliberately
untouched and is the next spec if wanted.

### [2026-09-13] Branch picker on the status bar (status-bar-branch-picker)

**The ask.** "Sol altta git branch'i var. Buna tıklayınca VS Code gibi var
olan branch'leri popover gibi gösterip seçtirebilir miyiz? Local branch'ler
mi, local + remote mi listelenmeli?" — and, once it became a spec, whether
it should be a dock tab or a popover.

**Decisions taken with the user.** A popover anchored to the indicator, not
a dock tab: a checkout is a transient act, the dock is for content that
stays open and shows one tab at a time. Both scopes, separated: local first
(current pinned, then newest commit — `%(committerdate:unix)` added to the
existing `git branch -a` format), remote branches below a divider and only
those without a local twin. Branches checked out in another worktree are
dimmed up front with "in worktree <folder>" rather than left for git to
refuse, because the orchestration's `frame/<slug>/work` branches make that
common. Tests: pure logic only (the project's convention; no DOM harness).

**Silent decisions.** No new IPC channel or payload change — main tells a
local ref from a remote one itself (`refs/heads/` first, then a split
against `git remote`), so the GitHub view got the multi-remote fix without
changing; `ipcChannels.js` was in `audit-q3-cross-platform`'s in-flight
footprint and stayed untouched. The two mutating git calls the spec touched
moved to `execFile` (`execGitArgs`); the shared validator
`src/shared/gitRefNames.js` bans shell metacharacters git would accept,
because a branch named `$HOME` is hostile to every script run afterwards.
The picker never fetches: opening is three reads.

**Shipped.** Eight tasks, eight commits on `feat/status-bar-branch-picker`:
`gitRefNames.js`, `gitBranchRefs.js`, `gitBranchesManager.js`,
`statusBar/branchPickerModel.js`, `statusBar/branchPicker.js`,
`statusBar.js`, `githubPanel.js` (`revealSection`), `status-bar.css`; three
new test files, `npm test` 724 pass after each task. Verified against a
scratch repo with two remotes and a second worktree (tracking branch from
`upstream/`, git's "already used by worktree" refusal verbatim, dirty tree,
injection-shaped name creating nothing). Not exercised in the running app
during the run — the user should open the picker, filter, switch, try a
dirty tree, Escape, and the dock open at the bottom, in both themes.

### [2026-09-13] Boards done window — recent done by default, phases under Active

Started from a UI complaint: after the Specs filter row became a segmented
control plus five phase chips, it wrapped at ordinary widths, and the user
asked whether a period filter (today / this week / last 10 days, or a date
range) should be added, on both boards. The numbers settled it — 510 of 570
tasks completed, 41 of 46 specs done — so the pile is entirely at the done
end and a time filter on live items would hide the cards the boards exist to
show.

**Decisions taken with the user.** A window on done items only; a default
with one reveal control per board instead of a filter the user operates;
a Project Setting with two values (tasks 7 days, specs 30) rather than one
machine-wide number; phase chips only while Active is selected, since every
phase is a subset of Active. The fourth item — sort the spec grid by last
update — already held (`specManager.listSpecs` orders by `updated_at`).

**Silent decisions.** Search bypasses the window (a query is explicit
intent). Specs are aged on `updated_at` (the renderer payload has no
`last_phase_at`); a done item with no usable date counts as recent. Pure
logic in `src/shared/doneWindow.js` and `src/renderer/specs/filterModel.js`;
one renderer store `src/renderer/doneWindow.js` owns the value (modal
writes, boards subscribe). Two new invoke channels beside the git-sharing
pair — additive edits in `audit-q3-cross-platform`'s and
`audit-q3-performance-resources`'s footprints. Hidden Completed cards stay
in the DOM so drag-and-drop commits the full file order.

**Shipped.** Seven tasks, seven commits on `feat/boards-done-window`;
`npm test` 752 pass. Verified: the new modules under `node --test` and the
filter row / ghost tile by headless render in both themes. Not exercised in
the running app during the run — the user should open Tasks (Completed foot
button, badge, tooltip, drag with older hidden), Specs (All / Done tile,
Active chips, search), and Project Settings › Boards (change a select, watch
the open board re-render; no-project state), in both themes.

### [2026-09-14] Two VS Code themes, added beside the existing pair

**Context.** The user sent VS Code 2026 Dark and Light screenshots and
asked for both as *new* themes — "geri kalan her şeyi vs code renklerinde
yapabilir miyiz. ve 2 yeni tema olarak eklensin bunlar. var olan temaları
değiştirme" — with one hard constraint: "bizim rengimiz yeşil, mavi değil",
so Frame's green accent stays in place of VS Code's blue. Also: reuse the
palette layer, no duplicated code.

**How it was done.** The theme contract was binary (`data-theme` =
`light` | `dark`, a toggle, two palette commands). Rather than fork every
light-only rule for a second light theme, the theme now writes two
attributes on `<html>`: `data-theme` (the id) and `data-scheme` (its
light/dark family). The base token blocks in `variables.css` key on
`data-scheme`; a named theme block (`[data-theme="dark-plus"]`,
`[data-theme="light-plus"]`) overrides only chrome tokens (backgrounds,
text, borders, shadows) and inherits the accent, semantic, doc-type and
diff colours from its scheme. Everything that only cares about light-vs-dark
— the three light overrides in `terminals-view.css`, the embedded report
shells (which carry two palettes) — reads `data-scheme`, so a future theme
never needs a copy of those.

One pure registry, `src/renderer/themes.js`, is the single list: label,
command id, scheme, counterpart (what the top-bar toggle flips to — the
other scheme of the *same family*, so a VS Code user stays in VS Code
colours), and the xterm palette (three shared ANSI tables: VS Code dark
— which Frame Dark already used —, VS Code light, Frame light; each theme
adds its own background / foreground / cursor). `index.js` registers one
`theme.*` command per entry; `menu.js` lists four under View › Theme;
`terminalManager` and `terminalTabBar` read the registry. Unknown or stale
`frame-theme` values normalize to `dark`.

**Palette choice.** VS Code Dark Modern (#1f1f1f editor, #181818 side/status
bar, #2b2b2b borders, #cccccc text) and Light Modern (#ffffff editor,
#f8f8f8 side/status bar, #e5e5e5 borders, #3b3b3b text). The one existing
hard-coded light hex in `terminals-view.css` (`#f7f5f2`) became
`var(--bg-primary)` — same value under Frame Light, correct under VS Code
Light.

**Verified.** `test/themes.test.js` (registry shape, toggle round-trips,
fallback, full xterm tables); `npm test` 756 pass. Not opened in the running
app during this session — worth a look at the four themes via View › Theme
and the toggle, especially contrast of the green accent on VS Code's
neutral greys.

### [2026-09-14] Shell chrome — one app header, collapsible sidebar and dock

**Context.** With five VS Code screenshots the user said Frame's UI "biraz
sert duruyor, flexible değil": the work-context sidebar should close and open
entirely (a feature beside resize), the bottom dock likewise from a button,
those buttons belong in the header on the right as in VS Code, the top header
should be one full-width piece (Frame logo left; agent picker, Start, collapse
buttons, theme and notification bell right), and the right panel should keep
an inner header of its own for Home, Terminals and the open spec tabs. Spec
`shell-chrome-app-header-collapsible-panels`, planned and implemented guided
on `feat/shell-chrome-app-header-collapsible-panels` (eight commits, `npm
test` 756 pass after each).

**Decisions.** The one open fork was the project switcher: with the sidebar's
own header gone it moved to the **app header's center** (the user's choice,
VS Code command-center position) rather than staying as the sidebar's first
row — it must stay reachable while the sidebar is collapsed. This explicitly
amends sidebar-project-section's "switcher above the rail-and-panel split";
the rail's Projects view remains the project *list*. Silent decisions: the
header is static markup in `index.html` with a thin `appHeader.js` (no boot
flash, no bind-after-render race); `body` became a column with a `#shell`
row; the header buttons run the registered commands (`panel.toggleSidebar`,
`dock.toggle`) and paint from `sidebarResize.onChange` (new) / `dock.onChange`,
never from their own click; collapsed sidebar = fully hidden; header 35px like
the strip; no tests (DOM-coupled). Theme restore, the bell and
`mountSelector()` moved from `terminalTabBar` to `appHeader.js`; the strip is
navigation only.

**Not verified visually in this session** — a full-screen capture caught
the user's browser, not Frame, so the check was by build, test and the app's
log. Worth a look: the switcher's width in the header center, the launcher's
divider next to the toggles, and all four themes.

### [2026-09-14] Card layout — sidebar and center as bordered, rounded cards

**Context.** Right after the app header shipped, the user sent a VS Code
screenshot ("harika olmuş… sol layout ve sağ layout kendi borderlarıyla
ayrılıyor ve radius var. aynı şekilde yapalım"): the explorer and the editor
area are two separate cards with their own 1px border and rounded corners,
floating on the window's ground with a gutter between them and to the edges.

**Change (CSS only).** `#shell` gained `gap: 6px`, `padding: 0 6px 6px` and
the `--bg-deep` ground; `#sidebar` and `#main-content` each carry
`border: 1px solid var(--border-subtle)` and `border-radius: var(--radius-lg)`
(the sidebar's old `border-right` and the `::after` accent-glow line are
gone; `#main-content` clips its children to the corners). The app header and
the status bar switched to `--bg-deep` and lost their hairlines so the chrome
around the cards reads as one ground, as in VS Code.

**Overturns, on purpose.** compact-center-vs-code-density's rule that "the
center is one flat surface — no margin, padding, radius or `--bg-deep` gap
between the sidebar's 1px border and the window edge". The inside of the
center is still flat (strip 35px, no nested cards); only the shell's outer
frame changed.

### [2026-09-14] Sidebar collapses to its rail, not to nothing

**Context.** After the card layout the user said: "sol sidebar kapanırken
sadece work context alanı kapansın. onun solundaki github diffs files kısmı
kalsın her türlü. ve o kısımdaki buttonların dış boşlukları sağ sol aynı
değil." This overturns shell-chrome-app-header-collapsible-panels' D2
("collapsed = fully hidden, rail included") — the rail stays, VS Code
activity-bar style.

**Change.** `sidebarResize.hide()` / `show()` and the boot restore now flip
`#sidebar.collapsed` and clear the inline width instead of `display: none`;
`layout.css` hides `.sidebar-panel` and the resize handle in that state, drops
the rail's right padding and border, and lets the card shrink to the rail
with symmetric 6px insets. A rail click still reveals the panel
(`revealSidebarTab` → `show()`), so the collapsed rail is a way back in.
The persisted key (`sidebar-hidden`), `isVisible()`, `onChange` and the
header toggle are untouched. Spacing: the sidebar's left inset became
`--space-sm` (was `--space-lg`) and the rail's right padding `--space-sm`
(was `--space-xs`), so the icons sit 6px from both sides, collapsed or not.

### [2026-09-15] Empty Terminals view is the grid with a first-terminal ghost

**Context.** The user: "terminals açılınca hiç aktif terminal yoksa, No
terminals yet … gibi bomboş bir sayfa açılıyor. bunun yerine Layout
buttonları vs vs gelsin ve ilk terminal için kesik kenarlı terminal
boyutunda bir alan olsun. içinde gerekli bilgilendirme yazsın ve animated
bir şekilde buraya tıklanabilir mesajı verelim. tourguide gibi … çok
abartmayalım animasyonu." Follow-ups: "etrafı yanıp sönmesin ama herhangi
bir mouse ile tıklıyormuşuz gibi bir animasyon olsun", then "mouse biraz
daha uzaktan gelsin ve 6px daha büyük olsun".

**Decision.** With zero terminals, terminalsView renders the same frame as
the grid — the layout bar (1/2/3, working and persisted) and `.tv-grid` —
with one `.tv-ghost.tv-empty` cell where the first pane will be: pane-sized
(300px), dashed, a `<button>` so the whole box is the click target. The
only motion is a 28px lucide pointer acting out a click every 3.2s (comes
in 22px from up-right, presses, a small ring spreads from the tip); the
frame itself never blinks — hover is the one thing that lights it.
`prefers-reduced-motion` stops the pointer. `EMPTY_TITLE` / `EMPTY_HINT`
stay the one definition of the words.

### [2026-09-15] node-pty "posix_spawnp failed." in dev — prebuilt spawn-helper lacks +x

**Context.** The user hit "Could not create a new terminal: posix_spawnp
failed." in a dev Frame (`electron .`) and asked whether launching Frame
from inside Frame caused it. It did not; reproduced with
`ELECTRON_RUN_AS_NODE=1 Electron -e "require('node-pty').spawn(...)"`.

**Root cause.** `/usr/local/bin/node` is x86_64 (Rosetta), so
electron-rebuild's postinstall builds node-pty's `build/Release` as x86_64.
The arm64 Electron cannot load it and node-pty falls back to
`prebuilds/darwin-arm64/`, whose `pty.node` works but whose `spawn-helper`
comes out of the npm tarball as `-rw-r--r--`. Every terminal execs that
helper, so every spawn fails. The packaged Frame.app is unaffected.

**Fix.** `scripts/fix-node-pty-helper.js`, run from `postinstall` after
electron-rebuild, chmods every `prebuilds/*/spawn-helper` to 0755 (no-op on
Windows / when already executable). Verified with a clean `npm ci`: the
helper comes out executable and a terminal opens in the dev instance.
Alternative not taken: installing an arm64 Node so the native build itself
is arm64 — correct too, but it depends on the machine, and the chmod is
harmless alongside it.

### [2026-09-15] Header theme control is a picker; View › Theme shows the current one

**Context.** Frame has four themes (Dark, Light, Dark+, Light+) but the
header button only flipped between a theme and its light/dark counterpart,
so two of the four were reachable only through the palette or the View
menu. The View › Theme submenu also gave no sign of which theme was on.

**Decision.** The header button (`#sidebar-theme-btn`) opens a popover
listing every `themes.js` entry — a diagonal swatch built from the theme's
own terminal background/foreground, the label, a check on the current one.
The button's icon is the current scheme (sun / moon) and its tooltip the
theme's name. Everything is painted from `data-theme` via a
MutationObserver, so a theme set from the palette or the View menu shows in
the header too. `appHeader.js` owns the popover; `applyTheme` in
`terminalTabBar.js` stays the one write path.

View › Theme became a radio group. Main does not own theme state (it lives
in the renderer's localStorage), so `applyTheme` reports the id over a new
`THEME_CHANGED` channel and `menu.js` rebuilds the application menu with
that entry checked — the same rebuild the AI-tool switcher already does.
The submenu is generated from `themes.THEME_IDS`, so main no longer carries
its own copy of the labels. The registry's `counterpart` field and
`counterpartOf()` only existed for the old flip, so they were removed with it.

### [2026-09-15] UI zoom steps — page zoom owned by Frame, not a CSS rewrite

> Frame için aklıma yeni bir feature geldi. zoom in ve zoom out. fontlar
> iconlar vs tüm tasarım scale olabilir. default bu hali olur. 2 kademe
> küçük 2 kademe büyük olabilir. … view menusu altına da koyalım bunu uygun
> bir şekilde diğer uygulamalar gibi. ayrıca shortcut ekleyebiliriz

**Analysis.** The View menu already carried Electron's stock `zoomIn` /
`zoomOut` / `resetZoom` roles, so ⌘= zoomed the page today — through
Chromium's dozen-step ladder, with no indicator, no Settings entry, and a
value Chromium persisted per origin on its own. The stylesheets are px-only
(2,357 px values, 0 rem), the density pass's 12px base is deliberate, and
xterm / the d3 map sit outside CSS anyway. Three mechanisms were weighed:
Chromium page zoom under Frame's control (chosen), a rem refactor (16k lines,
still leaves xterm and SVG), CSS `zoom` on body (breaks rect math and xterm
measurement).

**Decisions (spec `ui-zoom-steps`, planned and task-generated this session).**
Five steps −2…+2 → 0.85 / 0.92 / 1.00 / 1.10 / 1.20, step 0 byte-identical
to today. `src/main/uiZoom.js` owns the factor: seeds
`webPreferences.zoomFactor` from `user-settings.json` (`uiZoomStep`),
re-applies on `did-finish-load` so a stale Chromium per-origin level never
wins, snaps pinch / Ctrl+wheel (`zoom-changed`) to the ladder. Three registry
commands `view.zoomIn` / `view.zoomOut` / `view.zoomReset` on ⌘= ⌘- ⌘0
replace the stock roles in the View menu (same position, plus a hidden ⌘⇧=
alias like Electron's own role), so palette and cheat sheet list them for
free. Frame Settings gains an Appearance row with a `.settings-select`
(machine-wide, so the gear side per settings-by-scope). Status bar shows
`110%` at the right end only away from step 0; click resets. Minimum window
stays 900×600. Tests: the pure ladder module under `src/shared/` only.

### [2026-09-15] Zoom In moves to ⇧⌘0; digit shortcuts match the physical key

> zoom in cmd shift 0 olsun zoom out cmd - olsun

Overturns the `ui-zoom-steps` plan's `CmdOrCtrl+=` for Zoom In (and drops its
hidden `CmdOrCtrl+Shift+=` alias). Zoom In is `CmdOrCtrl+Shift+0`, Zoom Out
stays `CmdOrCtrl+-`, Reset stays `CmdOrCtrl+0`.

Shift+digit never matched in `platform.matchesShortcut`: it compared `e.key`,
and with Shift held that is the layout's shifted character (`)` on US, `=` on
Turkish Q). A digit token now also matches `e.code === 'Digit<n>'`, so the
shortcut works on every layout; unshifted digit shortcuts (⌘1–9) are
unaffected. Verified live: ⇧⌘0 steps up and clamps at 120%, ⌘= does nothing,
both work with a terminal focused, and the View menu and palette show ⇧⌘0.

### [2026-09-15] How to Use Frame — an in-app guide that opens before Welcome (spec: how-to-use-frame-guide)

The user asked for a first-run "how to use" onboarding: a wide modal, index
tree on the left and details on the right, walking through all of Frame step
by step — init and what `.frame/` gets, bring-your-own agent subscription,
terminals and Start, specs and the spec flow, Orchestration being beta and
needing specs, sessions and resume, where decisions / prompts / activity
live, several projects at once, four themes, zoom, plugins — reopenable from
a button under the rail's gear and from the Help menu.

**Decisions taken with the user.** Illustrations are inline sketches drawn
from the design tokens, not screenshots ("eskizleri deneyelim, beğenmezsek
güncelleriz") — so they live in one replaceable module,
`src/renderer/guide/guideSketches.js`. The Welcome overlay stays for now and
opens after the guide closes on launch. Reopening always starts on the first
page, and a "Don't show this on launch" checkbox (`guideHideOnLaunch`) stops
the automatic open.

**How it hangs together.** Content is pure data in `guideContent.js` with a
`validate()` the test runs, so a page citing a missing command or sketch kind
fails `npm test`. Shortcuts in copy are `{kbd:commandId}` tokens rendered
from the command registry, never typed. The guide owns the launch trigger
and hands off to `welcomeOverlay.showOnLaunch()`; closing through an action
link skips Welcome for that launch so the chosen view stays in front.

**Keep it true.** The guide describes the app, so a change that renames a
view, a label or a command should touch the matching page. While writing it,
three drafted claims turned out wrong against the code (Plugins is not hidden
for other agents; Home's first card is "Terminals", not "Agents"; nothing
shows other CLIs loading AGENTS.md through hooks) and were corrected.

### [2026-09-15] How to Use Frame stops opening at launch

After running the dev build the user said the guide "fena değil ancak onboarding sayılmaz": keep it behind the button at the
bottom-left of the rail, do not open it first thing, and drop the "Don't show this on launch" checkbox that only existed for
the launch open. Welcome is back to owning the launch on its own (its code is exactly what it was before the guide), and the
guide is on-demand only — rail button, Help › How to Use Frame, palette. The same pass fixed index titles that ended in "…":
twelve were shortened (e.g. "Know which agent needs you" → "Agent states") and tree rows now wrap instead of truncating.

### [2026-09-16] Welcome slimmed down, sample project and Gemini CLI dropped

The user asked for three things after living with the launch greeting: take
the sample project out of the Welcome modal, remove Gemini CLI from the agent
choices everywhere (Welcome, the header picker, Home's launcher), and make
the modal "daha simple, göz yormayan".

**Agents.** `gemini` left `AI_TOOLS` in `aiToolManager.js`, which is the one
list every surface reads, so the header select, Home's launcher, the Welcome
chips and the menu's Switch AI Tool all lost it at once; `detectDefaultTool`
now probes claude → codex. `loadConfig` gained a fallback: a saved
`activeTool` that no longer exists (an old `gemini` choice, a deleted custom
tool) is rewritten to `claude` instead of leaving the file naming a tool
nothing can select. Left alone on purpose: `laneStatus.KNOWN_AGENTS` still
recognises a `gemini` process someone starts by hand, telemetry still accepts
the old value from stored configs, and `specManager` still stages the (empty)
`gemini` template directory.

**Welcome.** Now one column: mark, title, one line, three single-line actions
(Open a folder / Create a new project / Clone from GitHub), the agent chips,
and a footer with "Don't show this again" and a link to How to Use Frame. The
sample project and the "Start →" CTA that opened it are gone, as are the
four-line feature cards and the shortcut tip — explanation lives in the guide
now. `state.openSampleProject` and the sample IPC path stay; nothing in the
UI calls them any more.

### [2026-09-16] A terminal chip's × closes the terminal

The user found the chip × in the top bar confusing: clicking it showed
"Terminal 3 keeps running — this only takes it out of the top bar … To close
the terminal for good, use the × on its pane in Terminals." Their words: "aslında
böyle olmamalı. Terminal kill ediliyor tamamen kapanıyor emin misin gibi uygun bir
dille yazı olmalı. Ve terminal gerçekten de kill edilmeli burada."

**This reverses T15 of terminals-home-agents**, where × on a chip meant "drop
from this bar, never destroy". Now `multiTerminalUI.closeTerminalFromStrip`
asks through `terminalChipNotice.confirmClose` ("Close this terminal?", red
Close terminal button, Cancel focused so a stray Enter backs out) and then
calls `manager.closeTerminal` — the same path as the pane × (PTY destroyed).
Closing the enlarged terminal falls back to the grid via
`terminalsView._normalizeShown`. "Don't ask again" uses a new localStorage
key (`frame-terminal-close-confirm-off`) so anyone who dismissed the old
harmless notice is not silently switched to killing terminals. The guide's
Terminals text was updated to match. Left alone: the Terminals chip's own ×
(still only drops it from the bar, shown only when there are no terminals),
and the `hiddenFromBar` prefs plumbing — `terminalsView.hideFromBar` has no
caller any more.

### [2026-09-14] Telemetry audit — fixes for misleading counts

**Context.** The user asked for a review of the telemetry, looking only for
implementation bugs that could produce misleading or incomplete data, not
for missing features or improvements. The review found six. The user said to
fix them without a separate spec ("not a big job").

**What the audit found.**
1. `spec_phase_advanced` effectively never fired. Its only trigger was
   `updateSpecStatus`, whose single caller writes `implement_mode` and never
   a phase. Agents write `status.json` themselves, and `reconcilePhase`
   deliberately sends no event, so the dashboard would have suggested nobody
   uses the spec workflow.
2. `spec_created` counted specs that were not new: a rename (the new slug
   looks like it just appeared), a git checkout or pull that brings in
   `spec.md` files, switching back and forth between branches, deleting and
   rewriting a spec. It also missed specs created while the user was looking
   at another project, because the snapshot was reset on every project switch.
   New Spec markers were global, so a click in one project could label a spec
   in another as `button`.
3. The fail-closed opt-out did not hold. When the settings file was corrupt
   and there was no usable `.bak`, the cache was left empty. The next write of
   any setting (for example dismissing the telemetry notice, which reappears
   because its own flag was lost too) cleared `failed`, and telemetry came
   back on. On top of that, `fsSafe` moves the corrupt file aside, so the next
   launch reads "no file" as a fresh install and defaults to ON.
4. `agent_run_started` from the Start button and from Resume fired before the
   command was typed, so launching a CLI that is not installed counted as a
   run. `dispatch()` only counts once the CLI is ready.
5. `orch_worker_failed` also counted worker lanes that Frame closed on
   purpose: the user closing the lane, a reload reconcile, removing the worker.
6. `plugin_marketplace_failed` fired on every Plugins panel open for users
   without git or offline, and `ai_tool_selected` fired when the tool that was
   already active was picked again.

**Decisions.**
- Both spec events are now read off the watcher's push by comparing it with
  earlier looks. The pure logic is `diffSpecLifecycle` /
  `renameSpecLifecycle` in `src/main/telemetryEvents.js`, and the state is
  kept per project in `specManager.specLifecycle`, which is not reset on
  project switch. A slug counts as created once per app run. A phase counts
  only when it passes the furthest phase seen for that spec, so regressions
  and ping-pong between two Frames send nothing. A spec that arrives already
  authored, or a phase with no earlier look behind it, counts only if its
  `created_at` / `last_phase_at` is later than the previous look minus
  10 minutes of skew. That keeps checkouts and pulls out. A timestamp that
  cannot be read, or holds only a date, counts, because Frame cannot tell it
  is old. A rename carries the spec's history over to the new slug. New Spec
  markers are per project.
- Fail-closed: `telemetry.enforceFailClosed()` runs right after
  `userSettings.init()` and writes `telemetryEnabled: false` to disk when the
  load failed. The earlier decision that a successful write clears the flag
  (audit-q3-product-analytics D2) stays as it was; the opt-out is now
  persisted on top of it. The user can turn telemetry back on in Settings.
  PRIVACY.md was updated to say this.
- `agent_run_started` from Start and Resume uses the same bar as `dispatch()`:
  it fires when the CLI reaches ready. Custom CLIs are the exception. laneStatus
  cannot recognize them as agents, so they still count on launch.
- `ptyManager.wasDestroyedOnRequest` records terminals Frame killed on
  purpose, and `orch_worker_failed` is not sent for those. Worker status and
  the relay to the conductor are unchanged.
- `plugin_marketplace_failed` is counted once until a clone or pull succeeds
  again. `ai_tool_selected` fires only when the tool actually changes, and
  PRIVACY.md now describes it as a switch rather than a preference.

**Known limits, accepted.** Specs created while the app was closed are not
counted. A user typing `exit` in a worker lane still counts as a worker
failure, since that cannot be told apart from a crash.

**State.** `npm test` 761 pass, including 9 new tests in
`test/telemetry.test.js`; `npm run build` succeeds. Not committed. Not tried
in the running app. Worth checking there: move a spec forward with an agent
and watch the events, rename a spec, switch branches.

### [2026-09-16] Telemetry notice moves from a top strip to a corner card

**Context.** After the guided tour shipped (first-run-guided-tour), the user
saw the one-time telemetry notice in the live run and said: "İstatistik
bildirimi bu şekilde olmamalı zaten bence. header'ı kapatıyor ve anlaşılmıyor
opacity var diye. Buna daha iyi bir UI bul lütfen." The strip was
`position: fixed; top: 0` across the window on `--accent-subtle`, which is
translucent, so it sat on `#app-header` and the header's text showed through.

**Decision.** `#telemetry-notice` is now a 320px opaque card in the
bottom-right corner, `calc(var(--status-bar-height) + 12px)` above the foot:
`--bg-secondary`, border, 12px radius, `--shadow-lg`, a title ("Anonymous
usage stats") with a chart icon and ×, one line of copy, and a foot with
"Manage in Settings" and a `.primary-btn` "Got it". The corner was free:
toasts are top-centre and the tour's cards sit beside their targets. z-index
stays 9000, above the tour. The ids, `telemetryNotice.js`'s behaviour and the
`telemetryNoticeShown` setting are unchanged. The guided tour still waits for
the notice to be dismissed before its automatic start, now so the two
first-run layers arrive one at a time rather than because the notice hid the
header.

Same pass: `onboarding.js` stopped binding `#onboarding-open-folder` and
`#onboarding-create-project`. Those buttons were replaced by the shared
`projectStart` block, which wires itself, so each launch logged two
"not found" console errors for handlers that could never fire.

Left alone: `healthNotice` still uses a top strip; the separate
`status-bar-notice-tray` spec (specified the same day) moves it into the
status bar.

### [2026-10-09] AI sessions resume after a relaunch (spec: restore-ai-sessions-on-relaunch)

User's request (Turkish, verbatim): "frame i kapatıp açtığımızda herşey sıfırdan başlıyor, açık olan terminal sessionlarının bilgisine sahibiz zaten, uygulama tekrar açıldığında terminalleri ve sessionları açarak başlayabiliriz bence. […] son açık olan proje açıldığında gelir ve terminaller ve sessionlar başlatılır. eğer diğer projelerde de bu durum varsa, kullanıcı o projeyi açtığında terminaller ve sessionlar başlatılır." Then: plain shells (zsh/bash) are ignored; restore is automatic, no prompt; Codex included alongside Claude Code (Gemini/OpenCode out).

Decisions taken with the user:
- Capture by a `SessionStart` hook plus a per-terminal env (`FRAME_TERMINAL_ID`), not by guessing from transcripts. The user first asked what the hook does; after the explanation (two Claude terminals in one project would cross-assign, `/clear` would be missed) chose the hook.
- Hook installed per project, not in `~/.claude/settings.json`: Claude entry in the project's sharing-mode settings file; Codex entry in `CODEX_HOME/hooks.json` (the only place Codex reads) guarded on `.frame/`. Consequence accepted: projects never initialized with Frame do not restore.
- The session hook ignores the active-tool gate, so one project with a Claude and a Codex terminal restores both.
- "Last active project" is saved explicitly. Mid-implementation a conflict surfaced with the existing Default-project setting ("Frame opens it every time it launches"); the user chose: open the last project **only when it has sessions to resume**, otherwise the default as before. The setting's text now states the exception.

Measured (measurements.md): both CLIs pass the env to the hook; `$PPID` is the CLI and its pgid equals the terminal's tpgid, while a CLI nested in a session's Bash tool sits in another group — that check filters nested reports.
