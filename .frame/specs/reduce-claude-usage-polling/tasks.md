# Tasks — Reduce Claude usage polling frequency

- T01 · Change `startPolling`'s default `interval` parameter from `60000` to `300000` in `src/main/claudeUsageManager.js`
- T02 · Update the `startPolling` JSDoc in `src/main/claudeUsageManager.js` to document the new default (`300000 = 5 minutes`)
- T03 · Confirm `init()` still calls `startPolling()` with no argument so the new 5-minute default takes effect, and leave the initial `setTimeout` fetch and both IPC handlers (`LOAD_CLAUDE_USAGE`, `REFRESH_CLAUDE_USAGE`) unchanged
- T04 · Launch the app and verify the usage bars populate on startup and still update on click, with no `API error: 429` under normal single-user use
