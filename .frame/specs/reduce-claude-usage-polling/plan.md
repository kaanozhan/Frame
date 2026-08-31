# Plan — Reduce Claude usage polling frequency

## Architecture

The Claude usage feature lives entirely in `src/main/claudeUsageManager.js`.
It fetches `/api/oauth/usage` and broadcasts the result to the renderer via the
`CLAUDE_USAGE_DATA` IPC channel. There are three paths that hit the endpoint:

1. **Periodic poll** — `startPolling(interval = 60000)` sets a `setInterval`
   that calls `sendUsageToRenderer()` every `interval` ms. `init()` invokes
   `startPolling()` with no argument, so the default value is the live interval.
2. **Initial fetch** — `startPolling` also schedules a one-shot `setTimeout`
   (~2s after window ready) so the bars populate on startup.
3. **On-demand fetches** — the `LOAD_CLAUDE_USAGE` and `REFRESH_CLAUDE_USAGE`
   IPC handlers each call `fetchUsage()` directly.

This spec touches **only path 1**: raise the default polling interval from
`60000` (1 min) to `300000` (5 min). The single source of truth is the default
parameter value of `startPolling(interval = 60000)`, because `init()` calls it
with no argument. No data shapes change; no new components are introduced.
Paths 2 and 3 (initial fetch and manual refresh) are left exactly as-is per the
spec constraints.

## Files

- `src/main/claudeUsageManager.js` — **Modified** — Change the default
  `interval` parameter of `startPolling` from `60000` to `300000`, and update
  the accompanying JSDoc comment that documents the default (`60000 = 1 minute`
  → `300000 = 5 minutes`).

## Footprint

- src/main/claudeUsageManager.js

## Dependencies

None.

## Sequencing

1. In `src/main/claudeUsageManager.js`, change `startPolling`'s default
   parameter from `interval = 60000` to `interval = 300000`, and update its
   JSDoc line to reflect the new default (5 minutes). Leave the initial
   `setTimeout` fetch and both IPC handlers untouched. Verify `init()` still
   calls `startPolling()` with no argument so the new default takes effect.
