# agentlar için roller tanımlamayı düşünüyorum. aklımdaki fikir şöyle. mesela release için bir rol tanımlayacağım. onun ayrı bir klasörü olacak. md dosyaları olacak. bir kere süreci gerçekleştirdiğimizde ne yaptığını md dosylalarına yazacak. bir daha relase aldığımızda ben direkt o role gideceğim. yapacağı adımları artık biliyor olacak. mesela marketing için bir rol oluşturacağım. ilk yaptığımda yine öğrenecek ve localdeki md dosyalarına yazacak. bir dahaki sefere ne yapacağını bilecek. aslında yaptığımız şey bir yerde klasör yaratmak ve roller için md dosyaları yaratmak olacak ve ben yeni sessionı o dizinde açacağım. temel olarak aklımdaki şey böyle

## Problem

Recurring processes (release, marketing, deployment, etc.) require the same steps each time, but every new AI session starts cold. The user re-explains the process on every run, and hard-won procedural knowledge — the exact commands, the gotchas, the order of operations — disappears with the session. There is no durable, per-process memory the agent can pick up next time.

## Goal

A file-based "roles" system under the project: a `roles/` directory where each role (e.g. `roles/release/`, `roles/marketing/`) is its own folder containing markdown files that describe what the role does and how. On first run, the agent executes the process with the user, then writes the resulting playbook into that role's md files. On subsequent runs, the user opens a new session scoped to that role's folder; the agent reads the md files and already knows the steps — no re-explanation needed.

A role folder, at minimum, contains:
- a primary instructions file the agent reads on session start (e.g. `AGENTS.md` or `README.md`)
- one or more playbook md files capturing learned steps, commands, and decisions

## Constraints

- Local-only: roles live as plain files in the repo. No external service, no DB, no remote sync.
- Tool-agnostic file names: prefer `AGENTS.md` (with optional `CLAUDE.md` symlink) so any AI tool can pick it up — same convention this project already uses.
- A new session opened inside a role folder must work without any Frame-specific runtime: only the md files drive behavior.
- Do not modify the existing Frame spec/task workflow. Roles are additive.
- The agent writes/updates role md files only with explicit user approval at the end of a run, mirroring the existing PROJECT_NOTES.md pattern.

## Success Criteria

- When the user runs a "create role" action with a name, then `roles/<name>/` is created containing a starter `AGENTS.md` with placeholder sections (Purpose, Steps, Commands, Notes).
- When the user completes a process for the first time inside a role folder and approves saving, then the agent writes the executed steps and relevant context into that role's md files.
- When the user opens a fresh session with the working directory set to `roles/<name>/`, then the agent's first action is to read the role's md files and it can describe the next steps without the user re-explaining the process.
- When a role's md files already document a process, then on a subsequent run the agent follows them and only asks about deltas (new inputs, changed versions), not the full procedure.
- When a role's md files are absent or empty, then the agent treats the run as "first time" and offers to capture it.

## Out of Scope

- UI for managing roles (this spec is CLI/file-based only).
- Sharing or syncing roles across repos.
- Versioning, diffing, or rollback of role md files beyond what git already provides.
- Cross-role orchestration (a role calling another role).
- Auto-detection of which role applies to an arbitrary user request.
