# Tasks — The upgrade path delivers what its prose promises

- T01 · Parameterize `docsManagedBlock` by block name and add `appendBlock` plus `upgradeDoc`'s `onAbsent` option, keeping the current exports bound to `spec-section` so the existing eleven tests pass unchanged.
- T02 · Add the pure `src/shared/docsHealth.js` reporting missing `.frame/…` paths named in Frame's always-on prose and Frame-shaped sections no matcher recognized, with `test/docsHealth.test.js`.
- T03 · Reorder `upgradeSpecDocs` to ensure a pointer's target before writing the pointer and wire the health-gated append branch, with `test/specDocsUpgrade.test.js` covering the pre-split, customized-section and byte-identical-healthy projects.
- T04 · Call `ensureSpecDrivenArtifacts` from the project-open path when spec-driven is on and extract `ensureCodexWrapper` from `runProjectInit`, covering the already-damaged state where the pointer exists and its target does not.
- T08 · Register `docs.repaired` and `docs.degraded` in `src/shared/activityEvents.js` and record them from the project-open path.
- T09 · Add `src/renderer/docsHealthHint.js` in `specDrivenHint`'s shape with its IPC channels and init call, offering the remedy actions and a per-project dismissal.
