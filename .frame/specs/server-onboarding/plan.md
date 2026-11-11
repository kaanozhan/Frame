# Plan — Server onboarding: sign-ins and sending a project

## Architecture

### Resolved plan-time decisions

The user accepted every recommendation on 2026-11-11 ("önerilerinle ilerleyelim").

Business:
- **B1 Where the server terminal appears.** A normal lane in the current view, labelled `Server · <host>`, in whatever project and workspace is selected. Rejected: a terminal embedded in the Connect dialog (new terminal UI; gone when the dialog closes).
- **B2 How a project reaches the server.** The first time, always a `git bundle` sent over SSH; the server then points `origin` at the project's remote. Rejected: let the server clone from the remote first and fall back to a bundle (a server without credentials can stall on git's username or host-key prompts, and every first try would be a failed one).
- **B3 Keeping the server's clone current.** Once the user has signed in on the server, the normal `git fetch` in workspace create keeps it current. Until then the existing notice ("Couldn't fetch origin/<base> — started from the local copy") stands. Rejected: an incremental bundle before every workspace create (more upload and more code for a state that sign-in, now in Frame, ends).
- **B4 Identity of a project with no remote.** The project's root commit hash (the lowest-sorted parentless commit of `HEAD`), stored in the server clone's git config as `frame.root`. It survives renames and moves. Rejected: a Frame-stored project id (does not match from another Mac).

Technical:
- **T1 Test posture: everything testable.** Server receive and identity against temp repos; desktop send with a stubbed connection; home-terminal routing and adopt in the existing pty harness; the server's home flag with node-pty stubbed; pure rules in `src/shared`. Rejected: pure logic only.
- **T2 (silent) A new server method, not a new parameter.** `projects.receive` is new; `projects.ensure` stays as it is. An older server answers "Unknown method", which the desktop turns into "Update Frame Server to send projects from this Mac". No message changes meaning, so the protocol number stays 2 (server-hardening rule).
- **T3 (silent) What the bundle carries.** `git bundle create --branches --tags`: local branches and tags. Remote-tracking refs are not sent, so a base the user never pulled can be behind GitHub until the server fetches (B3).
- **T4 (silent) Where the bundle lands.** Uploaded to `~/.frame-server/tmp/receive-<random>.bundle` with the existing `serverInstaller.upload`. The server clones into `<projects>/.<dir>.partial-<pid>`, sets `origin` and `frame.root`, then renames into place. The bundle and any partial folder are removed in `finally`.
- **T5 (silent) The home terminal on the server.** `terminals.create` with `home: true` and `homeFor: <local project path>`: cwd is the server user's home, no project or workspace on the server. `terminals.list` reports `home` and `homeFor`. Adoption lists all terminals once and takes workspace terminals by server workspace id (as today) plus home terminals whose `homeFor` is this project.
- **T6 (silent) Typing a fix command.** The check-up's "Open terminal" opens a home terminal and writes the item's fix command **without** Enter. The user runs it, signs in, and the check-up re-checks when the Connect dialog opens next.
- **T7 (silent) No remote on push or PR.** `workspaceGitState.push`, `prDraft` and `prCreate` refuse with "This project has no remote — add one (git remote add origin …) to push or open a pull request." This applies locally too, where git's own error was the message before.

### Flows

Send a project (B2, T2–T4):
1. `workspaceManager.createOnServer` → `ensureOnServer(projectPath)`.
2. The identity is the normalized `origin` URL, or `root:<sha>` from `git.rootCommit`.
3. `projects.list` (now with `root`) finds an existing clone → use it (no resend).
4. Otherwise: `git.createBundle` to a temp file → `serverInstaller.upload` → `projects.receive { bundlePath, originUrl, root, name }` → `{ projectPath }`.
5. The result carries `sent: { uncommitted: n }` (from `trackedDirtyCount` plus untracked), and the dialog says only committed history was sent.

Server home terminal (B1, T5, T6):
- Connect dialog "Open terminal on server", or a check-up item's "Open terminal" → `terminalManager.createServerHomeTerminal({ command? })`.
- `TERMINAL_CREATE { location: 'server-home', projectPath, workspaceId }` → `ptyManager` → `terminals.create { home: true, homeFor }`.
- The lane lives in the current scope with a `srv-` id; input, resize, destroy, banners and pruning follow the existing server-terminal rules.

### Data shapes

```
projects.receive { bundlePath, originUrl|null, root, name } → { projectPath }
projects.list    → [{ projectPath, remote|null, root|null }]
terminals.create + { home: true, homeFor }
terminals.list   items + { home, homeFor }
TERMINAL_CREATE  + { location: 'server-home' }
createOnServer   → { …, sent: { uncommitted } } when a bundle was sent
serverRouting.projectKey({ originUrl, root }) → 'github.com/o/r' | 'root:<sha>' | null
```

## Files

- `src/server/projects.js` — **Modified**: `projects.receive`; `clones()` and `projects.list` know `frame.root`; partial and bundle cleanup
- `src/server/terminals.js` — **Modified**: `home` / `homeFor` on create and list
- `src/shared/serverRouting.js` — **Modified**: `projectKey`, `projectDirNameFor` (no-remote naming)
- `src/main/gitBranchesManager.js` — **Modified**: `createBundle`, `rootCommit`
- `src/main/serverInstaller.js` — **Modified**: export `upload`
- `src/main/workspaceManager.js` — **Modified**: `ensureOnServer` (lookup by key, bundle send, old-server message, uncommitted count); `serverProjectFor` matches remote-less projects by root
- `src/main/workspaceGitState.js` — **Modified**: no-remote refusal for push and PR
- `src/main/ptyManager.js` — **Modified**: `server-home` create route; adopt home terminals by `homeFor`
- `src/renderer/terminalManager.js` — **Modified**: `createServerHomeTerminal`, lane label, typed command
- `src/renderer/serverConnectModel.js` — **Modified**: `fixTerminalFor(item)` (which items get "Open terminal", with what text)
- `src/renderer/serverConnect.js` — **Modified**: "Open terminal on server" and per-item "Open terminal"; re-check on reopen
- `src/renderer/newWorkspaceModal.js` — **Modified**: "sent committed history only" and old-server notices
- `index.html` — **Modified**: the Connect dialog button
- `test/serverProjects.test.js` — **New**: receive from bundle (remote, no remote, corrupt bundle), identity by root, list
- `test/serverSendProject.test.js` — **New**: desktop send with stubbed connection and upload (bundle made, no resend, uncommitted count, old server)
- `test/serverTerminalsHome.test.js` — **New**: server home flag and list with node-pty stubbed
- `test/ptyTerminals.test.js` — **Modified**: server-home create route, home adopt
- `test/serverRouting.test.js` — **Modified**: `projectKey`, `projectDirNameFor`
- `test/serverConnectModel.test.js` — **Modified**: `fixTerminalFor`
- `test/workspaceGit.test.js` — **Modified**: push and PR without a remote

## Footprint

- src/server/projects.js
- src/server/terminals.js
- src/shared/serverRouting.js
- src/main/gitBranchesManager.js
- src/main/serverInstaller.js
- src/main/workspaceManager.js
- src/main/workspaceGitState.js
- src/main/ptyManager.js
- src/renderer/terminalManager.js
- src/renderer/serverConnectModel.js
- src/renderer/serverConnect.js
- src/renderer/newWorkspaceModal.js
- index.html
- test/serverProjects.test.js
- test/serverSendProject.test.js
- test/serverTerminalsHome.test.js
- test/ptyTerminals.test.js
- test/serverRouting.test.js
- test/serverConnectModel.test.js
- test/workspaceGit.test.js

## Dependencies

None.

## Sequencing

1. **Server receives a project.**
   - `serverRouting.projectKey` / `projectDirNameFor`.
   - `projects.receive` (clone from the bundle into a partial folder, set or remove `origin`, set `frame.root`, rename into place, clean up in `finally`).
   - `clones()` / `projects.list` report `root`.
   - Tests in `test/serverProjects.test.js` (remote, no remote, corrupt bundle leaves nothing) and `test/serverRouting.test.js`, failing first.
2. **Desktop sends a project.**
   - `gitBranchesManager.createBundle` / `rootCommit`; export `serverInstaller.upload`.
   - `workspaceManager.ensureOnServer`: lookup by key, bundle, upload, receive, `sent.uncommitted`, "Unknown method" → update message; `serverProjectFor` matches by root.
   - The notices in `newWorkspaceModal.js`.
   - Tests in `test/serverSendProject.test.js`, failing first.
3. **No remote on push and PR.** `workspaceGitState` refusal; cases in `test/workspaceGit.test.js`, failing first.
4. **Server home terminal on the server.** `terminals.js` `home` / `homeFor` on create and list; `test/serverTerminalsHome.test.js`, failing first.
5. **Desktop home terminal.**
   - `ptyManager` `server-home` route and home adopt by `homeFor`.
   - `terminalManager.createServerHomeTerminal` with label and typed command.
   - Cases in `test/ptyTerminals.test.js`, failing first; live check of the lane.
6. **Connect dialog.**
   - `serverConnectModel.fixTerminalFor`; "Open terminal on server" and per-item "Open terminal" in `serverConnect.js` and `index.html`; re-check when the dialog reopens.
   - Cases in `test/serverConnectModel.test.js`, failing first; live check against the field-test server.
