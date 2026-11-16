---
keywords: frame cloud, app header, header entry, waitlist, early access, cloud window, pitch, tour
related: frame-cloud-projects, frame-cloud-early-access, frame-cloud-no-workspace, frame-cloud-roles, frame-cloud-teammate-connection, shell-chrome-app-header-collapsible-panels
---

# Frame Cloud header entry and window tour

## Problem

Frame Cloud is hard to find and, once found, does not say what it is for.

- **The entry is one of six icons at the foot of the sidebar rail** (Add Server,
  Plugins, Feedback, Frame Cloud, Settings, Guide). A bare cloud reads as sync
  or backup, not as planning and briefs. Hiding the sidebar hides it too.
- **The signed-out window sells the wrong thing.** Its title is "Your Frame
  projects, on every machine and on the web", and the Brief Board is one of
  five bullets. Nothing says that a brief is discussed and split with the
  agent, becomes specs and tasks in the folder, and is followed from GitHub.
- **Parts of the pitch are not true in Frame.** "Live sessions" and "Specs on
  the web" have no counterpart in Frame. "Connect a project once and it reads
  Connected on your laptop and your desktop" contradicts
  frame-cloud-teammate-connection (each device connects with a click).
- **The pitch assumes a team.** Frame Cloud also works for one person with a
  workspace of their own.

## Goal

1. **A Frame Cloud entry in the app header**, right of the Frame mark, with a
   text label that follows the session:

   | Session | Entry shows | Tooltip |
   | --- | --- | --- |
   | No server address (`unavailable`) | nothing; the header is today's | n/a |
   | Signed out, server open or unknown | cloud icon · "Frame Cloud" | Frame Cloud |
   | Signed out, invite-only, not on the list | cloud icon · "Join Frame Cloud waitlist" · tag "Early access" | Frame Cloud · Early access · Join the waitlist |
   | Signed out, invite-only, on the list | cloud icon · "Frame Cloud" · tag "On the list" | Frame Cloud · Early access · You're on the list |
   | Signed in, no workspace | cloud icon · "Frame Cloud" · tag "No workspace" | Frame Cloud · No workspace |
   | Signed in, with a workspace | workspace initial · workspace name | Frame Cloud · `<workspace>` · `<Role>` |
   | Any state, narrow window | cloud icon only | the state's tooltip |

   A click opens the existing Frame Cloud window. The waitlist call disappears
   once this machine has joined, and is not shown again.

2. **The rail's Frame Cloud button is removed.** The foot keeps five buttons.

3. **The signed-out window's left side becomes a five-step tour** with Back,
   Next and step dots. The right card (waitlist or sign-in, and every sign-in
   step) is unchanged and stays in place on every step.

   | Step | Title | Example it shows |
   | --- | --- | --- |
   | Overview | Plan the work where the code is. | six features in two columns: a board for your plan, decide with your agent, briefs become specs and tasks, progress from GitHub, milestones, solo or with a team |
   | Board | One board, from idea to done. | milestone strip; Backlog / Active / Done; the Active card lists its three parts with their states |
   | Discuss | Talk a proposal through with your agent. | brief chip, two lines of talk, the record on the brief, Move to Work |
   | Shape & Start | The brief becomes specs and tasks. | a brief shaped into three parts: one on its branch, two "Not started · Begin" |
   | Track | Progress comes from GitHub. | part rows: Merged into main, PR in review, Implemented; Move to Done |

   The trust line under the tour reads "Your code stays on your machines.
   Frame Cloud stores briefs, project names and branch names, never your
   source."

The agreed look is in two mockups: the header entry
(https://claude.ai/artifact/89HNZmYiYzyr7zqb1AUryU) and the window, alternative
D (https://claude.ai/artifact/RKXuhHk3sPHNM9eBgtFs6g).

## Constraints

- **This reverses frame-cloud-projects' placement** ("a rail cloud icon").
  Two of its rules stay: the entry never carries a badge or a dot for
  activity, and the window never opens by itself except the sign-in landing.
- **Nothing is drawn without a server address.** A build with no address shows
  today's header, so open-source builds do not change.
- **No new storage, no new IPC channel, no new request.** The entry reads the
  session state the renderer already receives. The waitlist join is already
  remembered in user settings (`cloudWaitlistEmail`, frame-cloud-early-access)
  and reaches the renderer while signed out, together with `inviteOnly`.
- **Words stay in their modules.** Early-access words belong to
  `cloudEarlyAccess.js`, no-workspace words to `cloudNoWorkspace.js`, role
  words to `cloudRoles.js`. No string names a plan, trial, price or "Pro";
  the existing tests guard that and must cover the new strings.
- **The role is in the tooltip only**, never on the entry itself.
- **The entry is quiet.** No filled or accent-coloured button in the header.
  The waitlist call is one step brighter than the other labels, nothing more.
- **Every tour claim is something Frame does today.** "Live sessions", "Specs
  on the web" and "Every machine, one project" leave the window.
- **Tour examples are static.** They are drawn from fixed sample data, never
  from the user's briefs, and read no cloud state.
- **The tour never gates the right card.** Joining the waitlist or signing in
  works on any step, and the card's panes keep swapping in place.
- **Plain text only.** Every string goes through `textContent`.
- **The label rule and the tour's steps live in pure modules**, covered by
  `node --test`. The repo has no DOM harness.
- **Every theme.** The entry and the tour use design tokens and read in every
  theme in `themes.js`.
- **The header stays one row.** At a width where the label does not fit, the
  entry drops to its icon. Nothing in the right cluster moves or wraps.

## Success Criteria

- When no server address resolves, then the header shows no Frame Cloud entry
  and the rail's foot shows five buttons.
- When signed out on an open server, then the entry reads "Frame Cloud" and a
  click opens the window on the tour's first step with the sign-in card.
- When the server is invite-only and this machine has not joined, then the
  entry reads "Join Frame Cloud waitlist" with an "Early access" tag, and a
  click opens the window with the waitlist form.
- When a waitlist join succeeds, then the entry changes to "Frame Cloud" with
  an "On the list" tag without a restart, and it reads the same after a
  restart.
- When "Use another address" is pressed in the window, then the entry reads
  "Join Frame Cloud waitlist" again.
- When signed in with a workspace, then the entry shows the workspace's
  initial and name, and its tooltip names the role.
- When signed in without a workspace, then the entry reads "Frame Cloud" with
  a "No workspace" tag.
- When the sidebar is hidden, then the entry is still in the header and opens
  the window.
- When the window is narrower than the label needs, then the entry shows the
  cloud icon alone and its tooltip gives the full state.
- When Next is pressed on steps one to four, then the next step shows; on step
  five Next is disabled, and Back is disabled on step one.
- When a step dot is pressed, then that step shows.
- When the step changes, then the right card keeps its pane, its typed email
  and its focus, and the window's size does not change.
- When the session becomes signed in, then the tour is replaced by the
  signed-in view, as today.
- When the window is closed and opened again while signed out, then the tour
  starts at step one.
- When the palette runs "Frame Cloud: Open", then the window opens as before.

## Out of Scope

- The signed-in window (account, Cloud projects, On this device)
- Listing a brief's parts on the real Briefs card
- Where "Learn more" leads
- A Frame Cloud chapter in How to Use Frame, or a step in the guided tour
- The light themes' own palette work beyond using tokens
- Cloud-held project context (the `cloud` sharing mode)

## Open Questions

- **What the entry shows when signed in.**
  - The workspace name with its initial (recommended): it reads as team
    identity, like the workspace switchers people know.
  - Always "Frame Cloud": simpler, but says nothing about who is signed in.
- **What the entry says when signed out on an open server.**
  - "Frame Cloud" (recommended): quiet, and the window makes the case.
  - "Sign in to Frame Cloud": clearer, but a standing call to action in the
    header for people who do not want an account.
- **Whether the tour is reachable once signed in.**
  - Signed out only (recommended): the signed-in window is about the account
    and projects.
  - Also a "What's in Frame Cloud" link in the signed-in window.
