---
keywords: dispatch, lane, agent-ready, prompt injection, task run, assignment
related: lane-orchestrator, agent-orchestration
---
Built the single choke point for sending work to an agent lane:
`agentDispatch.dispatch()` resolves/creates the lane, pre-flights the CLI,
waits for a real agent-ready signal (laneStatus `agentName` + `agent-input`,
15s fallback), then injects via `terminalSendPromptThenEnter`. Chosen over
blind timeouts after cold-start races; `agent-approval` deliberately does NOT
count as ready — a CLI stuck on a trust dialog must time out, not receive a
prompt into a y/n chooser. Lane `assignment` is set only after successful
injection (failed dispatches never relabel a lane) and is session-only by
construction. Task/spec run modals lost their terminal pickers — dispatch
decides. Rule established: all agent prompt delivery goes through dispatch,
never raw sendCommand.

Chain: spec.md → plan.md → tasks.md → outcome.md
