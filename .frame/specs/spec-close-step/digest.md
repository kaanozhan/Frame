---
keywords: spec close, digest, close step, digest check, reminder hook, fix after close, determinism
related: spec-knowledge-layer, codex-parity, activity-monitor, agent-orchestration, implement-modes-v2
---
Made the digest part of closing a spec: the implement template writes it in the last task's commit, `spec-close.js` checks its shape, and a hook reminds only the session that closed the spec.

- Disk state only (`scripts/spec-close-state.js`): no git, no commit, no edit content, so local and repo sharing modes behave alike; `CLOSE_ITEMS` is the list decision cards join later.
- `spec-close.js <slug>` names each defect (front-matter, `keywords:`, a first sentence over 280, `Chain:`), exits 0 unless `--strict`, writes only a `spec.close_checked` row and never a phase; `done` stays derived from task state.
- The reminder (`docs-hint` pre-edit, `spec-hint` prompt) reaches only the session that closed the spec, worded as its own unfinished work; any other session records `closed-earlier`. Rejected: telling every session until the digest exists (pilot: noise in unrelated chats), a pre-commit check (ties Frame to git, blind in local mode), a digest commit of its own.
- A fix after the last task carries a `## Fix —` outcome entry, and a `Revised <date>:` digest line when it changes a decision, in its own commit; the rule rides the prompt-time hint for finished specs and the edit-time history.
- `node .frame/bin/spec-close.js *` is in Frame's autonomous allowlist; auto mode once blocked it.
- Result on claude-opus-5-5: natural 10/10, earlier-close, fix-bug and fix-decision 30/30, closing-turn 26/30 acted and 4/30 asked the user first. Codex: payload fixtures only.
- Rules: a meta record rides with the work it describes, never in a commit of its own; a reminder speaks only to the session whose work it is.

Chain: spec.md → plan.md → tasks.md → outcome.md
