---
keywords: footprint, .frame layout, meta files, CLAUDE.md pointer, .claude/rules, storage seam, frameStore, projectId, migration, git exclude, local vs repo, file classes
related: audit-q3-cross-platform, audit-q3-generic-any-project, spec-knowledge-layer
supersedes: non-invasive-overlay (2026-06-02 revision)
---
Frame's meta files moved off the project root into `.frame/`, and delivery to
Claude Code became native: `.claude/rules/frame.md` (two lines, `@`-importing
`.frame/AGENTS.md`) replaced the `CLAUDE.md` symlink. Launch-time injection
(wrappers, `PATH`, `--append-system-prompt`) was rejected outright; a second
root-file fallback was rejected too — one mechanism beats two, at the cost of a
Claude Code version floor (the 2.1.x line).

`src/main/frameStore.js` is the only module that joins a meta path. Its rule:
overlay → root **only** if `config.files` names it and the file is there →
overlay. That `files` record is the sole migration fingerprint; a
`CLAUDE.md → AGENTS.md` symlink is a public convention and never proof. Legacy
projects keep working untouched until the user consents in a modal, so "Later"
costs nothing. `layoutMigration` backs every file up, byte-verifies, then
unlinks; untracked files are deliberately not "dirty" (in an unshared project
everything is untracked). Sharing is one setting: `repo` tracks `.frame/`,
`local` excludes it via `.git/info/exclude` while it stays untracked — Frame
never runs `git rm`, it warns with the command.

Rules for future work: never join a meta path outside `frameStore.js`
(`specManager.js` excepted, for specs); anything Frame writes belongs under
`.frame/` or the one pointer file; a user's root file is never read, moved or
replaced; `STRUCTURE.json` and `bin/` are classified derived but stay tracked;
derived state is never *rewritten* from an unreadable source (an old Frame
reading the root `tasks.json` of a migrated repo walked 21 specs back from
`done` — absence of data is not data). Upgrade Frame before pulling a migrated
repository.

Chain: spec.md → plan.md → tasks.md → outcome.md
