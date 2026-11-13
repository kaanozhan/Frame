
## T01 — Let Frame Server receive a project from a bundle

Added serverRouting.projectKey (normalized remote, else `root:<sha>`) and projectDirNameFor (remote naming as before; a remote-less project gets its folder name made safe, reused when it already holds the same project, else -2, -3 …). src/server/projects.js gains `projects.receive`: the bundle must be a `receive-*.bundle` upload in `<server home>/tmp`; it is cloned into `.<dir>.partial-<pid>`, `origin` is set to the project's remote or removed, `frame.root` is recorded, and the folder is renamed into place — the bundle and any partial folder are removed in `finally`; a project already on the server (same key) is reused without cloning. clones() now keys remote-less clones by `frame.root` and skips partial folders, and `projects.list` reports `remote` and `root`. Deviation from the plan's wording: the bundle must also carry HEAD (`git bundle create … HEAD --branches --tags`), or the clone has nothing to check out — T02 creates it that way.

_Captured: 2026-11-11 · 5 file change(s)_

---

## T02 — Send a project from the desktop

Added gitBranchesManager.createBundle (`git bundle create … HEAD --branches --tags`) and rootCommit, and exported serverInstaller.upload. workspaceManager.ensureOnServer replaces the server-side clone-by-remote for new server workspaces: it finds an existing server clone by remote or, for a remote-less project, by root commit; otherwise it bundles the project to a temp file, uploads it to `.frame-server/tmp/receive-<random>.bundle` (relative to the SSH login folder), calls `projects.receive` with the bare name, returns `sent.uncommitted` from the worktree status, and turns "Unknown method" into "Update Frame Server on <host> to send projects from this Mac"; the local temp bundle is removed in `finally`. serverProjectFor (listing) matches remote-less projects by root too. The New Workspace dialog says only committed history was sent and how many uncommitted changes stayed. Deviation: projects.receive (T01) now resolves a bare bundle name against `<server home>/tmp`, since the upload path is relative to the login folder; the containment check is unchanged. `projects.ensure` stays on the server for older desktops but the desktop no longer calls it.

_Captured: 2026-11-11 · 6 file change(s)_

---

## T03 — Refuse push and pull requests for a project without a remote

workspaceGitState.push, prDraft and prCreate first check `git remote get-url origin` in the workspace and, without one, answer "This project has no remote — add one (git remote add origin <url>) to push or open a pull request." This covers a project sent to the server without a remote (T02) and, as planned, a local project never connected to one, where git's own error was the message before.

_Captured: 2026-11-11 · 2 file change(s)_

---

## T04 — Open home terminals on Frame Server

`terminals.create` accepts `home: true` and `homeFor`: such a terminal opens in the server user's home folder with no project or workspace on the server (whatever cwd, project or workspace was passed), and remembers the desktop project it was opened for. `terminals.list` (and attach) now report `home` and `homeFor` for every terminal — false and null for workspace terminals, which are otherwise unchanged.

_Captured: 2026-11-11 · 2 file change(s)_

---

## T05 — Open and keep home terminals from the desktop

TERMINAL_CREATE with `location: 'server-home'` makes ptyManager open a home terminal on the server (`home: true`, `homeFor` = the local project or null, `homeWorkspace` = the current view) and never a local shell; while not connected it answers "Connect to a server first". Adoption now lists all server terminals once and takes workspace terminals by server workspace id, plus home terminals whose `homeFor` is this project (null with no project), placed back in the view they were opened in; the renderer also adopts with no project selected. terminalManager.createServerHomeTerminal opens it, names the lane `Server · <host>` (also on adopt), and types the given command after the shell's first output, without Enter. Deviation: the server also stores `homeWorkspace` (a small addition to T04's terminals.js) so a restarted desktop puts the lane back in its view rather than in main.

_Captured: 2026-11-11 · 5 file change(s)_

---

## T06 — Sign in from the Connect dialog

Added serverConnectModel.fixTerminalFor (a missing check-up item's single-line fix command, else null), noteFixOpened and takeRecheck. The Connect dialog's check-up head has "Open terminal on server", and every missing item with a fix gets "Open terminal" beside Copy: both close the dialog, open a `Server · <host>` home terminal in the current view (T05) and enter its lane, with the item's command typed and not run. The next time the dialog opens it re-runs the check-up once, so a finished sign-in shows as ready. The live check ran against a package built from this tree in a local stand-in home, not the field-test server: that run belongs to the user's first-time-user test.

_Captured: 2026-11-11 · 4 file change(s)_

---
