---
keywords: frame cloud, connected, connect on this device, ready to connect, teammate, clone, device, disconnect, project identity, briefs gate
related: frame-cloud-projects, frame-cloud-briefs-read-only, frame-cloud-roles, frame-cloud-no-workspace, frame-cloud-sign-in
---

# Frame Cloud connection on a teammate's machine

## Problem

Berkay connects project A from his Frame. Deniz, a member of the same
workspace, clones A. On Deniz's machine A reads **Connected** and its Briefs
open, although Deniz never connected anything. The user reported this on
2026-11-14: "they see Connected without having connected their Frame App".

Connected should mean that this person connected this project on this
machine, so that Frame's changes reach the cloud and the cloud's reach Frame.
Today it means something else:

- **Connected belongs to the repository, not the device.** A folder is
  connected when its committed `projectId` equals the project's
  `frameProjectId` (`cloudProjects.js`, `matchFolders`). Every clone of a
  linked repository, on any machine, reads Connected with no click
  (frame-cloud-projects: "Any number of folders on any number of machines
  read Connected").
- **Briefs follow that.** Every brief call passes
  `cloudProjectsService.connectedProject()` (`cloudProjectsService.js:524`),
  which checks identity only. Deniz's clone lists, creates and moves briefs
  without connecting.
- **Disconnect disconnects everyone.** It calls `link.release`
  (`linkRelease`, `cloudProjectsService.js:469`), which clears the project's
  identity on the server. Every member's clone then reads Not connected.
- **Nobody can see whether they are connected.** The web shows one
  project-level "Connected" label. It does not say whether the viewer has
  connected on any device.
- **Two screens are also wrong today.** The "Not on this device" note asks
  for a Connect step after cloning that does not exist
  (`cloudHubTabs.js:204`). The take-over question says only "the other
  folder" will read Not connected, when every teammate's clone does.

## Goal

Connected means: **this device has connected this project.** Each member
connects on each of their devices, once. Briefs work in Frame only on a
connected device, and each user sees on the web whether they are connected.

- **One word, one meaning.** Connected is per device. The project's identity
  (`frameProjectId`) is not a state on any screen; it is only how Frame
  recognises a folder as a project's clone.
- **A recognised clone asks.** A folder whose `projectId` equals a project's
  identity, on a device not connected to that project, reads **Ready to
  connect**. Connect is one click: it records this device's connection in
  FrameCloud and writes no identity.
- **The first connection works as today.** Claiming a project that has no
  identity, or creating one, also records this device's connection.
- **Briefs need this device's connection.** `connectedProject()` returns a
  project only when a folder here carries its identity **and** this device is
  connected to it. The Context → Briefs row, the Connected mark and every
  brief call follow it.
- **Disconnect is this device only.** It removes this device's connection,
  and Briefs close here: the Briefs row goes and brief calls return
  `notConnected`. Nothing else changes. The project's identity, teammates'
  devices, the user's other devices and the folder all stay as they are.
  Frame no longer calls `link.release`, which FrameCloud removes.
- **The device survives a sign-out.** Frame sends a stable install id with
  `device.register`, so signing out and back in on this machine keeps its
  connections.
- **Screens.**
  - Cloud projects, Status, one of four:
    - **Connected**: this device is connected. On this device names the
      folder; the action is Open.
    - **Ready to connect**: a folder here carries the project's identity, and
      this device is not connected. The action is Connect, one click.
    - **Not connected**: the project has an identity and nothing here carries
      it. On this device reads "Not on this device".
    - **Not claimed**: no folder has been connected to the project yet. The
      action is Connect a folder…, with a suggested folder when there is one.
      A line under the chip says what claiming is: "Claiming picks the folder
      that is this project. After that, every member's clone of its
      repository is recognised and connects with one click."
  - A connected device with no folder here carrying the identity (the folder
    was moved or removed) reads Connected · Not on this device, with
    Disconnect. Adding a clone again needs no click.
  - The "Not on this device" note: add a clone of the repository with "Add a
    project…", then Connect.
  - On this device and Project Settings, when connected, carry one short
    explanation: connected on this device; each member connects on each of
    their devices; briefs and their progress go through Frame Cloud; code,
    specs and tasks move with git.
  - The Disconnect question: "Disconnect this device from A? Briefs stop
    showing here. Your teammates and your other devices stay connected, and
    the folder stays as it is."
  - The take-over question: replacing the project's identity disconnects
    every device of the project, teammates' included.

## Constraints

- **Depends on FrameCloud `device-connections`**, whose server part lands
  first. It provides the device ↔ project connection, connect and disconnect
  for the calling device, connection state in `project.list`, per-machine
  device identity, and the web's own-state label. It does not refuse brief
  calls from an unconnected device: Frame's gate is the rule.
- **Identity stays the folder match**: by `projectId` only, never by path,
  name or remote (frame-cloud-projects).
- **Nothing cloud-related is written into the project folder.** The
  connection lives in FrameCloud. The install id lives in Frame's app data,
  separate from the analytics install id, so analytics is never tied to an
  account.
- **Reading costs nothing new.** Connection state arrives in `project.list`.
  Connect and Disconnect are one request each. No timer.
- **Roles.** frame-cloud-roles decides who sees these screens: a viewer sees
  none of them, and Connect and Disconnect need `work`, as they do today.
- **Tests.** Copy in English, in one pure renderer module, with unit tests
  for the copy and the row and folder state logic (project convention: DOM
  untested).
- **No migration.** There are no users yet; the cloud database can be reset.
- **Decisions settled with the user on 2026-11-14:**
  - Connected is per device. Per person would repeat the problem across one
    person's machines.
  - The record lives in FrameCloud, because the web must show it.
  - Each user sees only their own state; whether a member is connected is
    that member's concern.
  - The server does not refuse unconnected devices; Frame's gate is enough.
  - Disconnect removes this device's connection and its Briefs, nothing
    else. `link.release` goes from the server; a project's identity changes
    only through take-over.
  - A project with no identity reads **Not claimed** in Frame, because what
    to do differs: choose its folder rather than connect a clone. A line
    explains claiming. The web makes no such distinction.
  - The GitHub connection is project-level and stays a separate matter.
  - "Linked" was dropped. An earlier draft added it as a second state word
    for "the project has an identity". It is a synonym of Connected, and the
    identity needs no word of its own.
- **This deliberately overturns:**
  - FrameCloud 2026-09-16 ("Identity, not authority"): a signed-in member
    reached a linked project and its briefs directly. Now each device
    connects; identity remains the folder match.
  - frame-cloud-projects: "Any number of folders on any number of machines
    read Connected"; Disconnect as `link.release`; Cloud projects' Status as
    "the link state exactly as the web shows it".

## Success Criteria

- When Deniz adds a clone of A on a device that has not connected A, then
  the folder reads Ready to connect, the Connected mark does not show, the
  Briefs row does not appear, and every brief call returns `notConnected`
  without a request.
- When Deniz clicks Connect, then one request records this device's
  connection, no identity is written, the folder reads Connected and Briefs
  appear.
- When Deniz opens A on the web, then before connecting it reads "Not
  connected", and afterwards "Connected on <device name>".
- When Deniz clones A on a second machine, then that machine reads Ready to
  connect, although his first one is connected.
- When Deniz disconnects, then his Briefs row goes, brief calls return
  `notConnected`, and his folder reads Ready to connect. Berkay's device still
  reads Connected and A keeps its identity.
- When Deniz signs out and back in on the same machine, then A still reads
  Connected with no click.
- When a project has no identity, then its row reads Not claimed, with the
  line saying what claiming is, and offers Connect a folder…, never a
  one-click Connect.
- When a project has an identity and no folder here carries it, then its row
  reads Not connected · Not on this device.
- When a folder claims a project without an identity, or creates one, then
  that device is connected in the same step, and the row reads Connected.
- When the take-over question is shown, then it says that every device of
  the project, teammates' included, will be disconnected.
- When the "Not on this device" note is opened, then it says to add a clone
  with "Add a project…" and then Connect.
- When any of these screens is drawn, then no request is made beyond
  `project.list`.

## Out of Scope

- FrameCloud's server and web work (`device-connections`, FrameCloud)
- The GitHub connection: a project-level setting on the web
  (frame-cloud-github-tracking)
- Showing other members' connection state (a team view)
- Opening Frame from the web (Frame registers no `frame://` link)
- Cloning a cloud project from Frame
- Sending local files (specs, tasks, `.frame/`) through the cloud
- Live updates to open screens (the WS hub)
