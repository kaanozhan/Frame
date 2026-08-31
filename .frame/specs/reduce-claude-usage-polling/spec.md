# Reduce Claude usage polling frequency

## Problem

The Claude usage indicator (Session / Weekly percentage bars in the
terminal tab bar) intermittently fails with an `API error: 429` from
`/api/oauth/usage`.

`src/main/claudeUsageManager.js` polls that endpoint every **60 seconds**
(`startPolling`, default `interval = 60000`). The usage figures change
slowly, so once-a-minute polling is far more aggressive than needed and is
the most likely cause of the rate-limit (429) responses. On top of the
timer, an init `LOAD_CLAUDE_USAGE` request and a manual `REFRESH_CLAUDE_USAGE`
on each click of the bars add further calls.

## Goal

Lower the steady-state request rate to the usage endpoint by increasing the
polling interval to a value that still keeps the bars usefully fresh but
stops tripping the 429 rate limit.

## Constraints

- **Scope is the polling interval only.** Do not change the 429 handling,
  caching behaviour, `Retry-After` logic, or the renderer error UX in this
  spec — those are separate, deferred ideas.
- Manual refresh (clicking the usage bars → `REFRESH_CLAUDE_USAGE`) must
  keep working unchanged, so the user can still force an immediate update.
- The initial fetch shortly after window load must stay, so bars populate
  on startup without waiting a full interval.

## Success criteria

- The default polling interval in `claudeUsageManager.js` is raised from
  60s to a longer interval (target: 5 minutes / 300000 ms).
- After the change, the usage bars no longer trigger 429s under normal
  single-user use.
- Bars still populate on startup and still refresh on click.

## Out of scope

- 429-specific handling and `Retry-After` backoff.
- Preserving cached values on error instead of showing `N/A`.
- Any renderer-side error UI changes in `terminalTabBar.js`.
