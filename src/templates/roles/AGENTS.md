# Role: {{ROLE_NAME}}

This folder is a **role** — a per-process playbook that builds up procedural memory across sessions. The user opens a fresh AI session inside this directory whenever they want to execute the `{{ROLE_NAME}}` process. Read this file first; it tells you everything you need to do.

---

## Behavior Protocol

You are an AI assistant working inside a role folder. Follow this protocol on every session:

1. **On session start, read this file in full** (and any other `.md` in this folder, e.g. `playbook.md`). These files are the single source of truth for the `{{ROLE_NAME}}` process.
2. **Decide the mode based on the state of `Steps` and `Commands` below:**
   - If `Steps` and `Commands` are empty or only contain placeholders → **first-run mode**: walk the user through the process, ask questions as needed, and capture each decision, command, and gotcha as you go.
   - If `Steps` and `Commands` are populated → **delta-only mode**: follow them as written. Only ask the user about what is genuinely new or changed for this run (new version number, different target, fresh inputs). Do not re-explain the procedure or re-ask settled questions.
3. **At the end of a run**, propose concrete updates to this file (and `playbook.md` if useful) — new steps learned, commands that worked, edge cases hit. **Do not write to these files without explicit user approval.** Show the proposed diff, wait for "yes" / "ok" / "approve", then write.
4. **If the role files are absent or empty**, treat the run as first-time and offer to capture it.

This protocol lives inside the role folder so any AI tool — with or without a Frame runtime — can execute it by reading this file alone.

---

## Purpose

<!-- One or two sentences: what this role exists to do, and when the user invokes it. Replace this comment after the first run. -->

_To be captured on first run._

---

## Steps

<!-- Ordered list of the actual steps to execute the process. Each step should be concrete enough that a fresh session can follow it without re-asking the user. -->

_To be captured on first run._

1. _…_
2. _…_
3. _…_

---

## Commands

<!-- The exact commands, scripts, or API calls used. Include flags, env vars, and any pre/post conditions. Code blocks please. -->

_To be captured on first run._

```bash
# example: npm run release -- --tag <version>
```

---

## Notes

<!-- Gotchas, decisions, alternatives considered, things that broke last time. Anything a future run should know but doesn't fit into Steps or Commands. -->

_To be captured on first run._

---

## Capture Rules

- Update `Steps`, `Commands`, and `Notes` only after the user explicitly approves the proposed changes at the end of a run.
- Keep entries concrete: real commands, real version numbers, real file paths. Avoid vague advice.
- If a step is skipped or replaced, prefer editing the existing entry over appending a contradiction.
- This file is plain markdown checked into git — treat it as durable, reviewed documentation, not a scratchpad.
