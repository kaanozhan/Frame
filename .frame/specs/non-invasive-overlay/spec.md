# Non-Invasive Frame Overlay (.frame-only, zero-touch)

> **What we're building:** a version of Frame that can be used on *any* codebase
> — including a company or third-party repository the developer must never alter
> — while still delivering Frame's full feature set (tasks, specs, notes,
> structure map, prompt history, multi-terminal, AI-tool launching with context).
> Frame becomes a **read-only overlay** on top of the project: it owns exactly
> one directory, `.frame/`, and touches nothing else in the working tree.

---

## Problem

Today Frame's identity and data are physically embedded in the project root, and
initialization actively *mutates* the repository:

- `initializeFrameProject` writes root-level files: `AGENTS.md`, `STRUCTURE.json`,
  `PROJECT_NOTES.md`, `tasks.json`, `QUICKSTART.md`.
- It **destructively** consumes an existing `CLAUDE.md`: reads it, `fs.unlinkSync`
  deletes it, merges its content into `AGENTS.md`, then replaces it with a
  `CLAUDE.md → AGENTS.md` symlink. Same pattern for `GEMINI.md`.
- `structureBootstrap` installs a **pre-commit hook**. Its parser scripts
  already land in `.frame/bin/` (fixed since this spec was first written), and
  on vanilla-git projects the hook goes to the local-only `.git/hooks/` — but on
  **husky** projects it *appends to the tracked `.husky/pre-commit`*
  (`structureBootstrap.js` `installStructureHook`), a working-tree write.
- The spec knowledge layer registers its spec-hint hooks by **merging into the
  project's `.claude/settings.json`** (`frameProject.js`
  `registerSpecHintHooks`) — another write to a tracked root file.
- `isFrameProject` decides "is this a Frame project?" by looking for
  `projectPath/.frame/config.json` — so the project's identity lives *inside* the
  repo as well.
- Frame's *own* instructions are stamped into each project as a template copy
  (`frameTemplates.js` → root `AGENTS.md`). Because every project holds its own
  copy of content that is identical everywhere, the copies drift as Frame evolves,
  and a managed-block upgrade mechanism (`docsManagedBlock.js`, re-applied on
  project open) exists purely to chase them.

Consequences that block the target use case:

1. **You cannot use Frame on a codebase you don't own.** Opening a company repo
   and initializing pollutes it with 5+ root files, deletes/relinks an existing
   `CLAUDE.md`, and installs a git hook. None of this is acceptable on a shared,
   reviewed, or third-party codebase.
2. **Existing instruction files are clobbered.** Many real projects already ship
   their own `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, Codex config, `.cursorrules`,
   etc. Frame currently rewrites/relinks them rather than respecting them.
3. **`git status` is never clean.** Even if a developer wanted Frame's metadata
   to stay local, today it lands as untracked/modified files across the tree.

The desired workflow — *"use Frame's organizing and context-preservation
features on top of my real work, without leaving a fingerprint on the repo"* — is
impossible with the current architecture.

---

## Goal

Frame supports a single, non-invasive operating model with these properties:

1. **One footprint only.** Everything Frame creates or maintains *inside the
   working tree* lives under `projectPath/.frame/`. Frame **never** creates,
   modifies, deletes, or symlinks any file outside `.frame/` in the working tree
   — including the project's `.gitignore`. (Frame's own user-scoped storage sits
   outside the tree entirely and is not a footprint on the repo — see Goal 3.)

2. **`.frame/` is the home for all *project-specific* Frame artifacts.** The files
   Frame currently scatters at the root move inside `.frame/`:
   - `.frame/AGENTS.md` (this project's Frame context — see below)
   - `.frame/STRUCTURE.json`
   - `.frame/PROJECT_NOTES.md`
   - `.frame/tasks.json`
   - `.frame/QUICKSTART.md`
   - `.frame/specs/…` (already there today)
   - `.frame/config.json`, `.frame/bin/…` (already there today)

3. **Frame's own instructions live once, outside every project.** Frame's
   meta-layer — how to recognize a task, when to capture a note, the spec
   workflow, structure upkeep — is identical in every project and belongs to
   Frame, not to the user's repo. It lives in **user-scoped storage**, written
   and versioned by Frame, never copied into a working tree. Today this content
   is stamped into each project as *two* template copies — the slim root
   `AGENTS.md` core and the deep maintenance rules in `.frame/docs/REFERENCE.md`
   (both from `frameTemplates.js`) — which is why a managed-block upgrade
   mechanism (`docsManagedBlock.js`) has to exist at all. Both are
   Frame-generic, so both move to the single global copy: updating Frame updates
   every project and no repo is touched.

   `.frame/AGENTS.md` therefore shrinks to what is genuinely *this project's*
   Frame context: which specs and tasks exist, project-specific conventions the
   user added, pointers into `.frame/`. If a project has nothing project-specific
   to say, `.frame/AGENTS.md` may be absent and the global layer stands alone.

4. **Existing root instruction files are sacred — discovered, never touched.**
   On opening a project, Frame detects any of: `CLAUDE.md`, `AGENTS.md`,
   `GEMINI.md`, Codex config (`AGENTS.md` / Codex's own convention),
   `.claude/CLAUDE.md`, `.cursorrules`, `.cursor/rules/*`,
   `.github/copilot-instructions.md`. These are read **read-only**, solely to
   feed launch-time injection (Goal 6) — no UI surfacing in this spec; that can
   become a small follow-up if the need appears. Frame must never rewrite,
   delete, symlink-over, or append to them.

5. **Legacy layouts are detected, never silently misread.** A project
   initialized by today's Frame carries root-level `AGENTS.md` / `tasks.json` /
   `STRUCTURE.json` / `PROJECT_NOTES.md` and possibly a `CLAUDE.md → AGENTS.md`
   symlink. Once this spec ships, Frame reads only `.frame/` — so opening such a
   project must **not** present it as "not a Frame project yet" with an empty
   task list. Frame recognizes the embedded layout (a natural extension of the
   discovery pass in Goal 4: the same root scan, matching Frame's own artifact
   names) and tells the user plainly that the project uses the old layout and
   needs migration. Actually moving the files is the migration spec's job (see
   Out of Scope); this spec only detects the state and communicates it.

6. **Native prompt injection, composed at launch time — not by planting files.**
   Because Frame no longer drops a root `CLAUDE.md` symlink, the AI tool can no
   longer auto-discover Frame's conventions from the root. Instead, Frame injects
   context **when it launches the AI tool**, via the start command it already
   controls (`aiToolManager.getStartCommand`, with flag composition via
   `composeLaunchCommand` — the path `implement-modes` added for launch flags).
   Three layers compose **by
   reference and never by merging** — conflicts are resolved by domain, not by
   layer order (see below):

   | Layer | Source | Owner |
   |-------|--------|-------|
   | Frame global | user-scoped store (Goal 3) | Frame, same for every project |
   | Frame project | `.frame/AGENTS.md`, if present | Frame, per project |
   | Repo native | the repo's own `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` / … | the repo, read-only |

   Per tool, the repo's native layer is reached the way that tool already reaches
   it, and Frame adds only a **pointer** to its own two layers:

   | AI tool | Repo's own root instruction file | Frame's behavior |
   |---------|----------------------------------|------------------|
   | Claude Code | `CLAUDE.md` present | Leave it alone (Claude reads it natively). Inject a pointer to the Frame layers. |
   | Gemini CLI | `GEMINI.md` present | Same — leave it, point to the Frame layers. |
   | Codex / no native convention | any/none | Wrapper injects: "read the repo's instruction file if present **and** the Frame layers". |
   | any | none present | The Frame layers are the sole injected source. |

   The repo's instruction file remains authoritative for **code conventions**;
   Frame's layers are authoritative for the **Frame meta-workflow** (task
   recognition, note capture, spec workflow, structure upkeep). Where they
   disagree, that split decides — and the injected preamble states it, so the
   agent never has to guess. No content is copied out of any file: the injected
   text references paths, so nothing goes stale and no context is duplicated.
   That indirection is also what lets the layers later live somewhere other than
   the working tree without the injection logic changing.

7. **Committing `.frame/` is opt-in, never imposed.**
   - **Default (zero-touch):** Frame keeps `.frame/` out of git locally using
     `.git/info/exclude` (a per-clone, untracked file). The tracked tree —
     including `.gitignore` — is never modified, so `git status` stays clean.
   - **Team opt-in:** a developer/team that *wants* to share tasks and specs can
     choose to commit `.frame/`. Frame surfaces this as an explicit choice; it
     does not edit the tracked `.gitignore` on the user's behalf.
   - **The exclude is conditional, not permanent.** An exclude entry only hides
     *untracked* files — but that is exactly the trap: if the team has committed
     `.frame/` and the exclude entry survives (or Frame re-writes it on open),
     every *new* file under `.frame/` — a fresh spec folder, a new report — stays
     invisible to `git status` on every machine, and the team silently drifts.
     So the rule is: Frame writes its exclude entry **only while `.frame/` is
     untracked**; the moment any `.frame/` path is tracked in the repo, Frame
     does not write the entry and removes the one it previously added. Opting in
     is therefore just "commit `.frame/`" — Frame notices and gets out of the
     way on every clone.

8. **All other features keep working unchanged.** Multi-terminal, file tree,
   file editor (which only writes when the user explicitly saves a real source
   file — intended), git status/branches panels, overview, prompt history, AI
   tool switching — these already read the repo or write to user-scoped storage
   and change only in that they now go through the storage module (Constraints)
   instead of building paths themselves.

---

## Constraints

- **Absolute no-write rule:** outside `projectPath/.frame/`, the only writes Frame
  may perform are to **untracked, local-only git internals**: `.git/info/exclude`
  and `.git/hooks/*`. Nothing in the tracked working tree, ever — not
  `.gitignore`, not `.claude/settings.json`, not `.husky/*`. The two current
  violators change behavior accordingly:
  - `registerSpecHintHooks` stops merging into the project's
    `.claude/settings.json`. The spec-hint hooks are delivered at launch time
    instead, through the same flag-composition path the launcher already has
    (`composeLaunchCommand`); the exact flag mechanism per tool is a plan
    decision.
  - `installStructureHook` on husky projects stops appending to the tracked
    `.husky/pre-commit`; it degrades to the same show-the-snippet manual path
    already used for custom hooks. Vanilla `.git/hooks/` installs stay.
- **Non-destructive discovery:** reading existing instruction files must never
  open them for write, rename, or relink. `fs.unlinkSync` / `symlinkSync` against
  root instruction files is removed entirely.
- **Single model, not a toggle.** This replaces the embedded behavior; there is no
  "embedded vs external" switch to maintain. (Migration of already-embedded Frame
  projects is handled separately — see Out of Scope.)
- **Storage access must be centralized behind data, not paths.** Every place that
  currently hardcodes a root path (`tasksManager.getTasksFilePath`,
  `overviewManager.loadStructure / loadTasks / loadDecisions`, `frameProject`,
  `structureBootstrap` output, etc.) goes through one storage module whose surface
  is *read/write of a named artifact* — `readTasks(project)`, `writeNotes(project,
  data)` — not a path helper callers then join and `fs` themselves. The
  `.frame/<file>` layout is that module's private implementation detail.
  `specManager` already lives under `.frame/specs/` and is the reference pattern
  for the layout; the interface shape is what this constraint adds.
  Rationale: a later spec moves Frame's artifacts out of the project entirely
  into a Frame-owned store keyed by user/project. That migration must be a new
  backend behind this interface, touching no caller. A path-returning helper
  would force every caller to be reopened a second time — same work now, much
  less work later.

  A minority of consumers genuinely need a real file on disk rather than data:
  the `fs.watch` watchers, the scripts under `.frame/bin/`, and anything handed
  to an AI tool to read. Those get the path from a **separately named** entry
  point on the same module (`…Path(project)`), never from the data readers. The
  point is not to build anything extra today — while `.frame/` is the store, a
  path is trivially available — but to keep the two needs distinguishable, so
  the set of "must be a real file" call sites is visible in the code instead of
  having to be rediscovered when the store stops being files.
- **Tool-agnostic injection.** The composition logic must work for Claude Code,
  Gemini CLI, and Codex CLI today, and be extensible to future tools via
  `aiToolManager` without per-tool special cases leaking across modules.
- **The global layer uses Frame's existing user-scoped storage.** No new location
  is invented: it goes where `userSettings` and `ai-tool-config.json` already live
  (`app.getPath('userData')`). Frame owns and versions the file; the user may
  extend it, so upgrades must not clobber user additions — the managed-block
  pattern (`docsManagedBlock.js`) applies here, once, instead of per project.
- **Freshness without ownership.** If a discovered root instruction file changes
  on disk, Frame re-reads it for subsequent injections (the debounced `fs.watch`
  pattern from `specManager` is the model). Frame caches/references; it never
  writes back.
- **Cross-platform:** `.git/info/exclude` and `.git/hooks` handling, plus any path
  encoding, must behave on macOS, Linux, and Windows (including the
  symlink-unsupported Windows fallback already handled elsewhere).

---

## Success Criteria

The work is complete when all of the following hold:

1. **Clean tree.** Open an arbitrary repository, initialize Frame, use it for a
   full session (create tasks, a spec, notes; launch an AI tool), then run
   `git status`: the only thing git could possibly see is `.frame/`, and in the
   default (zero-touch) setup `git status` reports **no changes at all** because
   `.frame/` is excluded via `.git/info/exclude`. The tracked `.gitignore` is
   byte-identical to before.
2. **Existing instruction and config files untouched.** A repo that ships its
   own `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` / `.cursorrules` — and a
   `.claude/settings.json` or `.husky/pre-commit` — has those files
   **byte-identical** (checksum-equal) before and after a full Frame session. No
   symlink replaces them; none is deleted; nothing is merged into them.
3. **Context reaches the AI from every layer.** When Frame launches the AI tool in
   a repo that has its own `CLAUDE.md`, the tool ends up aware of the repo's
   conventions *and* Frame's meta-layer — verifiable by the tool acting on Frame
   conventions (e.g. offering to capture a note / recognizing a task) without the
   repo's `CLAUDE.md` having been modified.
4. **Frame's meta-layer exists once, not per project.** Open two different
   projects: Frame's own instruction content is on disk in exactly one
   user-scoped location, present in neither working tree. Changing it there
   changes both projects' agent behavior on the next launch, with no write to
   either repo.
5. **No root artifacts.** After init and use, there are **zero** Frame-created
   files in the project root or anywhere outside `.frame/`. All of
   `AGENTS.md`, `STRUCTURE.json`, `PROJECT_NOTES.md`, `tasks.json`,
   `QUICKSTART.md` are found only under `.frame/`.
6. **Opt-in commit works.** A team that chooses to track `.frame/` can commit it
   and a teammate cloning the repo sees the shared tasks/specs — without any
   change to how Frame reads them. After opt-in, a *newly created* `.frame/`
   file (e.g. a fresh spec) shows up in `git status` on both machines even after
   Frame reopens the project — proving the exclude entry is gone and Frame did
   not re-add it (Goal 7).
7. **Feature parity.** Tasks, specs, notes, structure map, overview, prompt
   history, and AI-tool launching all function as before, now reading through
   the storage module.
8. **Legacy projects fail loud, not silent.** Open a project initialized by a
   pre-overlay Frame version (root `tasks.json` / `AGENTS.md` present): Frame
   does not show it as an empty, never-initialized project. The embedded layout
   is detected and the UI says migration is needed. No legacy file is read as
   live data and none is modified.

---

## Out of Scope

The following are explicitly **not** part of this effort (may become separate
specs later):

- **Moving Frame's artifacts into a Frame-owned store.** A later spec relocates
  tasks/notes/structure out of the project into storage keyed by user and
  project — which is also where team sharing gets solved properly. This spec
  lands only the interface seam that makes that a backend swap (see Constraints)
  and stops there: no store, no schema, no sync, no user/project identity.
  `.frame/` on disk stays the sole home for now.
- **Migration tooling for already-embedded Frame projects.** Existing projects
  that have root `AGENTS.md`/`tasks.json`/etc. need a separate migration story —
  see the `embedded-migration` spec. **Release coupling:** because this spec
  replaces the embedded behavior outright (Constraints: single model, no
  toggle), the overlay must not ship without the migration path in the same
  release — otherwise every existing Frame project, including Frame's own repo,
  opens as unusable with no way forward. This spec's own obligation stops at
  detecting and reporting the legacy layout (Goal 5); the mover lives in the
  migration spec.
- **Editing the user's tracked `.gitignore`.** Default stays `.git/info/exclude`;
  any future "write to `.gitignore`" convenience is a separate decision.
- **Auto-committing `.frame/`** or any git write beyond local excludes/hooks.
- **Frame Server / browser mode**, multi-user, and remote-host concerns.
- **Parsing existing instruction files into Frame's own structure** (e.g.
  auto-seeding `PROJECT_NOTES.md` from a discovered `CLAUDE.md`). Discovery +
  launch-time composition is in scope; transformation/import is not.
- **Deep semantic validation** of discovered instruction files. Frame detects and
  references them; it does not lint or interpret their content.
