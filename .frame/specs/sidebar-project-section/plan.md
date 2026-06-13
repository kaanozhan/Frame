# Plan — Sidebar Project Section — projects as the root of the sidebar

## Architecture

The sidebar's structure changes from **three sibling tabs**
(`Projects | Files | Changes`) to a **pinned Projects section + two tabs**
(`Files | Changes`). This is a pure UI re-parenting: every business flow
(`setProjectPath`, `selectProjectFolder`, `createNewProject`, the clone IPC
round-trip, workspace IPC, Frame detection) stays exactly as it is today. We
only move *where those flows are triggered from* and *where their status is
shown*.

**Three surfaces, one source of truth.** The active project lives in
`state.js` (`currentProjectPath`, `isCurrentProjectFrame`) and the workspace
list lives behind `WORKSPACE_DATA`/`WORKSPACE_UPDATED`. The three new surfaces
all read from those and route back into the existing pipelines:

1. **Projects section** (new `index.html` block + new
   `src/renderer/projectSection.js`) — pinned directly under
   `#sidebar-header`, above the tab row. It owns:
   - a **collapsed header row**: active project name (with full path as
     `title`), a collapse chevron, and a `+` button;
   - an **expanded body** that hosts the existing `#projects-list` element,
     still rendered by `projectListUI.js` (moved, not rewritten);
   - the **empty state** ("Open a project +" CTA) shown when no project is
     active;
   - the **rehomed per-project actions**: the `Initialize as Frame Project`
     button (+ its `#init-frame-tooltip`) and the AI tool row
     (`#btn-start-ai` + `#ai-tool-selector`).
   - Collapse/expand is in-memory only (a module-level boolean toggling a CSS
     class on the section root). No persistence layer.

2. **Open Project modal** (new `index.html` `modal-overlay` block + new
   `src/renderer/openProjectModal.js`) — a UI shell following the existing
   `initialize-frame-modal` pattern (`.modal-overlay`/`.modal-container` +
   `.visible` class, Escape-to-close that does not leak to the terminal — the
   `b649542` fix is honored by gating the `Escape` handler on
   `modal.classList.contains('visible')`, same as `state.js`'s init-frame
   modal). It presents three options:
   - **Select Project Folder** → `state.selectProjectFolder()` (unchanged);
   - **Create New Project** → `state.createNewProject()` (unchanged
     location-picker behavior; layout leaves room for a future name/scaffold
     upgrade but adds none now);
   - **Clone GitHub Repo** → an in-modal form (URL input + Clone button,
     Enter submits / Escape closes) that sends `CLONE_GITHUB_REPO`. The
     existing `CLONE_GITHUB_REPO_RESULT` listener in `index.js` is unchanged
     (error → alert, success → `state.setProjectPath`); on success the modal
     closes.
   The modal is opened by the section's `+` button and by the empty-state
   CTA.

3. **Tab row** (`index.html`) — drops the `projects` tab button and its
   `data-sidebar-tab-content="projects"` panel. The generic tab-switching
   code in `index.js` (`.sidebar-tab-btn` click loop and `revealSidebarTab`)
   is data-driven over `data-sidebar-tab`, so removing the `projects` tab
   needs no logic change — only the callers that pass `'projects'` are
   remapped.

**Active-project display.** `state.updateProjectUI()` currently writes the
full path into `#project-path` inside the old Projects tab. That element moves
into the section header and shows the **project name** (path as `title`); the
`else` branch drives the empty-state CTA visibility. `updateFrameUI()` keeps
toggling the (now rehomed) `#btn-initialize-frame` exactly as today.

**Command/shortcut remapping.** `focus.projectList` ("Focus Project List",
`Cmd+E`) → expand the section + `projectListUI.focus()` instead of
`revealSidebarTab('projects')`. `project.add` / `project.create` commands →
open the Open Project modal (or keep calling state directly; modal is the new
visible entry point). `focus.fileTree` and the Files/Changes paths are
unchanged. `project.next`/`project.prev` (`projectListUI.selectNext/Prev`)
work unchanged.

### Data shapes

No new data shapes. The section consumes:
- `state` active project: `{ currentProjectPath: string|null,
  isCurrentProjectFrame: boolean }` (existing).
- Workspace projects from `WORKSPACE_DATA`: `[{ path, name, isFrameProject,
  lastOpenedAt }]` (existing, rendered by `projectListUI`).
- Module-local UI state: `{ collapsed: boolean }` for the section.

## Files

- **Modified** `index.html` — Add the Projects section block under
  `#sidebar-header`; move `#project-path`, the init-frame button +
  `#init-frame-tooltip`, the AI tool row, and `#projects-list` into it.
  Remove the `projects` tab button and its `data-sidebar-tab-content="projects"`
  panel, the old `#project-actions` stacked buttons
  (`btn-select-project`/`btn-create-project`/`btn-clone-github` +
  `clone-github-input-row`), and the duplicate `#projects-header` `+`
  (`btn-add-project`). Add the new Open Project `modal-overlay` block.
- **New** `src/renderer/projectSection.js` — Owns the Projects section:
  collapse/expand toggle, header row (name/chevron/`+`), empty-state CTA,
  wiring the `+`/CTA to the Open Project modal, and exposing
  `expand()`/`collapse()` for commands. Delegates list rendering to
  `projectListUI` and active-project display to `state`.
- **New** `src/renderer/openProjectModal.js` — Open Project modal shell:
  open/close (`.visible` + Escape-without-leak), the three option handlers
  (folder/create → `state`; clone → `CLONE_GITHUB_REPO` send + in-modal form).
- **New** `src/renderer/styles/components/project-section.css` — Styles for
  the section (header row, chevron, collapsed/expanded, empty-state CTA,
  rehomed actions) and the Open Project modal options/clone form; uses theme
  variables.
- **Modified** `src/renderer/styles/main.css` — Add
  `@import 'components/project-section.css';`.
- **Modified** `src/renderer/index.js` — Init the two new modules; move the
  clone wiring into `openProjectModal.js` (keep the
  `CLONE_GITHUB_REPO_RESULT` listener working); delete the removed buttons'
  handlers (`btn-select-project`, `btn-create-project`, `btn-clone-github*`,
  `btn-add-project`); remap `focus.projectList` and `project.add`/
  `project.create` commands to the new surfaces.
- **Modified** `src/renderer/state.js` — Point `pathElement` at the section's
  name element and render the project **name** (path as `title`); drive the
  empty-state CTA in the no-project branch of `updateProjectUI()`. No
  business-logic change.
- **Modified** `STRUCTURE.json` — Register `renderer/projectSection` and
  `renderer/openProjectModal` modules (via `npm run structure` or manually).

## Dependencies

None. All flows reuse existing IPC channels and renderer modules; no packages
or services added.

## Sequencing

1. **Add the Open Project modal (shell + clone form), keep old buttons.**
   Add the modal markup to `index.html` and `openProjectModal.js`; move the
   clone wiring out of `index.js` into the modal (URL input, Enter/Escape,
   `CLONE_GITHUB_REPO` send; `CLONE_GITHUB_REPO_RESULT` still handled in
   `index.js`). Wire folder/create options to `state`. Verify all three flows
   work when the modal is opened (temporarily) from the existing buttons.

2. **Build the Projects section shell (collapsed/expanded + CTA).** Add the
   section block to `index.html` under `#sidebar-header` and create
   `projectSection.js`: collapse/expand toggle, header row with name + chevron
   + `+` button wired to the modal, and the empty-state "Open a project +"
   CTA. Add `project-section.css` and the `main.css` import. Section reads the
   active project from `state`.

3. **Move `#projects-list` and per-project actions into the section.** Relocate
   `#projects-list`, the init-frame button + `#init-frame-tooltip`, and the AI
   tool row into the section body in `index.html`. Confirm `projectListUI`
   still renders/selects (its container id is unchanged), `updateFrameUI`
   still toggles the init button, and the AI start button still launches in the
   active project.

4. **Repoint active-project display in `state.js`.** Set `pathElement` to the
   section's name element, render the project **name** with path as `title`,
   and drive empty-state/CTA visibility from `updateProjectUI()`'s two
   branches.

5. **Remove the Projects tab and old project-opening UI.** Delete the
   `projects` tab button + its content panel, the old `#project-actions`
   stacked buttons and `clone-github-input-row`, and the duplicate
   `btn-add-project`; remove their now-dead handlers in `index.js`. Confirm
   the tab row is `Files | Changes` and switching still works.

6. **Remap commands/shortcuts.** Update `focus.projectList` to expand the
   section + focus the list, and `project.add`/`project.create` to open the
   modal. Leave Files/Changes focus commands and `project.next/prev` as-is.

7. **Verify sample-project + welcome-overlay interplay and update
   `STRUCTURE.json`.** Confirm opening the sample selects/highlights it in the
   section like any project and the empty state doesn't fight the welcome
   overlay. Register the two new modules in `STRUCTURE.json`.
