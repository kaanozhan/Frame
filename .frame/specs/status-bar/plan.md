# Plan — status-bar

## Approach

**Shell.** `body` is a flex row holding the sidebar and main content. Rather
than re-parent that (every overlay is a body child), the bar is
`position: fixed` across the bottom and `body` gains a matching
`padding-bottom`. With the global `box-sizing: border-box`, `height: 100vh`
minus that padding is exactly the row's content box, so the sidebar and the
terminal grid shrink by the bar's height and nothing overlaps.

**Ownership.** The usage widget moves out of `terminalTabBar` into a new
`statusBar.js`: markup lives in index.html, and the module owns the
`CLAUDE_USAGE_DATA` listener, the initial `LOAD_CLAUDE_USAGE`, the
click-to-refresh and the fill/percent/reset formatting — moved verbatim, not
rewritten. The tab bar keeps only what it draws itself.

**Theme toggle.** Rendered by `terminalTabBar` at the end of its action
cluster and wired there, because that module already owns the boot-time
theme restore. The `index.js` binding goes away with the sidebar-rail button
— a listener attached in `index.js` to an element the tab bar renders later
would be the "Add new Project" bug again.

## Footprint

- index.html
- src/renderer/statusBar.js (new)
- src/renderer/terminalTabBar.js
- src/renderer/index.js
- src/renderer/styles/components/status-bar.css (new)
- src/renderer/styles/components/ui.css
- src/renderer/styles/main.css
