
## T01 — Let Frame Server receive a project from a bundle

Added serverRouting.projectKey (normalized remote, else `root:<sha>`) and projectDirNameFor (remote naming as before; a remote-less project gets its folder name made safe, reused when it already holds the same project, else -2, -3 …). src/server/projects.js gains `projects.receive`: the bundle must be a `receive-*.bundle` upload in `<server home>/tmp`; it is cloned into `.<dir>.partial-<pid>`, `origin` is set to the project's remote or removed, `frame.root` is recorded, and the folder is renamed into place — the bundle and any partial folder are removed in `finally`; a project already on the server (same key) is reused without cloning. clones() now keys remote-less clones by `frame.root` and skips partial folders, and `projects.list` reports `remote` and `root`. Deviation from the plan's wording: the bundle must also carry HEAD (`git bundle create … HEAD --branches --tags`), or the clone has nothing to check out — T02 creates it that way.

_Captured: 2026-11-11 · 5 file change(s)_

---

## T02 — Send a project from the desktop

Added gitBranchesManager.createBundle (`git bundle create … HEAD --branches --tags`) and rootCommit, and exported serverInstaller.upload. workspaceManager.ensureOnServer replaces the server-side clone-by-remote for new server workspaces: it finds an existing server clone by remote or, for a remote-less project, by root commit; otherwise it bundles the project to a temp file, uploads it to `.frame-server/tmp/receive-<random>.bundle` (relative to the SSH login folder), calls `projects.receive` with the bare name, returns `sent.uncommitted` from the worktree status, and turns "Unknown method" into "Update Frame Server on <host> to send projects from this Mac"; the local temp bundle is removed in `finally`. serverProjectFor (listing) matches remote-less projects by root too. The New Workspace dialog says only committed history was sent and how many uncommitted changes stayed. Deviation: projects.receive (T01) now resolves a bare bundle name against `<server home>/tmp`, since the upload path is relative to the login folder; the containment check is unchanged. `projects.ensure` stays on the server for older desktops but the desktop no longer calls it.

_Captured: 2026-11-11 · 6 file change(s)_

---
