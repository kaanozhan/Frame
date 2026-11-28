---
keywords: frame cloud, start work, begin, where to work, project checkout, workspace, frame server, add a server, start dialog
related: frame-cloud-start-on-server, frame-cloud-start-workspace, frame-cloud-brief-start, server-copy-files, server-first-connect, server-onboarding, multi-server-connections
---

# Start Work in Three Places

## Problem

After `frame-cloud-start-on-server`, Start Work picks the part, the branch and
the location in one form. The location is a radio row under the branch,
shown only when a server is saved, with This Mac preselected. The dialog does
not say what each choice does. With no server saved, Start Work never tells
the user that a server is possible. The project checkout is not offered at
all: phase 1 (`frame-cloud-start-workspace`) removed it, so even a one-line
task waits for a workspace and its setup.

The user compared three variants of a two-step dialog in a prototype
(2026-11-25,
[Start Work Flow](https://claude.ai/artifact/M4vcsu1aA1Jxm9zZ61ah9t)) and
chose **A1 · Three places**.

## Goal

Start Work and Begin ask where the part runs by showing three equal places,
each saying what it does:

- **Two steps.** Start Work: 1 · What to work on (the parts that can be
  begun, Orchestrate shown disabled), Next, 2 · Where to work. Begin opens on
  step 2 for its part. Back keeps what was chosen.
- **Three cards, none picked.**
  - **Project checkout:** its path and current branch.
  - **New workspace:** on This Mac.
  - **Server workspace:** the connected servers' hosts.

  Each card lists three short facts (for example, "Keeps running while this
  Mac sleeps" for a server). Start stays disabled until a place is picked.
- **Server card states.**
  - **Two or more connected servers:** picking the card shows a Server select
    under the cards.
  - **Only offline servers:** the card is disabled, says "`<host>` is not
    connected." and offers Connect.
  - **No server saved:** a "No server yet" card explains what a server gives
    and offers Add a server…. That opens the existing Servers flow (Add,
    Connect, Install Frame Server, Check-up) and returns to Start Work with
    the new server picked.
- **Project checkout is locked**, with the reason on the card:
  - when the checkout has uncommitted changes ("N uncommitted changes here.
    Commit them to start in the project checkout.");
  - when another begun part is running there (it names that part and its
    branch).
- **The branch row appears once a place is picked**, set up for that place:
  - the default base is the local target for the checkout, and
    `origin/<target>` for a workspace or a server;
  - a server offers origin's branches only;
  - one line under the row says what will happen: the checkout switches from
    `<current>` to `<branch>`; the workspace's name and folder; for a server,
    the workspace on `<host>`, that the project is sent there first if
    missing, and that uncommitted changes stay on this Mac.
- **The Start button names the place:** "Start in project checkout", "Start
  in new workspace", "Start on `<host>`".
- **Project checkout start.** The part's branch is cut from the base and
  checked out in the project folder. The part is written there (`spec.md` and
  `status.json`, or the `tasks.json` row), and its lane opens there with no
  setup.
- **Card rows say where each part is:**
  - "Setting up the workspace" or "Setting up on `<host>`" while setup runs;
  - then the lane and the workspace chip;
  - for a part in the checkout, "project checkout · `<branch>`".

## Constraints

- **Overturns `frame-cloud-start-on-server` D2** (This Mac preselected):
  nothing is preselected and nothing is remembered (user, 2026-11-25). The
  default may change again later.
- **Overturns `frame-cloud-start-workspace`'s "the main checkout is never
  switched"** (user, 2026-11-25). The checkout comes back without any stash:
  a dirty checkout is locked, never stashed (`frame-cloud-brief-start`:
  never stash without consent). Main re-checks dirty and busy before
  `brief.start`, because the renderer is not trusted.
- **The workspace and server paths keep their effects**
  (`frame-cloud-start-on-server`): the server preflight, origin-only bases,
  no fallback, `localMode` refusing servers, Send files before setup, and the
  begun `serverKey`. This spec changes how they are chosen, not what they do.
- **Every check runs before `brief.start`.** A failure after it is `partial`
  and names the step (`frame-cloud-brief-start`).
- **Reuse, don't rebuild:**
  - Add a server is the existing Servers dialog (`serverConnect.open({ add:
    true })`: `server-first-connect`, `server-install-update`,
    `server-onboarding`);
  - Send files is `sendFilesModal` (`server-copy-files`).
- **Still out:** Orchestrate stays "Coming soon"; one part per branch; no
  cross-workspace coordination.
- **Same code conventions:** words live in `cloudBriefsCopy.js`, and the
  start core stays pure (`cloudStart.js` effects go through `deps`).
- **One walk for both specs.** This spec's developer walk also covers
  `frame-cloud-start-on-server` T11 (user, 2026-11-25).

## Success Criteria

- **STEPS.** When Start Work opens on an unstarted brief, then step 1 lists
  the parts and Orchestrate disabled. Next shows step 2, and Back returns with
  the part kept. When Begin opens, then it shows step 2 for that part.
- **PLACES.** When step 2 opens, then the three cards show, none picked, and
  Start is disabled until one is picked.
- **CHECKOUT LOCKED.** When the project checkout has uncommitted changes or
  another begun part is running there, then its card is disabled with that
  reason, and a request for it is refused by main.
- **CHECKOUT START.** When the project checkout is picked and Start is
  pressed, then the branch is cut from the chosen base and checked out in the
  project folder. The part is written there, and its lane opens there with no
  setup. `brief.recordBranch` carries the branch and its base commit.
- **BRANCH PER PLACE.** When a place is picked, then the branch row shows
  that place's default base and menu, and the line under it says what will
  happen there.
- **SERVERS.**
  - When one server is connected, then its host is on the card.
  - When two or more are connected, then picking the card shows a server
    select.
  - When only offline servers are saved, then the card is disabled and offers
    Connect.
  - When none is saved, then Add a server… ends back in step 2 with the new
    server picked.
- **START LABEL.** When a place is picked, then the Start button names it.
- **ROWS.** When a part is setting up, then its row says so with its host if
  any. When its lane runs, then the row names the lane and the workspace
  chip, or "project checkout · `<branch>`".
- **UNCHANGED.** When a new workspace or a server workspace is picked, then
  the part starts as in `frame-cloud-start-on-server`, Send files included.

## Out of Scope

- Variants A2 (machine first) and A3 (location in the workspace)
- Orchestrate
- Stashing on start
- Moving a begun part between places
- Remembering the last place chosen
- Changes to New Workspace (⌘⇧N)
- Server bases that exist only on this Mac

## Open Questions

1. **When is the project checkout "busy" with another part?**
   - (a) The checkout is on a begun part's branch, and that part's spec or
     task is not done.
   - (b) A live lane of a begun part runs in the checkout.
2. **How does the card know a part was begun in the checkout?**
   - (a) The begun entry records it (for example `place: 'checkout'`).
   - (b) Inferred: a Mac entry with no workspace on its branch, while the
     checkout is on that branch.
