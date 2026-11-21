---
keywords: frame cloud, start work, brief start, brief.start, shaped brief, part, work branch, stash, spec.plan
related: frame-cloud-brief-shape, frame-cloud-brief-discussions, frame-cloud-briefs-read-only, agent-dispatch
---

# Frame Cloud brief start

## Problem

A shaped work brief stops at "ready to run". Its parts are in the cloud as
definitions already written in Frame's own formats: `spec.md` sections for a
spec part, and `tasks.json` fields for a task part (frame-cloud-brief-shape).
But nothing brings them into the folder. The user has to copy each
definition into a spec or a task by hand, pick a branch, and start the first
step. The brief also stays in Backlog, because nothing tells the cloud that
work began.

FrameCloud is adding `brief.start({ id, parts: [{ partId, recordRef }] })`
(`brief-start` there). It sets `started_at` once, links every part to its
spec slug or task id, and makes the brief Active. It refuses a second start
with `ALREADY_STARTED`.

## Goal

**Start Work** on a shaped brief turns every part into a spec or a task on
a fresh work branch, marks the brief started, and opens a lane on the part
the user chose to begin with.

- **The button.** Open, shaped, unstarted work shows **Start Work** on the
  card and in the detail, where Shape used to be. It opens a Start Work
  dialog.
- **Where to begin.** The dialog lists the parts: title, `spec | task` and
  type. The user picks one of:
  - **Begin with <part>.** Every part is created, and a lane opens only on
    the chosen part.
  - **Create only.** Every part is created and no lane opens.
  - **Orchestrate**, shown disabled and marked *Coming soon*.
- **The branch.** For both Begin and Create only, a branch field is
  prefilled with a suggested name: the part's type as a prefix (`feature` →
  `feat/`, `fix`, `refactor`, `docs`, `test`), then the slugified title. For
  Begin the title is the chosen part's, and for Create only it is the
  brief's. The user can edit the name. A line under the field says what the
  branch is cut from: the brief's `targetBranch`.
- **A dirty folder.** When the folder has uncommitted changes, the dialog
  warns before anything is written. It names the current branch and the
  change count, and offers **Stash and continue** or **Cancel**.
- **The order.** On Start Work:
  1. Frame calls `brief.start` with every part's `recordRef`.
  2. It stashes, if the user chose that.
  3. It creates the branch from `targetBranch` and checks it out.
  4. It writes every part into the folder.
  5. It opens the lane, if the user chose Begin.
- **What a part becomes.**
  - A spec part becomes `.frame/specs/<slug>/spec.md` with the definition as
    its body, plus a `status.json` in phase `specified`.
  - A task part becomes a `pending` row in `.frame/tasks.json`, with
    `description`, `acceptanceCriteria` and `notes` taken from the
    definition's headings, and `category` from the part's type.
- **The lane.** For a spec part, the lane opens through the existing spec
  dispatch and runs `/spec.plan` on it, so the plan's decision gate settles
  the definition's Open Questions with the user. For a task part, the lane
  goes through the task-run path, and the task becomes `in_progress`.
- **After.** A toast says "Brief #N started: X specs, Y tasks on
  `<branch>`". Each part row in the detail links to its spec in the Specs
  panel or its task in the Tasks panel. The card leaves Backlog on the
  next reload.

## Constraints

- **One new write.** The earlier specs allow `brief.create`,
  `addAttachment`, `recordDiscussion`, `decide` and `shape`. This spec adds
  only `brief.start`.
- **Cloud first** (decided 2026-09-24). `brief.start` goes before any stash,
  branch or file. Its `ALREADY_STARTED` is what stops two machines from
  starting the same brief. A refusal leaves the folder untouched, and the
  server's codes read as sentences, as in Shape.
- **No agent writes the files.** Shape already wrote each definition in
  Frame's format, so main writes the spec and task files itself. A
  definition that does not parse (a task with no Description, say) is an
  error that names the part, and it is caught before `brief.start` is
  called.
- **Slugs and ids are decided before the call.** Each spec slug is checked
  against `.frame/specs/` and each task id against `tasks.json`. On a
  collision the slug gets `-2`, `-3` and so on, as in `spec.new`. The
  `recordRef` sent to the cloud is exactly what gets written.
- **Frame creates the branch, not the agent.** The task-run modal leaves an
  empty branch name to the agent. That does not work here, because the files
  must land on the branch before any lane opens. An empty field falls back
  to the suggested name.
- **Branch from `targetBranch`.** The base is the brief's `targetBranch`
  (decided 2026-09-24), not the current branch. It goes through
  `gitBranchesManager`'s create-and-checkout. When the name already exists,
  the dialog says so and writes nothing.
- **Stash only with consent.** Frame never stashes silently. The stash
  message names the brief ("Start Work #N"), and the toast repeats it.
- **The token stays in main** (frame-cloud-brief-discussions). The renderer
  asks main to start, and main holds the token and every write.
- **Lanes carry a purpose** (frame-cloud-brief-shape T06). A lane that
  Begin opens is a spec or task lane from the start, not a brief lane, so
  its assignment is `kind: 'spec'` or `kind: 'task'`.
- **Shape's notice** (frame-cloud-brief-shape T10). The "ready to run"
  toast's Open brief action keeps working, and the detail it opens now
  offers Start Work.
- **Tests** cover the pure core: the definition parsers, the branch-name
  suggestion, slug and id allocation, and the request handler. The Electron
  shell is not unit-tested, as in the earlier cloud specs.

## Success Criteria

- When an open, shaped, unstarted work brief is shown, then the card and the
  detail offer Start Work. An unshaped, started, closed or proposal brief
  does not.
- When the user picks Begin with a spec part and confirms, then
  `brief.start` is called once with every part, a branch with the given
  name is cut from `targetBranch` and checked out, every part exists as a
  spec or a task, and a lane runs `/spec.plan` on the chosen spec.
- When the user picks Create only, then the same files and branch exist and
  no lane opens.
- When the folder is dirty, then nothing happens until the user chooses
  Stash and continue or Cancel. Cancel changes nothing, locally or in the
  cloud.
- When `brief.start` is refused, then no stash, branch or file is made, and
  the refusal shows as a sentence.
- When a spec slug or task id is already taken locally, then the next free
  one is used, and that same value is the part's `recordRef` in the cloud.
- When a task part's definition has Description, Acceptance Criteria and
  Notes, then the task row carries them in `description`,
  `acceptanceCriteria` and `notes`, with the title kept within 60
  characters.
- When the start finishes, then a toast names the counts and the branch,
  and each part row in the detail opens its spec or task.
- When the Orchestrate option is shown, then it is disabled and reads
  "Coming soon".

## Out of Scope

- Orchestrate: running plan and tasks for several specs and dispatching
  them to the conductor.
- Worktrees per part or per brief.
- Writing the branch name to the cloud (it returns with Done).
- `merged`, `dropped` and Done for parts and briefs.
- Pushing the branch or opening a PR.
- Starting a subset of parts, or starting again.
- FrameCloud's `brief.start` itself (`brief-start` in that repo).

## Open Questions

- **Hand a dirty folder to the agent.** Should the dirty warning also offer
  **Let the agent handle it**? It would open a lane that commits or stashes
  with the user, and then Start Work would be run again. Or do Stash and
  continue plus Cancel cover the first slice?
- **A write that fails halfway.** If `brief.start` succeeds but the branch
  or a file write fails, the brief is started in the cloud while the folder
  is missing work. Should Start Work offer a **Create missing files**
  action on a started brief whose `recordRef`s are absent locally? Or is an
  error that names what was not written enough for now?
