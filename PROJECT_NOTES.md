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
