# Project Settings — git sharing and spec-driven become real, per-project choices

> **What we're building:** a project-scoped settings surface that lives next to
> the project, owning the settings that are genuinely per-project — **Git
> Sharing** (local vs. shared in the repository) and **Spec-Driven
> Development** — asked at initialization, changeable afterwards, stored in
> `.frame/config.json`. Sharing is made safe by Frame declaring, inside its own
> directory, which parts of `.frame/` are shareable and which are machine-local.
> The app-wide Settings modal goes back to being app-wide.

---

## Problem

### 1. Solo vs. team is a real product mode, exposed only as a git side effect

Since `non-invasive-overlay`, whether a project's Frame context is private to
one machine or shared with the whole team is decided **implicitly**, by whether
`.frame/` happens to be tracked in git:

- untracked → `gitExclude.ensure()` writes a signed block into
  `.git/info/exclude`, `.frame/` is invisible, `git status` stays clean;
- tracked → the block is removed on the next open, on every machine.

The mechanism is right — the conditional entry exists precisely so a team that
opts in doesn't silently drift apart (`src/main/gitExclude.js`). What's missing
is that **nothing in the product names this mode, shows which one you're in, or
lets you choose it.** The only way to switch is to already know that committing
`.frame/` is the opt-in gesture. That's tribal knowledge, not a product.

### 2. Sharing `.frame/` today means sharing machine-local junk

This is the part that makes a naive toggle actively harmful. `.frame/` holds
two different classes of content:

| shareable — this is the point of repo mode | machine-local — must never be committed |
| --- | --- |
| `specs/` (spec chains, the durable memory) | `runtime/` (orch bus, prompts, spec-hint, test-activity) |
| `docs/REFERENCE.md` | `index/spec-index.json` (derived, rebuildable) |
| `config.json` | `implement-permissions.json` (+ `.bak`) |
| project-level `AGENTS.md`, `STRUCTURE.json`, `PROJECT_NOTES.md`, `tasks.json` | `worktrees/` (git worktrees — committing these is pathological) |
|  | `orchestration/` (generated, holds absolute local paths) |
|  | `bin/` (every file in it is generated — see D2) |

Frame's own repository has been in "repo mode" for months and only works
because someone hand-wrote five rules into the project `.gitignore`:

```
.frame/runtime/          .frame/index/          .frame/implement-permissions.json
.frame/bin/*.js          .frame/orchestration/
```

No user gets that for free. Ship a Git Sharing toggle without solving this and
the first person who flips it commits their orchestration bus and a worktree.

### 3. A per-project setting is presented as an app-wide one

`features.specDriven` lives in each project's `.frame/config.json`, but its
switch sits in the app-wide Settings modal (`index.html:1274-1292`), directly
above telemetry and crash dumps, which genuinely *are* global. Flipping it
while project A is open changes project A only — the modal never says so, and
the switch silently rewrites itself when you change projects. Two scopes, one
surface, no distinction.

### 4. Init decides both questions on the user's behalf, silently

`initializeFrameProject()` hardcodes `features.specDriven: true` and calls
`gitExclude.ensure()` before the first artifact exists — local mode, always.
The init modal (`index.html:653`) explains what will be created and offers two
answers: Initialize, or Not Now. Someone setting up a shared team project has
to initialize wrong first, then discover the fix.

### 5. Project-scoped affordances have nowhere to live

The project row's only action is a hover-revealed `×` that removes the project
from the list (`projectListUI.js:183-191`). There is no per-project surface at
all, so anything project-scoped defaults to app Settings — which is how problem
3 happened, and how it will happen again with the next flag.

### 6. Three settings in every project's config do nothing

`config.settings` carries `autoUpdateStructure: true`, `autoUpdateNotes: false`,
`taskRecognition: true`. **Nothing reads any of them.** Git archaeology
(`git log --all -S` over each name across all history) returns exactly two
commits per flag, both writes:

- `328fb5f` (2026-01-24) introduced `getFrameConfigTemplate` with the first
  two — no reader in that commit;
- `f9f4190` (2026-01-25) added `taskRecognition` and wrote all three into
  Frame's own config — again no reader.

A reader that had been added and later removed would show up as two more
commits. It doesn't. These were never wired; they are day-one placeholders.
The only later contact is `33ec5de` (2026-07-12), whose test asserts that
`writeProjectConfig` doesn't clobber unknown `settings` keys — using a dummy
`{ x: 1 }`. The codebase has treated this block as *foreign data to preserve*,
not as settings, for six months.

They matter here because a settings surface is exactly where someone would put
them, and three switches that do nothing is the opposite of product-grade.

### 7. Nobody working on a shared repo will discover repo mode

One direction is already self-solving: clone a repo whose `.frame/` is
committed and the local checkout has it tracked, so D4 derives `"repo"` with no
prompting. The uncovered direction is the one that matters — a developer on a
repo with a remote and several contributors, sitting in local mode, for whom
specs and notes their teammates would benefit from stay on one laptop. Nothing
ever tells them the other mode exists. A setting nobody finds is only slightly
better than no setting.

---

## Goals

1. **Git Sharing is an explicit, stored, visible setting.** Declared in
   `.frame/config.json`; `gitExclude` acts on the declaration instead of
   inferring intent from tracked state alone.
2. **Sharing is safe by construction.** Frame writes `.frame/.gitignore` —
   inside its own directory, so the overlay contract holds — declaring the
   machine-local paths from the table above.
3. **A Project Settings modal, opened from the project row**, owns everything
   project-scoped: Spec-Driven Development, Git Sharing, and "Remove from
   Frame".
4. **App Settings contains only app-wide settings** — telemetry, crash dumps,
   About.
5. **Init asks both questions**, and the answers are applied before the first
   byte is written.
6. **The three dead flags leave the template.**
7. **Repo mode is discoverable** on the projects where it applies, once, and
   never again after dismissal.
8. **The choice is measurable** — one telemetry event, so "does anyone use repo
   mode" has an answer that isn't a guess.

---

## Non-goals

Decided explicitly during planning:

- **Frame never stages and never commits.** Turning Git Sharing on removes the
  exclude block and nothing else; `.frame/` then appears as untracked in
  `git status` and committing it is the user's move. No `git add`, no
  `chore: share Frame context` commit. The overlay contract is that Frame does
  not write to a repository it does not own — the index and the history are
  part of that repository.
- **Frame never untracks.** Going repo → local on a project whose `.frame/`
  is already committed does not run `git rm -r --cached`. Frame explains, shows
  the command, and stops.
- **The project's `.gitignore` remains off limits.** `.frame/.gitignore` is a
  different file: it lives inside the directory Frame owns, and git applies it
  to paths beneath that directory. Nothing outside `.frame/` is touched.
- **Existing configs are not rewritten to drop the dead flags.** They leave the
  template so new projects are clean; the ones already on disk are harmless
  (no reader) and rewriting them would put a diff in every shared repo for
  no behavioural gain.
- **AI tool selection stays where it is.** It looks per-project but isn't:
  `aiToolManager.js:128` keeps a single `activeTool` in
  `userData/ai-tool-config.json`, so switching tools switches them for every
  project. Making it per-project is a real feature — storage, migration, the
  terminal spawn path — and moving a *global* setting into a *project* modal
  would repeat exactly the scope confusion this spec exists to fix. Separate
  spec.
- **This is not a general settings framework.** Two settings and one
  destructive action, structured so a third is a section rather than a
  redesign. Nothing speculative gets built.
- **The stale privacy copy is not rewritten here.** App Settings still claims
  Frame "collects only your app version and OS", while the registry has carried
  ten events with properties since `audit-q3-product-analytics`. The text is
  out of date independently of this spec, and correcting a privacy claim
  deserves its own review rather than riding along in a settings refactor.
  Noted, not fixed.

---

## Decisions

### D1 — The flag lives in `.frame/config.json`, and that's a feature

`settings.gitSharing: "local" | "repo"`.

The consequence worth having: in repo mode `.frame/config.json` is itself
committed, so the declaration **travels with the repository**. A teammate
clones, opens the project, and Frame reads `"repo"` — no exclude block is
written, and their new spec folders are visible in `git status` from the first
minute. The mode is a property of the project; storing it in the project's own
config makes it behave like one for free.

In local mode the config is untracked and the declaration is machine-local, which is
also exactly right.

### D2 — `.frame/.gitignore`, written and maintained by Frame

A single file inside Frame's own directory, with a signed header, listing the
machine-local paths (Problem 2's right-hand column). Git applies a `.gitignore`
to everything under its directory, so this is complete and needs no cooperation
from the project's own ignore rules.

Properties that make this the right shape:

- **It's inside `.frame/`.** No overlay violation, no argument about who owns
  the file.
- **It's harmless in local mode.** The whole directory is excluded anyway, so
  the file just sits there — which means Frame can write it unconditionally at
  init and never has to sequence it against the toggle.
- **It ships with repo mode.** The file is itself committed, so a teammate
  inherits the same protection without Frame having run on their machine yet.
- **It's rewritable.** Signed and Frame-owned, so when a future version adds a
  machine-local directory, the list updates the way `gitExclude`'s block does —
  and, per that module's precedent, unsigned user-added lines are left alone.

**`bin/` is listed whole, not `bin/*.js`.** Everything in it is generated by
Frame: the AI-tool wrappers (`frameProject.js:252-261`, `aiToolManager.js:538-541`),
the orchestration command-bus scripts (`orchestrationManager.js:224-227`), and
`implement-launch.js`. Nothing there is user-authored. Frame's own repo tracks
`bin/codex` while ignoring `bin/*.js`, but that split is an accident of history,
not a design — the shell wrapper was committed before anyone thought about it.
Sharing generated files has a concrete cost: when Frame's template changes,
every clone's copy is rewritten and everyone gets a diff in a file nobody
edits.

### D3 — Tracked state still overrides a `local` declaration

`gitExclude`'s existing safety rule is not weakened. An exclude entry only
hides *untracked* files; leaving one in place while `.frame/` is tracked means
every **new** file under `.frame/` vanishes from `git status` while the old ones
stay visible — the silent-drift trap the module was written to avoid.

So: **if any `.frame/` path is tracked, our block is removed, whatever the
config says.** A `local` declaration on a tracked project is not honoured
silently; it's surfaced (S4 below) with the one command that resolves it.
Declared mode and effective mode are two different things, and the UI shows
both when they disagree.

### D4 — A missing key is derived once, then persisted

Existing Frame projects have no `settings.gitSharing`. On first read after
upgrade:

```
absent → gitExclude.isFrameTracked() ? "repo" : "local"   → written back
```

This reproduces each project's current behaviour exactly, so nothing changes
under anyone's feet, and the derivation happens once.

### D5 — Init passes the mode in; it does not read it back

`gitExclude.ensure()` is deliberately called before `.frame/` exists
(`frameProject.js:173`) — "a `.frame/` that appears untracked-and-visible even
for a moment is the fingerprint this whole model exists to avoid." Reading the
mode from a config that hasn't been written yet is impossible, and writing the
config first breaks that ordering. So `ensure()` takes an optional explicit
mode, and the caller resolves it. `gitExclude` stays ignorant of the config
format, which also keeps `frameProject → gitExclude` one-way.

### D6 — The `×` becomes a gear; Remove moves inside

The project row keeps exactly one hover-revealed button. It opens Project
Settings, and "Remove from Frame" becomes a destructive action at the bottom of
that modal, behind its existing confirmation. Removing a project is rare;
changing its settings isn't — and a one-click `×` beside a project name was
always a slightly nervous affordance.

### D7 — The discovery hint reuses the spec-driven hint pattern

`specDrivenHint` already solves this exact shape: a popover anchored to an
element, a "Don't show again" that persists, and an evaluate-on-project-change
lifecycle that tolerates being called repeatedly. The sharing hint is the
same mechanism pointed at a different condition, anchored to the project row's
new gear.

Its dismissal belongs in **user settings, keyed by project path** — the same
call `specDrivenHint.markDismissed()` makes, for the same stated reason
(`specDrivenHint.js:184-188`): whether you want to be nudged is a preference
about Frame's UI, not a fact about the project. Writing it into
`.frame/config.json` would also mean one teammate's dismissal silently
travelling to everyone else in repo mode.

**The signal, entirely local — no network:**

```
repo has a remote  AND  >1 distinct author in the last ~200 commits
                   AND  declared mode is local
                   AND  not dismissed for this project
```

Both git reads are cheap and already the kind of thing `gitExclude` does with
`execFileSync`. The author count is a heuristic, deliberately: it's the
cheapest available proxy for "other people work here", and being wrong costs
one dismissible popover.

### D8 — One telemetry event

`project_sharing_set: { mode: ['local','repo'], source: ['init','settings'] }`,
added to the registry in `src/main/telemetryEvents.js`.

We are building repo mode on a hypothesis, and the archaeology in Problem 6 is
a standing reminder of what happens when nobody can tell whether a thing is
used: three flags sat in every project's config for six months because nothing
observed them. Two enum values carry no path, no name, and nothing
identifying — consistent with what the registry already collects.

---

## Behaviour

### Git Sharing state matrix

| declared | `.frame/` tracked | git repo | exclude block | shown as |
| --- | --- | --- | --- | --- |
| *absent* | no | yes | written | Local — derived and persisted (D4) |
| *absent* | yes | yes | removed | Repo — derived and persisted (D4) |
| `local` | no | yes | written | **Local.** "`.frame/` is hidden from git on this machine." |
| `local` | **yes** | yes | **removed** | **Repo (effective).** Warning + command (S4) |
| `repo` | no | yes | removed | **Repo.** "`.frame/` now appears in `git status` — commit it to share it." |
| `repo` | yes | yes | removed | **Repo.** Settled; no notice. |
| any | — | **no** | n/a | Toggle disabled — "Not a git repository." |

### S4 — the one conflicted state

Declared `local`, `.frame/` tracked. Frame removes nothing from git and does
not re-hide files it cannot actually hide. The modal says:

> `.frame/` is committed to this repository, so it's shared with everyone who
> clones it — this setting can't hide it. To make it local again, run
> `git rm -r --cached .frame` and commit that.

with a copy button. The next project open sees an untracked `.frame/`, writes
the block, and the two modes agree again.

### Init modal

The existing `initialize-frame-modal` gains a compact options block below the
file list:

- **Spec-Driven Development** — default **on** (unchanged default).
- **Git Sharing** — default **local**, phrased as a choice: *Local to this machine* /
  *Shared in the repository*. Hidden entirely when the folder isn't a git repository.

Both answers ride the `INITIALIZE_FRAME_PROJECT` payload and are applied before
any file is created: the sharing choice drives the pre-mkdir `ensure()` call
(D5), and both are baked into the config template rather than written then
rewritten. `.frame/.gitignore` is written either way (D2).

### Project Settings modal

Opened by the project row's gear, and by the spec-driven hint popover.
Sections:

1. **Header** — project name, absolute path.
2. **Workflow** — Spec-Driven Development toggle, copy moved verbatim from app
   Settings.
3. **Sharing** — Git Sharing toggle, current-state line, S4 warning when it
   applies.
4. **Remove from Frame** — destructive action, existing confirm dialog,
   existing semantics (list only; no files deleted).

With no project open the entry points don't exist, so the "open a project
first" empty state that app Settings needs today disappears.

### Sharing hint

When D7's signal holds, a popover appears against the project row's gear after
the same short delay `specDrivenHint` uses:

> **This looks like a shared project**
> `<n>` people have committed here, but Frame's specs and notes stay on
> this machine. Sharing puts them in the repository — machine-local files stay out.
>
> [Don't show again] [Share in the repository]

"Share in the repository" performs the same write as the modal's toggle, so there is
one code path for the transition and one place where it can go wrong. Dismissal
is permanent for that project. The hint never appears in a non-git folder, in a
single-author repo, in a repo with no remote, or on a project already in repo
mode.

### App Settings modal

The `Workflow` section is deleted. What remains: Privacy & Analytics, About.

---

## Acceptance criteria

1. Fresh init on a git repo, defaults accepted → config has
   `settings.gitSharing: "local"` and `features.specDriven: true`; the exclude
   block is present; `.frame/.gitignore` exists; `git status` is clean.
2. Fresh init with **Shared in the repository** → config has `"repo"`; **no** exclude
   block was ever written (not written-then-removed); `git status` shows
   `.frame/` untracked and **does not** list `runtime/`, `index/`,
   `implement-permissions.json`, `worktrees/`, `orchestration/` or generated
   `bin/*.js` beneath it.
3. Opening a pre-upgrade project with an untracked `.frame/` persists
   `"local"` and changes no observable behaviour; one with a tracked `.frame/`
   persists `"repo"` likewise. Both gain `.frame/.gitignore`.
4. Toggling local → repo on an untracked project removes the block
   immediately; `git status` shows `.frame/` on the next refresh, machine-local
   paths still absent. Nothing is staged or committed.
5. Toggling repo → local on a **tracked** project shows the S4 warning, leaves
   git untouched, writes no exclude block. After the user runs the suggested
   command and reopens, the block appears and the warning is gone.
6. In a non-git folder the Git Sharing toggle is disabled and explains why; init
   hides the choice entirely.
7. App Settings has no project-scoped controls. Spec-Driven appears only in
   Project Settings, and its behaviour (flag write, hint dismissal, Specs-panel
   refresh) is identical to today's.
8. The project row exposes one gear button; Remove lives in the modal and still
   deletes nothing on disk.
9. `gitExclude.ensure()` and the `.frame/.gitignore` writer are both idempotent
   and self-healing across every row of the matrix, called repeatedly.
10. A new project's `config.json` has no `autoUpdateStructure`,
    `autoUpdateNotes` or `taskRecognition`; an existing project's config keeps
    whatever it has.
11. In a multi-author repo with a remote and local mode, the hint appears
    once; "Share in the repository" flips the mode through the same path as the
    modal toggle; "Don't show again" survives a restart and a project switch.
    No hint in a single-author repo, a remote-less repo, a non-git folder, or a
    project already in repo mode.
12. `project_sharing_set` fires on the init choice and on every later change,
    with the right `source`, and is rejected by `validateEvent` if given a
    value outside its enum.

---

## Open questions

None blocking. Two things noted for later, deliberately outside this spec:

- **The stale privacy copy** in App Settings (see Non-goals) — its own change,
  its own review.
- **Per-project AI tool selection** (see Non-goals) — a real feature, a
  separate spec.
