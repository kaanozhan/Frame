---
keywords: embedded migration, pre-overlay layout, .frame overlay, legacy root files, instruction restoration, git sharing posture, startup sweep
related: non-invasive-overlay, project-settings, activity-monitor
---
Pre-overlay projects now migrate themselves into `.frame/` — automatically, with
no prompt. `src/main/embeddedMigration.js` is the whole engine: `plan()`
inspects (artifact list from the legacy `config.json.files` manifest,
dispositions against `.frame/`, git dirty/tracked verdicts, restorable
instruction blocks) and writes nothing; `migrateProject()` executes; `sweep()`
walks `workspace.getProjects()` at startup, off the critical path.

Why this path: an unmigrated project feeds the agent two contradictory
instruction sets every session, so the rejected "warn and wait for approval"
posture was the broken option, not the safe one. Also rejected: a filesystem
scan for stray `.frame/` dirs (writes to repos Frame was never pointed at), a
per-open trigger (migrates a multi-project workspace one session at a time),
retention on the backup (Frame would delete user data on its own schedule), and
"remove and re-add" as failure advice (nothing travels through the registry).

Rules established: migration never acts on a name match alone — it needs a
fingerprint only Frame's init leaves (the `files` record in `config.json`, or a
`CLAUDE.md`/`GEMINI.md` symlink pointing at `AGENTS.md`), or a repo with its own
`tasks.json` + `QUICKSTART.md` gets relocated; `.frame/` always wins a dual-layout conflict, the root copy
goes to `.frame/migration-backup/` (ignored, never pruned); a legacy file dirty
in git defers the whole run, non-git projects get no equivalent guard; moves are
copy-verify-then-delete so an interruption leaves a duplicate, never a hole;
symlinks are removed **before** restoration or the write follows the dangling
link; `.claude/CLAUDE.md` is never recreated — old init read it without
unlinking it. The sweep is silent (one receipt, failures named, deferrals never);
the foreground path is a modal, because there the user is waiting.

Chain: spec.md → plan.md → tasks.md → outcome.md
