---
keywords: frame cloud, connected, connect on this device, ready to connect, teammate, clone, device, disconnect, install id, project identity, briefs gate
related: frame-cloud-projects, frame-cloud-briefs-read-only, frame-cloud-roles, frame-cloud-no-workspace, frame-cloud-sign-in
---
Connected in Frame now means this person connected this project on this device (FrameCloud device-connections, #33); a project's identity is never a state on screen.
- Device: a stable install id (`userSettings.cloudInstallId`, never the session file or analytics id) goes with every `device.register`, so a sign-out and back in finds the same device and its connections.
- `link.release` is gone; `CLOUD_LINK_CONNECT { path }` and `CLOUD_LINK_DISCONNECT { projectId }` connect and disconnect this device only. Only a take-over drops everyone's connections.
- `matchFolders` gives project rows a `state` (connected | ready | notConnected | notClaimed) and folder rows `ready`; `folder.connected` (Briefs gate, mark, palette) reads `connection.thisDevice`. Cache version 2.
- A recognised clone reads Ready to connect and connects in one click in Cloud projects, On this device (listed first) and Project Settings. An unclaimed project reads Not claimed with a line on what claiming is, and offers Connect a folder….
- All connection copy lives in `src/renderer/cloudConnectionCopy.js`; "Already connected" for an identity became "Claimed".
Rules: Connected is per device and per member; the server does not refuse brief calls from unconnected devices, so Frame's gate is the rule; new connection copy goes into `cloudConnectionCopy.js`.
Deferred: the in-app walk against a live FrameCloud was not done (user's call, 2026-11-15) and is to be walked in full later; the checklist is in outcome.md, "Deferred: app walk".

Chain: spec.md → plan.md → tasks.md → outcome.md
