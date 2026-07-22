---
keywords: lane, home board, terminal cards, lane status, grid view, tab bar
related: agent-dispatch, agent-orchestration
---
Home became a board of lane cards (lane = terminal) with live derived status
badges (processing/waiting/idle) instead of dropping into a terminal; enter a
lane for the full view, jump between lanes, grid survives as watch-mode. The
tab-bar paradigm was retired. laneStatus derives state from PTY output
timing — stored state was rejected (drifts from reality). Naming rule of
record: code/DOM ids say "lane", user-facing UI says "Frame"/"Home".
Deliberately deferred (became agent-orchestration): lane = work-context
bundling of spec + tasks + branch metadata.

Chain: spec.md → plan.md → tasks.md → outcome.md
