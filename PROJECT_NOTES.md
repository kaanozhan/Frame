# Frame - Project Documentation

## Project Vision

**Problem:** Claude Code ile geliştirme yaparken VS Code veya Cursor gibi araçlara ihtiyaç yok - onlar kodu elle yazmaya yönelik. Ama terminalde kalınca:
- Projeler dağınık kalıyor
- Session'lar arası context kaybediliyor
- Alınan kararlar unutuluyor
- Standardizasyon yok

**Solution:** Frame - terminal-merkezli bir geliştirme çerçevesi. Bir IDE değil, bir **framework**.

**Why "Frame":** Kelime anlamı "çerçeve". Frame içinde "Frame projeleri" oluşturuyoruz - standart dökümanlar (CLAUDE.md, tasks.json, STRUCTURE.json) ile her proje aynı yapıya sahip oluyor.

**Core Philosophy:**
- **Terminal-first:** Merkez kod editörü değil, terminal. Hatta çoklu terminal (grid).
- **Claude Code-native:** Bu araç Claude Code ile geliştirme yapanlar için.
- **Standardization:** Her proje aynı yapıda, aynı dökümanlarla.
- **Context preservation:** Session notları, kararlar, tasklar - hiçbir şey kaybolmasın.
- **Manageability:** Tüm projeler tek yerden görülebilir ve yönetilebilir.

**Target User:** Claude Code ile günlük geliştirme yapan, terminal-odaklı çalışan developerlar.

**What Frame is NOT:**
- Bir kod editörü değil (dosya editörü var ama merkezi değil)
- VS Code/Cursor alternatifi değil
- Manuel kod yazmak için optimize edilmemiş

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
**Last Updated:** 2026-01-26
**Status:** Frame System + Task Management Complete

---

## Session Notes

### [2026-01-25] Project Navigation System

**Bağlam:** Claude Code projeye girdiğinde context'i hızlı yakalaması gerekiyor.

**Karar:** STRUCTURE.json + PROJECT_NOTES.md + tasks.json üçlüsü.

**Uygulama:**
1. CLAUDE.md'ye "Project Navigation" bölümü - session başında okunacak dosyalar
2. STRUCTURE.json - modül haritası, architectureNotes
3. Pre-commit hook - STRUCTURE.json otomatik güncellenir

**[2026-01-26 Güncellemesi]:**
- "Token Efficiency Protocol" iddiası kaldırıldı (gerçekçi değildi)
- Line numbers kaldırıldı (sürekli değişiyor, bakımı zor)
- Format sadeleştirildi - artık daha pratik

---

### [2026-01-25] Task Delegation to Claude Code

**Bağlam:** Tasks panelinde play butonuna basınca Claude Code'a task'ı otomatik göndermek istedik.

**Karar:**
- Play (▶) butonu task'ı Claude Code'a prompt olarak gönderir
- Claude Code çalışmıyorsa önce `claude` komutu gönderilir, 2 saniye beklenir, sonra task gönderilir

**Uygulama:**
- `tasksPanel.js` → `sendTaskToClaude()` fonksiyonu
- `terminal.sendCommand()` ile terminale gönderim
- `claudeCodeRunning` state tracking

**Gelecek iyileştirme:** Terminal output'unu parse ederek Claude Code'un gerçekten çalışıp çalışmadığını tespit etmek (task-claude-detect).

---

### [2026-01-25] Pre-commit Hook for STRUCTURE.json

**Bağlam:** STRUCTURE.json'ın manuel güncellenmesi zor ve unutuluyor.

**Karar:** Git pre-commit hook ile otomatik güncelleme.

**Uygulama:**
```bash
# .githooks/pre-commit
STAGED_JS=$(git diff --cached --name-only --diff-filter=ACMRD | grep '\.js$')
if [ -n "$STAGED_JS" ]; then
    npm run structure:changed
    git add STRUCTURE.json
fi
```

**Avantaj:** Sadece değişen dosyalar parse edilir (git diff based), tüm proje taranmaz.

---

### [2026-01-25] Task Action UX Improvement

**Bağlam:** Checkbox ile task status değiştirmek kafa karıştırıcıydı - kullanıcı ne olacağını anlayamıyordu.

**Karar:** Checkbox yerine explicit action butonları:
- Pending: ▶ Start, ✓ Complete
- In Progress: ✓ Complete, ⏸ Pause
- Completed: ↺ Reopen

**Ek:** Toast notification sistemi eklendi - "Task started", "Task completed" gibi geri bildirimler.

---

### [2026-01-26] Frame Vision & Context Preservation Feature

**Kullanıcının açıklaması:**

> "Benim sorunum şuydu, ben claude code ile geliştirme yapabiliyorum, evet. ama sadece terminalde kalıyorum. vs code veya cursor gibi bir platform kullanma ihtiyacı duymuyorum. çünkü onlar kodu elle yazmaya yönelik araçlar. benim böyle bir karmaşaya ihtiyacım yok. benim projelerim için standartizasyona, yönetilebilirliğe ihtiyacım var. terminal ve claude code odaklıyım. o yüzden frame'in merkezinde code editörü değil, terminal var, hatta grid yapısıyla çoklu terminal yapımız var. Frame ismi bu yüzden. bu bir çerçeve, o yüzden frame içerisinde bir frame projesi oluşturuyoruz, bu dökümanları yaratıyoruz ki bir standart koyalım. artık claude code ile geliştirdiğim projeleri derli toplu görebileyim. contexti kaybetmeyeyim, sessionlarda yazılanları not edeyim."

**Frame'in Asıl Amacı:**
- Terminal-merkezi (kod editörü değil)
- Claude Code-native geliştirme
- Projeler arası standardizasyon
- Context kaybını önleme
- Session notlarını ve kararları takip etme

**Context Preservation Özelliği Tasarımı:**

Kullanıcı: "end session yapmamalıyız... bir karara vardığımızda, yapalım dediğimizde belki de yapılan iş başarılı olduğunda kullanıcıya sormalıyız, bunu note'lara ekleyelim mi diye? çünkü önem mekanizmasını otomatik olarak karar vermek çok zor bir iş olur. önem derecesinin kararını kullanıcıya bırakabiliriz. sen sorarsın, ekle derse eklersin, ama oraya özet değil kullanıcıyla tam olarak konuşulduğu şekilde eklenmeli."

**Alınan Kararlar:**
1. "End session" butonu/akışı YOK - organik olmalı
2. Task/karar tamamlandığında Claude soracak: "Bunu PROJECT_NOTES'a ekleyeyim mi?"
3. Önem kararı kullanıcıda - Claude sadece öneriyor
4. Özet DEĞİL, konuşma olduğu gibi eklenmeli (context korunmalı)
5. Her küçük şeyde sorulmamalı (spam olur)

**Tamamlanma Algılama:**
- Kullanıcı onayı: "tamam", "oldu", "çalıştı", "güzel"
- Konu değişikliği
- Build/run başarısı

**Uygulama:**
- CLAUDE.md'ye "Context Preservation" bölümü eklendi
- frameTemplates.js'teki template güncellendi (yeni projeler için)

**İlk Uygulama:** Bu not, tam da bu özelliğin ilk kullanımı oldu. Claude sordu "ekleyeyim mi?", kullanıcı "evet" dedi, ve işte bu not eklendi.
