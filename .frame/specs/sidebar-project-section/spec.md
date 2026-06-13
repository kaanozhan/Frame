# Sidebar Project Section — projects as the root of the sidebar

> **What we're building:** The sidebar's `Projects | Files | Changes` tab row
> is restructured. **Projects stops being a tab** — it becomes a collapsible
> section pinned to the top of the sidebar, because selecting a project is a
> root-level action that *scopes* everything below it. A **"+" button** on the
> section header opens a single **Open Project modal** that hosts all
> project-opening flows (Select Folder / Create New / Clone GitHub). Below the
> section, **Files and Changes remain as two tabs**, now unambiguously showing
> "the selected project's" files and changes — a clean top-to-bottom hierarchy.

---

## Problem

Today the sidebar presents Projects, Files, and Changes as three sibling tabs
(`index.html:57-60`). They are not siblings:

1. **Wrong altitude.** Projects answers "which context am I in?" — it is
   chosen once and rarely changed, and switching it has heavy side effects
   (terminal sessions switch via `setProjectPath` → `multiTerminalUI.
   setCurrentProject`). Files/Changes are passive views *inside* that context.
   Presenting them as equals hides the hierarchy.
2. **Project-opening UI is cramped.** Three stacked buttons (Select / Create /
   Clone) live inside the tab, and the Clone flow expands an awkward inline
   URL row (`clone-github-input-row`, 11px inline-styled input) squeezed into
   the sidebar width.
3. **Two "+" concepts already exist.** The Projects tab contains its own
   "Projects" list header with a `+` (`btn-add-project`) that just re-triggers
   the folder picker — duplicating `btn-select-project` above it.

User's request (original, Turkish):

> "Bence projects kısmı ayrı bir tab olmasına gerek yok o daha root bir akış
> ve en tepede kendi akışı olabilir. + butonuyla bir modal ile buradaki bütün
> işleri yapabiliriz. Projects section'ın altında seçili olan projenin, files
> ve changes kısmını gösteririz çok daha top-bottom akış için de uygun olur."

Brainstorm decisions (2026-06-11):

- Top switcher = **variant C: collapsible section** (single row when
  collapsed, workspace project list when expanded) — serves both the
  single-project and multi-project use cases.
- Files/Changes **stay as tabs** (not stacked accordion sections).
- "Initialize as Frame" stays a visible, clickable flow on non-Frame projects.
- Empty state = an "Open a project" call-to-action in the section.
- AI tool row (Start button + selector) **stays under the project section for
  now**; its removal/relocation is a separate future spec.

---

## Goal

### 1. Projects section pinned at the top

- Directly under the sidebar header, a **Projects section** replaces the
  Projects tab:
  - **Collapsed (default):** one row showing the **active project's name**
    (with full path on hover/title), a collapse chevron, and a **`+` button**.
  - **Expanded:** the workspace project list (rendered by the existing
    `projectListUI` machinery) appears below the header row; clicking a
    project switches to it (existing `setProjectPath` pipeline, terminals
    switch as today); the active project is highlighted.
  - Collapse/expand state persists for the session (in-memory is enough; no
    new persistence layer).
- **Empty state:** when no project is open, the section shows an
  **"Open a project +"** call-to-action that opens the same modal as the `+`
  button. It must not fight the welcome overlay — overlay behavior unchanged.

### 2. Open Project modal (the "+" flow)

- The `+` button (and empty-state CTA) opens a single modal hosting all
  project-opening flows as clearly presented options:
  - **Select Project Folder** → sends `SELECT_PROJECT_FOLDER` (unchanged).
  - **Create New Project** → sends `CREATE_NEW_PROJECT` (unchanged behavior:
    location picker; real scaffolding is out of scope).
  - **Clone GitHub Repo** → a proper form inside the modal: URL input +
    Clone button, Enter/Escape handling; sends `CLONE_GITHUB_REPO` and
    consumes `CLONE_GITHUB_REPO_RESULT` exactly as today (error → message,
    success → `setProjectPath`). The inline sidebar row
    (`clone-github-input-row`) is removed.
- The modal is a **UI shell over the existing IPC flows** — no new IPC
  channels, no changes to `dialogs.js` logic.
- Old sidebar buttons `btn-select-project`, `btn-create-project`,
  `btn-clone-github` (+ inline clone row) and the duplicate
  `btn-add-project` are removed; everything routes through the modal.

### 3. Files / Changes as the remaining tabs

- The tab row shrinks to **`Files | Changes`** — two tabs below the Projects
  section. Tab switching logic is reused; the `projects` tab id disappears.
- Both tabs keep their existing empty states ("Select a project…") for the
  no-project case.

### 4. Per-project actions stay attached to the project

These currently live inside the Projects tab and must be **rehomed under the
Projects section header** (visible regardless of which tab is active):

- **"Initialize as Frame Project"** button: shown only when the active
  project is not a Frame project (existing `updateFrameUI` rule), as a
  clickable row/button under the project header. Spotlight + hover tooltip
  (`init-frame-tooltip`) behavior is preserved.
- **AI tool row** (`btn-start-ai` + `ai-tool-selector`): kept under the
  Projects section for now, functionally unchanged. (Planned for removal in
  a future spec — do not invest in redesigning it.)

### 5. Commands and shortcuts remapped

- `revealSidebarTab('projects')` callers and command-palette commands that
  focus/open the Projects tab are remapped to the new surfaces (e.g. "open
  project" command → open the modal; "focus projects" → expand the section).
- `Files` / `Changes` focus commands keep working unchanged.

---

## Constraints

- **No business-logic changes.** `state.js` (`setProjectPath`,
  `selectProjectFolder`, `createNewProject`), `dialogs.js`, workspace IPC
  (`ADD_PROJECT_TO_WORKSPACE`, `WORKSPACE_DATA`) and the
  `PROJECT_SELECTED` / `CLONE_GITHUB_REPO_RESULT` flows stay as they are.
  This spec only moves where those flows are *triggered from*.
- **No new IPC channels.**
- Reuse `projectListUI.js` for the expanded list rendering (adapt, don't
  rewrite).
- New styles in a dedicated component CSS file (e.g.
  `styles/components/project-section.css`); theme variables respected.
- Modal follows the existing modal patterns in the codebase (e.g.
  `initialize-frame-modal` visibility classes), including Escape-to-close
  without leaking keys to the terminal (respect the existing Esc-handling
  fix from `b649542`).
- Sample-project flow (`OPEN_SAMPLE_PROJECT`, welcome overlay, sample
  banner) must keep working; opening the sample must select/highlight it in
  the new section like any other project.

---

## Success Criteria

1. **On launch with no project**, the sidebar shows the Projects section
   empty state with an "Open a project" CTA; clicking it opens the Open
   Project modal. Files/Changes tabs show their empty states.
2. **All three flows work from the modal**: selecting a folder, creating a
   new project location, and cloning a GitHub repo (including clone error
   feedback) end with the project active — terminals, file tree, changes,
   and Frame detection behaving exactly as before.
3. **The collapsed section** shows the active project's name; **expanding**
   it lists workspace projects; clicking another project switches everything
   (terminals included) just as the old list did.
4. **A non-Frame project** shows the "Initialize as Frame Project" action
   under the project header (with its tooltip/spotlight); a Frame project
   does not.
5. **The old UI is gone**: no Projects tab, no stacked Select/Create/Clone
   buttons, no inline clone URL row, no duplicate `+` in a "Projects" list
   header.
6. **The AI tool row** still starts the selected AI tool in the active
   project, from its new home under the section.
7. **Command palette / shortcuts** that previously targeted the Projects tab
   reach the new equivalents; Files/Changes commands are unaffected.

---

## Out of Scope

- **Real "Create New Project" scaffolding** (name input, `git init`,
  templates) — the modal keeps today's location-picker behavior; upgrading it
  is a future task the modal layout should merely leave room for.
- **Removing/relocating the AI tool row** — explicitly deferred to a future
  spec; this spec only re-parents it.
- **Welcome overlay redesign** — untouched apart from not conflicting with
  the new empty state.
- **Workspace model changes** (project pinning, ordering, recents) — the
  list shows what `WORKSPACE_DATA` provides today.
- **Persisting collapse state across app restarts.**
