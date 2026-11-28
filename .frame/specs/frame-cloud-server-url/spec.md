---
keywords: frame cloud, server url, release build, extraMetadata, https, session store, localhost, dev and packaged
related: frame-cloud-sign-in, frame-cloud-projects, frame-cloud-early-access
---

# Frame Cloud server address

## Problem

Packaged Frame ships with an empty server address (frame-cloud-sign-in D2),
so Frame Cloud is hidden in every release. The invite-only beta needs releases
that reach the production FrameCloud, and three things stand in the way:

- Hard-coding the address in source would make every fork and every
  `npm start` connect to production by default.
- The address is accepted with any scheme. An `http://` address sends the
  bearer token in clear.
- The dev Frame (`npm start`) and the installed Frame share
  `~/Library/Application Support/Frame` (`app.setName('Frame')`), and
  `cloud-session.json` holds one session for one server. Frame is built with
  Frame: the installed copy on production and a dev copy on a local FrameCloud
  overwrite each other's session, and one of them comes back signed out.

## Goal

- A release build carries the production address, given at build time. The
  repository never contains it. `npm start` and builds made without it behave
  as today: Frame Cloud hidden.
- A server address that is not `https` is refused, except loopback
  (`localhost`, `127.0.0.1`), which stays allowed in every build so the
  installed Frame can still reach a local FrameCloud.
- Sessions are stored per server address, so a production session and a local
  one live side by side.
- The release command warns when it runs without the address.

## Constraints

- Resolution order is unchanged: `FRAME_CLOUD_URL`, then the `cloudServerUrl`
  user setting, then the release default (frame-cloud-sign-in). The first
  non-empty candidate decides. A refused candidate leaves Frame Cloud
  `unavailable` with one log line; it does not fall through to the next.
- This overturns frame-cloud-sign-in D2 ("packaged default is empty") and its
  follow-up note ("the prod server URL is a one-line change to
  `DEFAULT_CLOUD_SERVER_URL`"). The default now comes from the packaged
  `package.json` field `frameCloudUrl`, written by electron-builder's
  `-c.extraMetadata`, never from source.
- The address value is written nowhere in the repository: not in code, specs,
  README or scripts. The release script reads it from
  `FRAME_CLOUD_RELEASE_URL`. Release instructions are not documented in the
  repository.
- The release check warns and never fails, so forks can still build their own
  releases.
- frame-cloud-sign-in's token rules hold: safeStorage-encrypted at rest, never
  in the renderer, memory-only when safeStorage is unavailable. A session saved
  in the current format (version 1, one server) is still read after the change.
- `deviceFlow.js` stays pure; the scheme rule is tested there under
  `node --test`, without Electron.
- frame-cloud-projects D3's web-origin rule in `cloudProjects.buildWebUrl`
  (an https API requires an https web origin, loopback exempt) stays. The API
  rule uses the same loopback hosts.
- No new dependencies.

## Success Criteria

- When Frame runs from source with no `FRAME_CLOUD_URL` and no setting, then
  Frame Cloud is hidden, as today.
- When a release is built with `FRAME_CLOUD_RELEASE_URL=https://…`, then the
  packaged app's `package.json` carries `frameCloudUrl`, Frame Cloud is shown
  and points at that address, and the repository's `package.json` is unchanged.
- When a release is built without the variable, then the build succeeds,
  prints a warning that Frame Cloud will be off, and the app hides Frame Cloud.
- When the resolved address is `http://` on a host other than `localhost` or
  `127.0.0.1`, then Frame Cloud is `unavailable` and the log says why. When it
  is `http://localhost:<port>` or `http://127.0.0.1:<port>`, then it is used,
  in a packaged build too.
- When the installed Frame is signed in to production and a dev Frame signs in
  to a local server, then each is still signed in to its own server after
  either restarts.
- When the user signs out of one server, then only that server's session is
  removed.
- When Frame starts with a session file in the current single-server format,
  then that session is still signed in.

## Out of Scope

- Writing the production address or release instructions anywhere in the
  repository.
- A separate userData folder for dev builds.
- Settings → Devices, minimum client version and the other beta-readiness items.
- `cloud-projects.json` per server: it is a cache keyed by server and
  workspace, and a mismatch only refetches.

## Open Questions

- **The Discuss and Shape command buses share the same folder.**
  `cloud-discussions/bus` and `cloud-shapes/bus` also live in the shared
  userData, and every running Frame watches them. With two Frames open, the one
  that did not issue the id can claim a request and answer that the session is
  unknown. Options: (a) fix it here, so that a Frame that does not know the id
  leaves the request for the other; (b) keep it out of this spec as a separate
  task.
