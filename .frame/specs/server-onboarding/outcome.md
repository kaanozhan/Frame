
## T01 — Let Frame Server receive a project from a bundle

Added serverRouting.projectKey (normalized remote, else `root:<sha>`) and projectDirNameFor (remote naming as before; a remote-less project gets its folder name made safe, reused when it already holds the same project, else -2, -3 …). src/server/projects.js gains `projects.receive`: the bundle must be a `receive-*.bundle` upload in `<server home>/tmp`; it is cloned into `.<dir>.partial-<pid>`, `origin` is set to the project's remote or removed, `frame.root` is recorded, and the folder is renamed into place — the bundle and any partial folder are removed in `finally`; a project already on the server (same key) is reused without cloning. clones() now keys remote-less clones by `frame.root` and skips partial folders, and `projects.list` reports `remote` and `root`. Deviation from the plan's wording: the bundle must also carry HEAD (`git bundle create … HEAD --branches --tags`), or the clone has nothing to check out — T02 creates it that way.

_Captured: 2026-11-11 · 5 file change(s)_

---
