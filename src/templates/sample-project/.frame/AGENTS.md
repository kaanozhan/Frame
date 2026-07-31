# TaskFlow — project layer

> **This is the sample project that ships with Frame.** It is a fictional
> codebase used to demonstrate Frame's workflow on realistic content. None of
> this code runs, and nothing here is a real dependency. When you're ready,
> open your own project to start real work.

Frame's own conventions — how to recognize a task, when to capture a note, the
spec workflow, structure upkeep — are not repeated here. They live in Frame's
global layer and are given to the agent at launch, so this file carries only
what is specific to TaskFlow.

## What's here to look at

- `.frame/tasks.json` — a worked task list, mid-flight rather than empty.
- `.frame/STRUCTURE.json` — the module map for `src/`.
- `.frame/PROJECT_NOTES.md` — decisions recorded as they were made.
- `.frame/specs/` — three specs at different phases: one done
  (`add-google-oauth`), one implementing (`migrate-to-postgres`), one still
  being specified (`email-notifications`).

Everything Frame writes stays inside `.frame/`. The project root holds only
TaskFlow's own files.
