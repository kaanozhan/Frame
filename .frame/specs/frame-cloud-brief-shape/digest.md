---
keywords: frame cloud, brief shape, shape, work brief, brief part, part definition, lane purpose, command bus, brief.shape, notify action
related: frame-cloud-brief-discussions, frame-cloud-briefs-read-only, frame-cloud-briefs-create
---
Open, unshaped work briefs get a Shape button on the card and in the detail. It opens a lane with the default AI tool, and the lane reads a prompt staged under userData. The agent proposes a split and, on the user's yes, runs a staged `shape-brief.js` once, with every part as JSON on stdin. Main validates the parts (mirroring `shapeBriefInputSchema`) and calls `brief.shape` once. Server refusals come back as sentences.
Why this path: Shape has its own command, store and bus (`cloud-shapes/`) rather than a generalised Discuss command, because issued Discuss prompts name `record-discussion.js` by absolute path. The lane's purpose (`discuss` | `shape`) travels on its assignment instead of being inferred from the brief's kind, so a Discuss lane left open after Move to Work still reads Discussing. There is one lane per brief, whatever its purpose.
Deviations from the plan, from the walk:
- The prompt defaults to one part: small work is one task, anything bigger one spec, and it splits only when the work is too broad. It proposes without asking first.
- Definitions are written as `spec.md` sections (spec part) or `tasks.json` fields (task part), with detail gaps left under Open Questions / Notes.
- A shaped session ends on "ready to run".
- A shaped card shows "1 spec" / "2 specs · 1 task" (one `brief.getByNumber` per open shaped work brief).
- A landed Shape shows a `notify` toast with Open brief, since `notify` gained an optional action.
Rules for later: Run, not Shape, turns a part into a local spec or task. For a spec part, Run is meant to run specify seeded with the definition, which closes the Open Questions against the code as it is then. Never write a part into the repo from the Shape lane.

Chain: spec.md → plan.md → tasks.md → outcome.md
