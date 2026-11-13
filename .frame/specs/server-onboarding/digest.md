---
keywords: frame server, onboarding, sign in, server terminal, home terminal, git bundle, send project, check-up
related: server-workspaces, server-install-update, server-hardening, server-workspace-panels
---
A first-time user can finish setting up a server without leaving Frame.

**Sign-ins.** The Connect dialog opens a terminal on the server in the user's home folder ("Open terminal on server"); each missing check-up item's "Open terminal" opens one with its fix command typed, not run. These home terminals (`location: 'server-home'` → `terminals.create { home, homeFor, homeWorkspace }`) are lanes in the current view labelled `Server · <host>`, adopted back by `homeFor`, with the usual server-terminal rules. The check-up re-runs once when the dialog reopens.
**Sending a project.** A new server workspace for a project the server lacks sends its committed history as `git bundle … HEAD --branches --tags` over SSH (`serverInstaller.upload` to `.frame-server/tmp/receive-*.bundle`); `projects.receive` clones it into a partial folder, sets `origin` (or removes it) and `frame.root`, renames it into place and always deletes the bundle. Projects are known by remote, else by root commit. Uncommitted changes never move; the count is reported.
**Why this path.** Bundle first, always: a credential-less clone from GitHub can stall on prompts. Rejected: agent forwarding (the key would be usable by every process on the server), copying the folder (secrets travel). The 2026-11-09 rule "code never travels from the Mac" now holds for uncommitted work only.
**Rules for future work.** New server methods rather than new parameters on old ones, so an older server says "Unknown method" and the desktop can ask for an update. Push and PR without `origin` answer how to add one.
**Gaps.** Not yet run against a real server (the field test). The server clone stays at the sent history until the user signs in there and `git fetch` works. Codex's localhost-callback login is out of scope.

Chain: spec.md → plan.md → tasks.md → outcome.md
