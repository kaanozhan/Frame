---
keywords: git sharing, project settings, gitignore, exclude, spec-driven toggle, init options, telemetry, discovery hint
related: non-invasive-overlay, audit-q3-product-analytics
---
Made solo-vs-team a real product mode: `settings.gitSharing: "local"|"repo"` in
.frame/config.json, chosen at init and in a new Project Settings modal (opened
by a gear that replaced the row ×; Remove moved inside it). New
src/main/gitSharing.js owns the semantics (frameProject → gitSharing →
gitExclude stays one-way per D5); gitExclude.ensure gained an explicit mode
param. Sharing is safe by construction: Frame writes a signed
.frame/.gitignore (begin/end markers, not gitExclude's one-line form — it's
multi-line) listing runtime/, index/, implement-permissions.json, worktrees/,
orchestration/, whole bin/, and fsSafe suffixes. Tracked .frame/ always beats
a `local` declaration (S4 warns, shows `git rm -r --cached .frame`, never runs
it — Frame never stages/commits/untracks). Absent modes derive once from
tracked state and persist. Spec-driven toggle moved from App Settings to
Project Settings. The spec-driven hint is a bottom-left notice (the row
gear anchor tied it to the async project list, so it could silently never
appear), said once per project per session, hidden while the modal is open.
T09's sharingHint and `getRepoSignal` were then removed: a notice is earned
by a broken state, not a working choice. Telemetry: project_sharing_set {mode, source}. The three dead
config flags left the template; existing configs untouched. Init options
styling landed in panels.css (owns init-modal-*), not a new file.

Chain: spec.md → plan.md → tasks.md → outcome.md
