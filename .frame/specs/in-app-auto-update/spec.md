# In-app auto-update via electron-updater

## Problem

Frame currently has a *passive* update notifier — `src/main/updateChecker.js`
polls the GitHub Releases API every 6 hours and surfaces a small "new
version available" dot in the renderer. The user still has to:

1. Open the release page in a browser
2. Download the dmg manually
3. Mount it, drag-and-drop into Applications, replace the existing app
4. Re-launch

Adoption of new releases lags as a result. We ship a fix or feature
(like the spec-panel-refresh fix or the sample-project onboarding) and
existing users only see it days or weeks later — if at all.

## Goal

In-app auto-update: a user on v2.2.1 wakes up the next day to find that
v2.2.2 has been downloaded in the background, and a non-blocking prompt
asks them to "Restart to install". One click and they're on the new
version. No browser, no Finder, no drag-and-drop.

## Constraints

- **Mac path first.** Signing + notarization for arm64 is the platform
  we ship today. Windows / Linux can follow.
- **Must reuse existing infrastructure.** The dmg is already signed
  (Developer ID Application: KAAN OZHAN) and notarized. electron-updater
  needs the signature + `latest-mac.yml` + blockmap, all of which the
  current `npm run dist:mac` pipeline already produces. No re-signing.
- **No silent installs.** Auto-*download* is fine; auto-*install* is
  not. The user must opt in to the restart. We're not Chrome.
- **No forced updates.** "Update available, ignore for now" must work
  the same way it does today (passive dot, user dismisses).
- **Telemetry stays opt-out** — same model as the rest of Frame.

## Success criteria

- A v2.2.1 user, with no interaction, has v2.2.2 fully downloaded to
  their machine within 24 hours of release
- A non-blocking UI element (banner / notification / settings card)
  appears with "Update ready · Restart to install"
- Clicking it relaunches Frame on the new version, preserving any
  open project state
- The existing `updateChecker.js` "you're on the latest version" /
  "version X is available" copy in Settings still works (no UX
  regression for users who navigate to About manually)
- Rollback path: if v2.2.2 breaks for a user, they can re-download
  v2.2.1 from the releases page and replace manually — same as today

## Out of scope

- Beta / canary update channel — single stable channel only in v1
- Windows + Linux auto-update — wire after Mac is proven
- Delta updates beyond what electron-updater's blockmap already gives
  us for free
- In-app changelog modal ("here's what's new in v2.2.2") — separate
  spec when we want it
- Force-update on critical security fix — also separate, needs careful
  policy thinking

## Open questions for /spec.plan

- Where does `electron-updater` integration sit relative to the
  existing `updateChecker.js`? Two options:
  1. Replace updateChecker entirely (electron-updater also polls)
  2. Keep updateChecker for the passive "version available" UX,
     layer electron-updater on top for the actual download + install
- Auto-update events (download progress, downloaded, error) → which
  renderer surfaces get them? Settings panel and/or a transient banner?
- Provider config: we want `provider: 'github'` with the public repo.
  Confirm no token needed for public release downloads.
- Where does the "Restart to install" prompt live so it's discoverable
  but not nagging? Probably a low-key banner that auto-dismisses on
  next launch if the user closes it.
