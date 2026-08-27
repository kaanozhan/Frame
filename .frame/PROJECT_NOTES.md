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

- **Runner:** `npm test` → `node --test test/*.test.js` (Node's built-in
  runner; no test framework dependency)
- **Location & naming:** `test/*.test.js`, flat, one file per module under
  test. `test/fixtures/` holds sample repos as data — the glob deliberately
  excludes it, since Node would otherwise execute those files as tests.
- **Covered:** `src/main/`, `src/shared/`, `scripts/` — 8 files. The
  convention is to target the **pure** module and skip its Electron-coupled
  wrapper (`telemetryEvents.js` is tested, `telemetry.js` is not); where a
  test must load an Electron-coupled module, it stubs the external requires
  (`specTasksSync.test.js`).
- **Not covered:** `src/renderer/` — no DOM/UI harness present (`jsdom`,
  `playwright`, `@testing-library`, `puppeteer` all absent). Renderer work
  is not testable here today without first choosing and installing one.
- **CI:** `.github/workflows/ci.yml` — `npm test` on ubuntu + macos.
  Deliberately runs **no** `npm ci`: the suite must work from repo-local
  modules alone, so any test that reaches a package in `node_modules` will
  pass locally and fail in CI.

- _Recorded 2026-07-20 by /spec.plan (test-aware-planning)_

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
