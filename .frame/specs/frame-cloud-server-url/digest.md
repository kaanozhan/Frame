---
keywords: frame cloud, server url, release build, extraMetadata, https, session store, localhost, dev and packaged
related: frame-cloud-sign-in, frame-cloud-projects, frame-cloud-early-access
---
Overturns frame-cloud-sign-in D2. The release default is now the packaged
package.json's `frameCloudUrl`. `scripts/release-build.js` (which every `dist*`
script calls) writes it from `FRAME_CLOUD_RELEASE_URL` through
`-c.extraMetadata`, passing only an https, non-loopback address; otherwise it
warns and builds without it. The repository never holds the address, so
`npm start` and forks keep Frame Cloud hidden. `deviceFlow.checkServerUrl`
allows https anywhere and http only on `LOOPBACK_HOSTS` (localhost,
127.0.0.1), one set shared by cloudProjects and the wrapper.
`resolveServerUrl` returns `{ url, refused }`: the first non-empty candidate
decides, and a refused one never falls through to the next. Sessions live in
`userData/cloud-sessions/<sha256[0:16]>.json`, one per server. The old
`cloud-session.json` moves byte for byte on its server's first load. The
Discuss and Shape bus watchers run only while signed in. Rejected: an address
in source, `$VAR` in npm scripts (cmd.exe), one file mapping servers (two
processes race). Rules: new dist scripts go through the wrapper; new buses follow sign-in.

Chain: spec.md → plan.md → tasks.md → outcome.md
